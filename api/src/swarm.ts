// SwarmDriver — CloudDriver backend for Docker Swarm (VMs / bare-metal Ubuntu).
// Instances and catalog services run as swarm services on the attachable
// overlay network `floci-net`. The emulator gets the host docker socket
// (swarm services cannot be privileged, so no dind) which floci's docker-java
// client uses for Lambda containers. External traffic reaches instances via
// Caddy (wildcard *.domain + on-demand TLS) attached to the same network.
import Docker from 'dockerode';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  ConflictError,
  isNotFound,
  type CloudDriver,
  type InstanceInfo,
  type InstanceMetrics,
  type NodeInfo,
  type OtelAgentOptions,
  type OtelAgentRun,
  type OtelAgentRunStatus,
  type ServiceMetrics,
} from './driver.ts';
import {
  SERVICE_CATALOG,
  type RealServiceId,
  type RealServiceInfo,
  type RealServiceStatus,
} from './services.ts';
import { emit } from './events.ts';

const NETWORK_NAME = process.env.SWARM_NETWORK ?? 'floci-net';
const SERVICE_PREFIX = 'floci-i-';
const MANAGED_BY = 'floci-cloud';
const MANAGED_LABEL = 'floci.cloud/managed-by';
const INSTANCE_LABEL = 'floci.cloud/instance';
const SERVICE_LABEL = 'floci.cloud/service';
const AGENT_LABEL = 'floci.cloud/agent';
const CREATED_LABEL = 'floci.cloud/created-at';
const EXPIRES_LABEL = 'floci.cloud/expires-at';
const AGENT_REPO_LABEL = 'floci.cloud/agent-repo';
const AGENT_MODEL_LABEL = 'floci.cloud/agent-model';
const DOCKER_SOCK = process.env.DOCKER_SOCK ?? '/var/run/docker.sock';
const IN_CONTAINER = existsSync('/.dockerenv');

export interface SwarmDriverOptions {
  instanceDomain: string;
  flociImage: string;
  tls: boolean;
}

interface TaskSummary {
  state: string;
  desiredState: string;
  error: string | null;
  createdAt: string | null;
  containerId: string | null;
}

function cpuToNano(cpu: string): number {
  // "250m" -> 0.25 CPU -> 250_000_000 NanoCPUs; "1" -> 1e9
  if (cpu.endsWith('m')) {
    return Math.round(Number(cpu.slice(0, -1)) * 1e6);
  }
  return Math.round(Number(cpu) * 1e9);
}

function memToBytes(mem: string): number {
  const units: Record<string, number> = {
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
  };
  for (const [suffix, mult] of Object.entries(units)) {
    if (mem.endsWith(suffix)) {
      return Math.round(Number(mem.slice(0, -suffix.length)) * mult);
    }
  }
  return Number(mem);
}

/**
 * Swarm log frames are multiplexed with an 8-byte header
 * (stream type, 3 zero bytes, 4-byte big-endian length). TTY services
 * stream raw bytes instead — detect and handle both.
 */
function demuxLogs(buf: Buffer): string {
  if (buf.length === 0) {
    return '';
  }
  const first = buf[0] ?? 255;
  const looksMultiplexed = first <= 2 && buf[1] === 0 && buf[2] === 0 && buf[3] === 0;
  if (!looksMultiplexed) {
    return buf.toString('utf8');
  }
  const chunks: string[] = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset + 4);
    const end = Math.min(offset + 8 + size, buf.length);
    chunks.push(buf.subarray(offset + 8, end).toString('utf8'));
    offset = end;
  }
  return chunks.join('');
}

export class SwarmDriver implements CloudDriver {
  readonly kind = 'swarm' as const;
  private docker: Docker;
  private networkReady = false;
  private opts: SwarmDriverOptions;

  constructor(opts: SwarmDriverOptions) {
    this.opts = opts;
    this.docker = new Docker({ socketPath: DOCKER_SOCK });
  }

  scheme(): string {
    return this.opts.tls ? 'https' : 'http';
  }

  hostFor(name: string): string {
    return `${name}.${this.opts.instanceDomain}`;
  }

  awsEndpointFor(name: string): string {
    if (IN_CONTAINER) {
      return `http://${SERVICE_PREFIX}${name}:4566`;
    }
    return `${this.scheme()}://${this.hostFor(name)}`;
  }

  serviceHostFor(name: string, service: RealServiceId): string {
    return `svc-${service}-${name}`;
  }

  serviceExternalHostFor(name: string, service: RealServiceId): string {
    return `${name}-${service}.${this.opts.instanceDomain}`;
  }

  private instanceServiceName(name: string): string {
    return `${SERVICE_PREFIX}${name}`;
  }

  private catalogServiceName(name: string, service: RealServiceId): string {
    return `${SERVICE_PREFIX}${name}-svc-${service}`;
  }

  private async ensureNetwork(): Promise<void> {
    if (this.networkReady) {
      return;
    }
    const nets = await this.docker.listNetworks({
      filters: JSON.stringify({ name: [NETWORK_NAME] }),
    });
    if (!nets.some((n) => n.Name === NETWORK_NAME)) {
      await this.docker.createNetwork({
        Name: NETWORK_NAME,
        Driver: 'overlay',
        Attachable: true,
        Labels: { [MANAGED_LABEL]: MANAGED_BY },
      });
    }
    this.networkReady = true;
  }

  private async listManagedServices(filters: Record<string, string[]>) {
    return this.docker.listServices({
      filters: JSON.stringify({ label: [`${MANAGED_LABEL}=${MANAGED_BY}`], ...filters }),
    });
  }

  private async newestTask(serviceName: string): Promise<TaskSummary | null> {
    const tasks = await this.docker.listTasks({
      filters: JSON.stringify({ service: [serviceName] }),
    });
    const sorted = (tasks as Array<Record<string, any>>).sort((a, b) =>
      String(b.CreatedAt ?? '').localeCompare(String(a.CreatedAt ?? '')),
    );
    const task = sorted[0];
    if (!task) {
      return null;
    }
    return {
      state: String(task.Status?.State ?? 'unknown'),
      desiredState: String(task.DesiredState ?? 'unknown'),
      error: task.Status?.Err ? String(task.Status.Err) : null,
      createdAt: task.CreatedAt ? String(task.CreatedAt) : null,
      containerId: task.Status?.ContainerStatus?.ContainerID
        ? String(task.Status.ContainerStatus.ContainerID)
        : null,
    };
  }

  private async emulatorHealthy(name: string): Promise<boolean> {
    const url = `${this.awsEndpointFor(name)}/_floci/health`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        return true;
      }
    } catch {
      // fall through to docker health below
    }
    // When the API runs outside the overlay network (dev / host mode) the
    // service DNS is unreachable — use the container's own HEALTHCHECK
    // (curl on /_floci/health inside the container) via the local daemon.
    try {
      const task = await this.newestTask(this.instanceServiceName(name));
      const containerId = task?.containerId;
      if (!containerId) {
        return false;
      }
      const inspect = await this.docker.getContainer(containerId).inspect();
      return inspect.State?.Health?.Status === 'healthy';
    } catch {
      return false;
    }
  }

  private async describeInstance(svc: Record<string, any>): Promise<InstanceInfo> {
    const labels: Record<string, string> = svc.Spec?.Labels ?? {};
    const name = labels[INSTANCE_LABEL] ?? String(svc.Spec?.Name ?? '').slice(SERVICE_PREFIX.length);
    const task = await this.newestTask(String(svc.Spec?.Name));
    let status: InstanceInfo['status'] = 'provisioning';
    let statusDetail: string | null = 'scheduling task';
    let readyReplicas = 0;
    if (task) {
      if (task.state === 'running') {
        const healthy = await this.emulatorHealthy(name);
        if (healthy) {
          status = 'running';
          statusDetail = null;
          readyReplicas = 1;
        } else {
          statusDetail = 'emulator starting';
        }
      } else if (task.state === 'failed' || task.state === 'rejected') {
        status = 'error';
        statusDetail = task.error ?? `task ${task.state}`;
      } else if (task.desiredState === 'shutdown') {
        status = 'deleting';
        statusDetail = 'shutting down';
      } else {
        statusDetail = `task ${task.state}`;
      }
    }
    return {
      name,
      status,
      statusDetail,
      host: this.hostFor(name),
      endpoint: `${this.scheme()}://${this.hostFor(name)}`,
      createdAt: labels[CREATED_LABEL] ?? null,
      expiresAt: labels[EXPIRES_LABEL] ?? null,
      image: String(svc.Spec?.TaskTemplate?.ContainerSpec?.Image ?? this.opts.flociImage),
      readyReplicas,
    };
  }

  async list(): Promise<InstanceInfo[]> {
    const services = await this.listManagedServices({});
    const instances = (services as Array<Record<string, any>>).filter((svc) => {
      const labels: Record<string, string> = svc.Spec?.Labels ?? {};
      return labels[INSTANCE_LABEL] && !labels[SERVICE_LABEL];
    });
    const described = await Promise.all(instances.map((svc) => this.describeInstance(svc)));
    return described.sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(name: string): Promise<InstanceInfo | null> {
    const services = await this.listManagedServices({
      name: [this.instanceServiceName(name)],
    });
    const svc = (services as Array<Record<string, any>>).find(
      (s) => s.Spec?.Name === this.instanceServiceName(name),
    );
    if (!svc) {
      return null;
    }
    return this.describeInstance(svc);
  }

  async create(name: string, ttlHours: number | null): Promise<InstanceInfo> {
    emit(name, 'info', `provisioning instance "${name}" on docker swarm`);
    await this.ensureNetwork();
    emit(name, 'ok', `overlay network ${NETWORK_NAME} ready`);
    const existing = await this.get(name);
    if (existing) {
      throw new ConflictError(`instance "${name}" already exists`);
    }
    const now = new Date();
    const labels: Record<string, string> = {
      [MANAGED_LABEL]: MANAGED_BY,
      [INSTANCE_LABEL]: name,
      [CREATED_LABEL]: now.toISOString(),
    };
    if (ttlHours && ttlHours > 0) {
      labels[EXPIRES_LABEL] = new Date(now.getTime() + ttlHours * 3600_000).toISOString();
    }
    await this.docker.createService({
      Name: this.instanceServiceName(name),
      Labels: labels,
      TaskTemplate: {
        ContainerSpec: {
          Image: this.opts.flociImage,
          Env: [`FLOCI_BASE_URL=${this.scheme()}://${this.hostFor(name)}`],
          Mounts: [
            {
              Type: 'bind',
              Source: DOCKER_SOCK,
              Target: '/var/run/docker.sock',
            },
          ],
          Labels: { [MANAGED_LABEL]: MANAGED_BY, [INSTANCE_LABEL]: name },
        },
        Resources: {
          Limits: { NanoCPUs: cpuToNano('1'), MemoryBytes: memToBytes('1536Mi') },
          Reservations: { NanoCPUs: cpuToNano('200m'), MemoryBytes: memToBytes('512Mi') },
        },
        RestartPolicy: { Condition: 'any', Delay: 5_000_000_000 },
        Networks: [{ Target: NETWORK_NAME, Aliases: [this.instanceServiceName(name)] }],
      },
      Mode: { Replicated: { Replicas: 1 } },
      EndpointSpec: { Mode: 'dnsrr' },
    });
    emit(name, 'ok', `swarm service ${this.instanceServiceName(name)} created`);
    emit(name, 'info', `pulling image ${this.opts.flociImage} (first run may take a while)`);
    const created = await this.get(name);
    if (!created) {
      throw new Error(`instance "${name}" vanished right after creation`);
    }
    return created;
  }

  async delete(name: string): Promise<boolean> {
    const services = await this.listManagedServices({});
    const mine = (services as Array<Record<string, any>>).filter(
      (svc) => (svc.Spec?.Labels ?? {})[INSTANCE_LABEL] === name,
    );
    if (mine.length === 0) {
      return false;
    }
    await Promise.all(
      mine.map((svc) =>
        this.docker
          .getService(String(svc.ID))
          .remove()
          .catch((err) => {
            if (!isNotFound(err)) {
              throw err;
            }
          }),
      ),
    );
    await this.removeAgentContainers(name);
    await this.removeInstanceVolumes(name);
    return true;
  }

  private async removeAgentContainers(name: string): Promise<void> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: JSON.stringify({ label: [`${INSTANCE_LABEL}=${name}`, `${AGENT_LABEL}=otel-pr`] }),
    });
    await Promise.all(
      containers.map((c) =>
        this.docker
          .getContainer(c.Id)
          .remove({ force: true })
          .catch(() => undefined),
      ),
    );
  }

  private async removeInstanceVolumes(name: string): Promise<void> {
    // Volumes live on the node each task ran on; best-effort local cleanup.
    try {
      const { Volumes } = await this.docker.listVolumes({
        filters: JSON.stringify({ label: [`${INSTANCE_LABEL}=${name}`] }),
      });
      await Promise.all(
        (Volumes ?? []).map((v) =>
          this.docker
            .getVolume(v.Name)
            .remove()
            .catch(() => undefined),
        ),
      );
    } catch {
      // volume cleanup must never fail a delete
    }
  }

  async logs(name: string, tailLines: number): Promise<string> {
    return this.serviceLogsByName(this.instanceServiceName(name), tailLines);
  }

  private async serviceLogsByName(serviceName: string, tailLines: number): Promise<string> {
    try {
      const svc = this.docker.getService(serviceName);
      const buf = (await svc.logs({
        stdout: true,
        stderr: true,
        tail: tailLines,
      })) as unknown as Buffer;
      return demuxLogs(buf);
    } catch (err) {
      if (isNotFound(err)) {
        return '';
      }
      throw err;
    }
  }

  async reapExpired(): Promise<string[]> {
    const services = await this.listManagedServices({});
    const now = Date.now();
    const expired = new Set<string>();
    for (const svc of services as Array<Record<string, any>>) {
      const labels: Record<string, string> = svc.Spec?.Labels ?? {};
      const instance = labels[INSTANCE_LABEL];
      const expiresAt = labels[EXPIRES_LABEL];
      if (!instance || labels[SERVICE_LABEL] || !expiresAt) {
        continue;
      }
      if (new Date(expiresAt).getTime() <= now) {
        expired.add(instance);
      }
    }
    const reaped: string[] = [];
    for (const instance of expired) {
      if (await this.delete(instance)) {
        reaped.push(instance);
      }
    }
    return reaped;
  }

  // — catalog services —

  private async findCatalogService(
    name: string,
    service: RealServiceId,
  ): Promise<Record<string, any> | null> {
    const services = await this.listManagedServices({
      name: [this.catalogServiceName(name, service)],
    });
    return (
      (services as Array<Record<string, any>>).find(
        (s) => s.Spec?.Name === this.catalogServiceName(name, service),
      ) ?? null
    );
  }

  private async describeCatalogService(
    name: string,
    service: RealServiceId,
    svc: Record<string, any> | null,
  ): Promise<RealServiceInfo> {
    const spec = SERVICE_CATALOG[service];
    let status: RealServiceStatus = 'stopped';
    let statusDetail: string | null = null;
    if (svc) {
      const task = await this.newestTask(String(svc.Spec?.Name));
      if (!task) {
        status = 'starting';
        statusDetail = 'scheduling task';
      } else if (task.state === 'running') {
        status = 'running';
      } else if (task.state === 'failed' || task.state === 'rejected') {
        status = 'error';
        statusDetail = task.error ?? `task ${task.state}`;
      } else {
        status = 'starting';
        statusDetail = `task ${task.state}`;
      }
    }
    const serviceHost = this.serviceHostFor(name, service);
    const externalUrl = spec.httpIngressPort
      ? `${this.scheme()}://${this.serviceExternalHostFor(name, service)}`
      : null;
    return {
      id: service,
      label: spec.label,
      description: spec.description,
      image: spec.image,
      category: spec.category,
      status,
      statusDetail,
      endpoints: spec.endpoints({ serviceHost, externalUrl }),
    };
  }

  async listServices(name: string): Promise<RealServiceInfo[]> {
    const instance = await this.get(name);
    if (!instance) {
      const err = new Error(`instance "${name}" not found`) as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }
    const services = await this.listManagedServices({});
    const byId = new Map<string, Record<string, any>>();
    for (const svc of services as Array<Record<string, any>>) {
      const labels: Record<string, string> = svc.Spec?.Labels ?? {};
      if (labels[INSTANCE_LABEL] === name && labels[SERVICE_LABEL]) {
        byId.set(labels[SERVICE_LABEL], svc);
      }
    }
    return Promise.all(
      (Object.keys(SERVICE_CATALOG) as RealServiceId[]).map((id) =>
        this.describeCatalogService(name, id, byId.get(id) ?? null),
      ),
    );
  }

  async getService(name: string, service: RealServiceId): Promise<RealServiceInfo> {
    const svc = await this.findCatalogService(name, service);
    return this.describeCatalogService(name, service, svc);
  }

  async serviceLogs(name: string, service: RealServiceId, tailLines: number): Promise<string> {
    return this.serviceLogsByName(this.catalogServiceName(name, service), tailLines);
  }

  async startService(name: string, service: RealServiceId): Promise<void> {
    await this.ensureNetwork();
    const instance = await this.get(name);
    if (!instance) {
      const err = new Error(`instance "${name}" not found`) as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }
    const existing = await this.findCatalogService(name, service);
    if (existing) {
      return;
    }
    const spec = SERVICE_CATALOG[service];
    const serviceHost = this.serviceHostFor(name, service);
    const externalHost = this.serviceExternalHostFor(name, service);
    // Swarm has no pods: sidecars become sibling services, so "localhost"
    // references (e.g. Flink's jobmanager.rpc.address) must point at the
    // main service's network alias instead.
    const fixHost = (value: string): string =>
      spec.sidecars ? value.replaceAll('localhost', serviceHost) : value;
    const env = spec
      .env({ serviceHost, externalHost })
      .map((e) => `${e.name}=${fixHost(e.value)}`);
    // dockerode's MountSettings type demands every VolumeOptions field; the
    // Docker API itself accepts partial objects, so keep this loosely typed.
    const mounts = (spec.volumes ?? []).map(
      (v) =>
        ({
          Type: 'volume',
          Source: `${SERVICE_PREFIX}${name}-${service}-${v.name}`,
          Target: v.mountPath,
          VolumeOptions: {
            Labels: { [MANAGED_LABEL]: MANAGED_BY, [INSTANCE_LABEL]: name },
          },
        }) as unknown as Docker.MountSettings,
    );
    const labels: Record<string, string> = {
      [MANAGED_LABEL]: MANAGED_BY,
      [INSTANCE_LABEL]: name,
      [SERVICE_LABEL]: service,
    };
    await this.docker.createService({
      Name: this.catalogServiceName(name, service),
      Labels: labels,
      TaskTemplate: {
        ContainerSpec: {
          Image: spec.image,
          ...(spec.command ? { Command: spec.command } : {}),
          ...(spec.args ? { Args: spec.args } : {}),
          Env: env,
          ...(mounts.length > 0 ? { Mounts: mounts } : {}),
          Labels: labels,
        },
        Resources: {
          Limits: {
            NanoCPUs: cpuToNano(spec.resources.limits.cpu),
            MemoryBytes: memToBytes(spec.resources.limits.memory),
          },
          Reservations: {
            NanoCPUs: cpuToNano(spec.resources.requests.cpu),
            MemoryBytes: memToBytes(spec.resources.requests.memory),
          },
        },
        RestartPolicy: { Condition: 'any', Delay: 5_000_000_000 },
        Networks: [{ Target: NETWORK_NAME, Aliases: [serviceHost] }],
      },
      Mode: { Replicated: { Replicas: 1 } },
      EndpointSpec: { Mode: 'dnsrr' },
    });
    for (const sidecar of spec.sidecars ?? []) {
      const sidecarEnv = (sidecar.env ?? []).map(
        (e) => `${e.name}=${e.value.replaceAll('localhost', serviceHost)}`,
      );
      await this.docker.createService({
        Name: `${this.catalogServiceName(name, service)}-${sidecar.name}`,
        Labels: {
          [MANAGED_LABEL]: MANAGED_BY,
          [INSTANCE_LABEL]: name,
          [SERVICE_LABEL]: `${service}-${sidecar.name}`,
        },
        TaskTemplate: {
          ContainerSpec: {
            Image: sidecar.image ?? spec.image,
            ...(sidecar.command ? { Command: sidecar.command } : {}),
            ...(sidecar.args ? { Args: sidecar.args } : {}),
            Env: sidecarEnv,
          },
          Resources: {
            Limits: {
              NanoCPUs: cpuToNano(sidecar.resources.limits.cpu),
              MemoryBytes: memToBytes(sidecar.resources.limits.memory),
            },
            Reservations: {
              NanoCPUs: cpuToNano(sidecar.resources.requests.cpu),
              MemoryBytes: memToBytes(sidecar.resources.requests.memory),
            },
          },
          RestartPolicy: { Condition: 'any', Delay: 5_000_000_000 },
          Networks: [
            {
              Target: NETWORK_NAME,
              Aliases: [`${serviceHost}-${sidecar.name}`],
            },
          ],
        },
        Mode: { Replicated: { Replicas: 1 } },
        EndpointSpec: { Mode: 'dnsrr' },
      });
    }
  }

  async stopService(name: string, service: RealServiceId): Promise<void> {
    const services = await this.listManagedServices({});
    const prefix = `${service}`;
    const mine = (services as Array<Record<string, any>>).filter((svc) => {
      const labels: Record<string, string> = svc.Spec?.Labels ?? {};
      const svcLabel = labels[SERVICE_LABEL] ?? '';
      return (
        labels[INSTANCE_LABEL] === name &&
        (svcLabel === prefix || svcLabel.startsWith(`${prefix}-`))
      );
    });
    await Promise.all(
      mine.map((svc) =>
        this.docker
          .getService(String(svc.ID))
          .remove()
          .catch((err) => {
            if (!isNotFound(err)) {
              throw err;
            }
          }),
      ),
    );
  }

  // — observability —

  async instanceMetrics(name: string): Promise<InstanceMetrics> {
    // Real stats from the local daemon; tasks scheduled on other nodes are
    // not reachable through this socket and are simply not counted (yet).
    const containers = await this.docker.listContainers({
      filters: JSON.stringify({ label: [`${INSTANCE_LABEL}=${name}`] }),
    });
    const byService = new Map<string, ServiceMetrics>();
    await Promise.all(
      containers.map(async (info) => {
        const labels = info.Labels ?? {};
        const service = labels[SERVICE_LABEL] ?? 'emulator';
        try {
          const stats = (await this.docker
            .getContainer(info.Id)
            .stats({ stream: false })) as Record<string, any>;
          const cpuDelta =
            (stats.cpu_stats?.cpu_usage?.total_usage ?? 0) -
            (stats.precpu_stats?.cpu_usage?.total_usage ?? 0);
          const systemDelta =
            (stats.cpu_stats?.system_cpu_usage ?? 0) - (stats.precpu_stats?.system_cpu_usage ?? 0);
          const onlineCpus = stats.cpu_stats?.online_cpus ?? 1;
          const cpuMilli =
            systemDelta > 0 ? Math.round((cpuDelta / systemDelta) * onlineCpus * 1000) : 0;
          const memoryBytes = stats.memory_stats?.usage ?? 0;
          const prev = byService.get(service) ?? {
            service,
            cpuMilli: 0,
            memoryBytes: 0,
            pods: 0,
          };
          prev.cpuMilli += cpuMilli;
          prev.memoryBytes += memoryBytes;
          prev.pods += 1;
          byService.set(service, prev);
        } catch {
          // container may have exited between list and stats
        }
      }),
    );
    return {
      instance: name,
      sampledAt: new Date().toISOString(),
      services: [...byService.values()].sort((a, b) => a.service.localeCompare(b.service)),
    };
  }

  // — cluster nodes —

  async nodes(): Promise<NodeInfo[]> {
    const nodes = (await this.docker.listNodes()) as Array<Record<string, any>>;
    return nodes
      .map((node) => ({
        id: String(node.ID ?? ''),
        hostname: String(node.Description?.Hostname ?? 'unknown'),
        role: (node.Spec?.Role === 'manager' ? 'manager' : 'worker') as 'manager' | 'worker',
        state: String(node.Status?.State ?? 'unknown'),
        addr: node.Status?.Addr ? String(node.Status.Addr) : null,
        cpuTotalMilli: Math.round((node.Description?.Resources?.NanoCPUs ?? 0) / 1e6),
        memTotalBytes: Number(node.Description?.Resources?.MemoryBytes ?? 0),
        cpuUsedMilli: null,
        memUsedBytes: null,
      }))
      .sort((a, b) => a.hostname.localeCompare(b.hostname));
  }

  async joinCommand(): Promise<string | null> {
    const swarm = (await this.docker.swarmInspect()) as Record<string, any>;
    const token = swarm.JoinTokens?.Worker;
    if (!token) {
      return null;
    }
    const info = (await this.docker.info()) as Record<string, any>;
    const addr = info.Swarm?.NodeAddr ?? 'MANAGER_IP';
    return `docker swarm join --token ${token} ${addr}:2377`;
  }

  // — OTel PR agent (one-shot container on the local daemon) —

  async runOtelAgent(name: string, options: OtelAgentOptions): Promise<OtelAgentRun> {
    await this.ensureNetwork();
    const script = await readFile(
      path.join(import.meta.dirname, 'agent', 'otel-agent.mjs'),
      'utf8',
    );
    const id = `otel-pr-${Date.now().toString(36)}`;
    const model = options.model || 'gemma3n:e4b';
    const ollamaUrl = `http://${this.serviceHostFor(name, 'ollama')}:11434`;
    const container = await this.docker.createContainer({
      name: id,
      Image: 'node:24-bookworm',
      Cmd: ['node', '--input-type=module', '-e', script],
      Env: [
        `REPO_URL=${options.repoUrl}`,
        `GITHUB_TOKEN=${options.githubToken}`,
        `OLLAMA_URL=${ollamaUrl}`,
        `MODEL=${model}`,
        `BASE_BRANCH=${options.baseBranch ?? ''}`,
        `MAX_FILES=${String(options.maxFiles ?? 4)}`,
        'HOME=/tmp/work',
      ],
      Labels: {
        [MANAGED_LABEL]: MANAGED_BY,
        [INSTANCE_LABEL]: name,
        [AGENT_LABEL]: 'otel-pr',
        [AGENT_REPO_LABEL]: options.repoUrl,
        [AGENT_MODEL_LABEL]: model,
      },
      HostConfig: {
        NetworkMode: NETWORK_NAME,
        Memory: memToBytes('1Gi'),
        NanoCpus: cpuToNano('1'),
        AutoRemove: false,
      },
    });
    await container.start();
    return {
      id,
      status: 'running',
      repoUrl: options.repoUrl,
      model,
      startedAt: new Date().toISOString(),
      completedAt: null,
    };
  }

  async listOtelAgentRuns(name: string): Promise<OtelAgentRun[]> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: JSON.stringify({ label: [`${INSTANCE_LABEL}=${name}`, `${AGENT_LABEL}=otel-pr`] }),
    });
    const runs = await Promise.all(
      containers.map(async (info) => {
        const labels = info.Labels ?? {};
        let status: OtelAgentRunStatus = 'pending';
        let startedAt: string | null = null;
        let completedAt: string | null = null;
        try {
          const inspect = await this.docker.getContainer(info.Id).inspect();
          const state = inspect.State;
          startedAt =
            state.StartedAt && state.StartedAt !== '0001-01-01T00:00:00Z' ? state.StartedAt : null;
          if (state.Running) {
            status = 'running';
          } else if (state.StartedAt && state.StartedAt !== '0001-01-01T00:00:00Z') {
            status = state.ExitCode === 0 ? 'succeeded' : 'failed';
            completedAt =
              state.FinishedAt && state.FinishedAt !== '0001-01-01T00:00:00Z'
                ? state.FinishedAt
                : null;
          }
        } catch {
          // container disappeared between list and inspect
        }
        return {
          id: (info.Names?.[0] ?? '').replace(/^\//, ''),
          status,
          repoUrl: labels[AGENT_REPO_LABEL] ?? '',
          model: labels[AGENT_MODEL_LABEL] ?? '',
          startedAt,
          completedAt,
        };
      }),
    );
    return runs.sort((a, b) => b.id.localeCompare(a.id));
  }

  async otelAgentLogs(name: string, runId: string, tailLines: number): Promise<string> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: JSON.stringify({
        label: [`${INSTANCE_LABEL}=${name}`, `${AGENT_LABEL}=otel-pr`],
        name: [runId],
      }),
    });
    const match = containers.find((c) => c.Names?.some((n) => n === `/${runId}`));
    if (!match) {
      return '';
    }
    const buf = (await this.docker.getContainer(match.Id).logs({
      stdout: true,
      stderr: true,
      tail: tailLines,
    })) as unknown as Buffer;
    return demuxLogs(buf);
  }
}
