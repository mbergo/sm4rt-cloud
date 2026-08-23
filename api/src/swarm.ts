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
  type ServiceConfigInfo,
  type ServiceMetrics,
  type ServiceTargetInfo,
} from './driver.ts';
import {
  SERVICE_CATALOG,
  type RealServiceId,
  type RealServiceInfo,
  type RealServiceStatus,
  type ServiceInstanceRef,
} from './services.ts';
import { emit } from './events.ts';

const NETWORK_NAME = process.env.SWARM_NETWORK ?? 'floci-net';
const SERVICE_PREFIX = 'floci-i-';
const MANAGED_BY = 'floci-cloud';
const EXEC_AGENT_SERVICE = 'floci-exec-agent';
const EXEC_AGENT_LABEL = 'floci.cloud/component';
const EXEC_AGENT_PORT = 8080;
const MANAGED_LABEL = 'floci.cloud/managed-by';
const INSTANCE_LABEL = 'floci.cloud/instance';
const SERVICE_LABEL = 'floci.cloud/service';
/** named catalog instance ('' / absent = the default instance) */
const SERVICE_INSTANCE_LABEL = 'floci.cloud/service-instance';
const WS_OWNER_LABEL = 'sm4rt.workspace';
const MAX_INSTANCES_PER_SERVICE = 5;
const AGENT_LABEL = 'floci.cloud/agent';
const CREATED_LABEL = 'floci.cloud/created-at';
const EXPIRES_LABEL = 'floci.cloud/expires-at';
const AGENT_REPO_LABEL = 'floci.cloud/agent-repo';
const AGENT_MODEL_LABEL = 'floci.cloud/agent-model';
const DOCKER_SOCK = process.env.DOCKER_SOCK ?? '/var/run/docker.sock';
const IN_CONTAINER = existsSync('/.dockerenv');

// Optional registry credentials so swarm nodes can pull private images
// (e.g. a private GHCR floci image). Sent as X-Registry-Auth on service
// create, which swarm distributes to workers.
const REGISTRY_SERVER = process.env.REGISTRY_SERVER ?? 'ghcr.io';
const REGISTRY_USER = process.env.REGISTRY_USER ?? '';
const REGISTRY_PASS = process.env.REGISTRY_PASS ?? '';

function registryAuthFor(image: string): Docker.AuthConfig | undefined {
  if (!REGISTRY_USER || !REGISTRY_PASS) return undefined;
  if (!image.startsWith(`${REGISTRY_SERVER}/`)) return undefined;
  return {
    username: REGISTRY_USER,
    password: REGISTRY_PASS,
    serveraddress: REGISTRY_SERVER,
  };
}

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
  nodeId: string | null;
}

/**
 * Pick the overlay-network IP of the exec-agent task running on `nodeId`.
 * Pure helper (exported for tests): takes raw swarm task objects and returns
 * the bare IP (addresses come as CIDR, e.g. "10.0.1.5/24") or null.
 */
export function agentTaskAddress(
  tasks: Array<Record<string, any>>,
  nodeId: string,
  networkName: string,
): string | null {
  for (const t of tasks) {
    if (String(t.NodeID ?? '') !== nodeId || String(t.Status?.State ?? '') !== 'running') {
      continue;
    }
    for (const att of (t.NetworksAttachments ?? []) as Array<Record<string, any>>) {
      if (String(att.Network?.Spec?.Name ?? '') !== networkName) {
        continue;
      }
      const addr = String((att.Addresses ?? [])[0] ?? '');
      if (addr) {
        return addr.split('/')[0] ?? null;
      }
    }
  }
  return null;
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

/**
 * Stateful demuxer for follow-mode log streams. Chunks may split frames at
 * any byte, so partial frames are buffered until the next push. Mode
 * (multiplexed vs raw TTY) is detected once, from the first bytes seen.
 */
export function createLogDemuxer(): { push: (chunk: Buffer) => string } {
  let pending = Buffer.alloc(0);
  let mode: 'unknown' | 'multiplexed' | 'raw' = 'unknown';
  return {
    push(chunk: Buffer): string {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      if (mode === 'unknown') {
        if (pending.length < 4) return '';
        const first = pending[0] ?? 255;
        mode =
          first <= 2 && pending[1] === 0 && pending[2] === 0 && pending[3] === 0
            ? 'multiplexed'
            : 'raw';
      }
      if (mode === 'raw') {
        const out = pending.toString('utf8');
        pending = Buffer.alloc(0);
        return out;
      }
      const chunks: string[] = [];
      let offset = 0;
      while (offset + 8 <= pending.length) {
        const size = pending.readUInt32BE(offset + 4);
        if (offset + 8 + size > pending.length) break; // partial frame — wait
        chunks.push(pending.subarray(offset + 8, offset + 8 + size).toString('utf8'));
        offset += 8 + size;
      }
      pending = pending.subarray(offset);
      return chunks.join('');
    },
  };
}

export class SwarmDriver implements CloudDriver {
  readonly kind = 'swarm' as const;
  private docker: Docker;
  private networkReady = false;
  private selfNodeId: string | null | undefined; // undefined = not fetched yet
  private opts: SwarmDriverOptions;

  constructor(opts: SwarmDriverOptions) {
    this.opts = opts;
    this.docker = new Docker({ socketPath: DOCKER_SOCK });
  }

  /** createService, attaching registry auth when the image needs it. */
  private createSwarmService(spec: Docker.CreateServiceOptions): Promise<Docker.Service> {
    const image =
      (spec.TaskTemplate as { ContainerSpec?: { Image?: string } } | undefined)?.ContainerSpec
        ?.Image ?? '';
    const auth = registryAuthFor(image);
    return auth
      ? this.docker.createService(auth, spec as Docker.ServiceSpec)
      : this.docker.createService(spec);
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

  serviceHostFor(name: string, service: RealServiceId, instanceName?: string): string {
    return instanceName ? `svc-${service}-${instanceName}-${name}` : `svc-${service}-${name}`;
  }

  serviceExternalHostFor(name: string, service: RealServiceId, instanceName?: string): string {
    const prefix = instanceName ? `${name}-${service}-${instanceName}` : `${name}-${service}`;
    return `${prefix}.${this.opts.instanceDomain}`;
  }

  private instanceServiceName(name: string): string {
    return `${SERVICE_PREFIX}${name}`;
  }

  private catalogServiceName(name: string, service: RealServiceId, instanceName?: string): string {
    const base = `${SERVICE_PREFIX}${name}-svc-${service}`;
    return instanceName ? `${base}--${instanceName}` : base;
  }

  /**
   * caddy-docker-proxy routing labels. The edge proxy watches swarm services
   * and rebuilds its Caddyfile from these — service labels are the single
   * source of truth, no admin-API pushes. With TLS, `tls.on_demand` keeps
   * certificate issuance gated by our /api/public/tls-ask endpoint.
   */
  private caddyLabels(host: string, port: number): Record<string, string> {
    const labels: Record<string, string> = {
      caddy: this.opts.tls ? host : `http://${host}`,
      'caddy.reverse_proxy': `{{upstreams ${port}}}`,
    };
    if (this.opts.tls) {
      labels['caddy.tls.on_demand'] = '';
    }
    return labels;
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

  private async newestTask(
    serviceName: string,
    opts?: { runningOnly?: boolean },
  ): Promise<TaskSummary | null> {
    const filters: Record<string, string[]> = { service: [serviceName] };
    if (opts?.runningOnly) {
      filters['desired-state'] = ['running'];
    }
    const tasks = await this.docker.listTasks({ filters: JSON.stringify(filters) });
    let candidates = tasks as Array<Record<string, any>>;
    if (opts?.runningOnly) {
      candidates = candidates.filter((t) => String(t.Status?.State ?? '') === 'running');
    }
    const sorted = candidates.sort((a, b) =>
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
      nodeId: task.NodeID ? String(task.NodeID) : null,
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
      } else if (task.state === 'pending') {
        // The scheduler has nowhere to put this yet. It is not an error and the
        // task is not dropped — swarm keeps it and places it as soon as a node
        // fits, so the workspace comes up on its own once capacity is added.
        // Swarm usually explains why (e.g. "no suitable node"); prefer its own
        // words over ours.
        status = 'queued';
        statusDetail = task.error ?? 'waiting for capacity in the pool';
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
      ...this.caddyLabels(this.hostFor(name), 4566),
    };
    if (ttlHours && ttlHours > 0) {
      labels[EXPIRES_LABEL] = new Date(now.getTime() + ttlHours * 3600_000).toISOString();
    }
    await this.createSwarmService({
      Name: this.instanceServiceName(name),
      Labels: labels,
      TaskTemplate: {
        ContainerSpec: {
          Image: this.opts.flociImage,
          Env: [
            `FLOCI_BASE_URL=${this.scheme()}://${this.hostFor(name)}`,
            // Lambda runtime containers are plain containers on the node's
            // docker daemon; without this they land on the default bridge and
            // can never reach the emulator's Runtime API on the overlay IP.
            `FLOCI_SERVICES_LAMBDA_DOCKER_NETWORK=${NETWORK_NAME}`,
          ],
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
    instanceName?: string,
  ): Promise<Record<string, any> | null> {
    const wanted = this.catalogServiceName(name, service, instanceName);
    const services = await this.listManagedServices({ name: [wanted] });
    return (
      (services as Array<Record<string, any>>).find((s) => s.Spec?.Name === wanted) ?? null
    );
  }

  private async taskStatusOf(
    specName: string,
  ): Promise<{ status: RealServiceStatus; statusDetail: string | null }> {
    const task = await this.newestTask(specName);
    if (!task) {
      return { status: 'starting', statusDetail: 'scheduling task' };
    }
    if (task.state === 'running') {
      return { status: 'running', statusDetail: null };
    }
    if (task.state === 'failed' || task.state === 'rejected') {
      return { status: 'error', statusDetail: task.error ?? `task ${task.state}` };
    }
    return { status: 'starting', statusDetail: `task ${task.state}` };
  }

  private async describeCatalogService(
    name: string,
    service: RealServiceId,
    svcs: Record<string, any>[],
  ): Promise<RealServiceInfo> {
    const spec = SERVICE_CATALOG[service];
    const instances: ServiceInstanceRef[] = await Promise.all(
      svcs.map(async (svc) => {
        const labels: Record<string, string> = svc.Spec?.Labels ?? {};
        const inst = labels[SERVICE_INSTANCE_LABEL] || null;
        const { status, statusDetail } = await this.taskStatusOf(String(svc.Spec?.Name));
        return {
          name: inst,
          serviceName: String(svc.Spec?.Name),
          status,
          statusDetail,
          host: this.serviceHostFor(name, service, inst ?? undefined),
          externalUrl: spec.httpIngressPort
            ? `${this.scheme()}://${this.serviceExternalHostFor(name, service, inst ?? undefined)}`
            : null,
        };
      }),
    );
    // aggregate: running > starting > error > stopped
    let status: RealServiceStatus = 'stopped';
    let statusDetail: string | null = null;
    if (instances.some((i) => i.status === 'running')) {
      status = 'running';
    } else if (instances.some((i) => i.status === 'starting')) {
      status = 'starting';
      statusDetail = instances.find((i) => i.status === 'starting')?.statusDetail ?? null;
    } else if (instances.some((i) => i.status === 'error')) {
      status = 'error';
      statusDetail = instances.find((i) => i.status === 'error')?.statusDetail ?? null;
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
      instances,
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
    const byId = new Map<string, Record<string, any>[]>();
    for (const svc of services as Array<Record<string, any>>) {
      const labels: Record<string, string> = svc.Spec?.Labels ?? {};
      const id = labels[SERVICE_LABEL] ?? '';
      // sidecars carry `${service}-${sidecar}` labels — only group primaries
      if (labels[INSTANCE_LABEL] === name && id && id in SERVICE_CATALOG) {
        const list = byId.get(id) ?? [];
        list.push(svc);
        byId.set(id, list);
      }
    }
    return Promise.all(
      (Object.keys(SERVICE_CATALOG) as RealServiceId[]).map((id) =>
        this.describeCatalogService(name, id, byId.get(id) ?? []),
      ),
    );
  }

  async getService(name: string, service: RealServiceId): Promise<RealServiceInfo> {
    const services = await this.listManagedServices({});
    const mine = (services as Array<Record<string, any>>).filter((svc) => {
      const labels: Record<string, string> = svc.Spec?.Labels ?? {};
      return labels[INSTANCE_LABEL] === name && labels[SERVICE_LABEL] === service;
    });
    return this.describeCatalogService(name, service, mine);
  }

  async serviceLogs(name: string, service: RealServiceId, tailLines: number): Promise<string> {
    return this.serviceLogsByName(this.catalogServiceName(name, service), tailLines);
  }

  async startService(name: string, service: RealServiceId, instanceName?: string): Promise<void> {
    await this.ensureNetwork();
    const instance = await this.get(name);
    if (!instance) {
      const err = new Error(`instance "${name}" not found`) as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }
    const existing = await this.findCatalogService(name, service, instanceName);
    if (existing) {
      return;
    }
    if (instanceName) {
      const info = await this.getService(name, service);
      if ((info.instances?.length ?? 0) >= MAX_INSTANCES_PER_SERVICE) {
        throw new ConflictError(
          `limit of ${MAX_INSTANCES_PER_SERVICE} instances per service reached`,
        );
      }
    }
    const spec = SERVICE_CATALOG[service];
    const serviceHost = this.serviceHostFor(name, service, instanceName);
    const externalHost = this.serviceExternalHostFor(name, service, instanceName);
    const volumePrefix = instanceName
      ? `${SERVICE_PREFIX}${name}-${service}--${instanceName}`
      : `${SERVICE_PREFIX}${name}-${service}`;
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
          Source: `${volumePrefix}-${v.name}`,
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
      ...(instanceName ? { [SERVICE_INSTANCE_LABEL]: instanceName } : {}),
    };
    // caddy labels go on the service spec only (not the container) — the
    // proxy scans both, and duplicates would generate conflicting sites
    const serviceLabels: Record<string, string> = spec.httpIngressPort
      ? { ...labels, ...this.caddyLabels(externalHost, spec.httpIngressPort) }
      : labels;
    await this.createSwarmService({
      Name: this.catalogServiceName(name, service, instanceName),
      Labels: serviceLabels,
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
      await this.createSwarmService({
        Name: `${this.catalogServiceName(name, service, instanceName)}-${sidecar.name}`,
        Labels: {
          [MANAGED_LABEL]: MANAGED_BY,
          [INSTANCE_LABEL]: name,
          [SERVICE_LABEL]: `${service}-${sidecar.name}`,
          ...(instanceName ? { [SERVICE_INSTANCE_LABEL]: instanceName } : {}),
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

  async stopService(name: string, service: RealServiceId, instanceName?: string): Promise<void> {
    const services = await this.listManagedServices({});
    const prefix = `${service}`;
    const wantedInst = instanceName ?? '';
    const mine = (services as Array<Record<string, any>>).filter((svc) => {
      const labels: Record<string, string> = svc.Spec?.Labels ?? {};
      const svcLabel = labels[SERVICE_LABEL] ?? '';
      return (
        labels[INSTANCE_LABEL] === name &&
        (svcLabel === prefix || svcLabel.startsWith(`${prefix}-`)) &&
        (labels[SERVICE_INSTANCE_LABEL] ?? '') === wantedInst
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

  // — post-provision panel (logs streaming, exec, config) —

  /**
   * Resolve a target to an owned swarm service. `target` is either a full
   * swarm service name or a catalog service id. Ownership = our catalog
   * label OR compute.ts's `sm4rt.workspace` label.
   */
  private async resolveOwnedService(
    name: string,
    target: string,
  ): Promise<{ id: string; specName: string; svc: Record<string, any> }> {
    const services = await this.listManagedServices({});
    const owned = (services as Array<Record<string, any>>).filter((svc) => {
      const labels: Record<string, string> = svc.Spec?.Labels ?? {};
      return labels[INSTANCE_LABEL] === name || labels[WS_OWNER_LABEL] === name;
    });
    const found =
      owned.find((svc) => String(svc.Spec?.Name) === target) ??
      // catalog id shorthand → default instance
      owned.find((svc) => String(svc.Spec?.Name) === this.catalogServiceName(name, target as RealServiceId));
    if (!found) {
      const err = new Error(`service "${target}" not found in "${name}"`) as Error & {
        statusCode: number;
      };
      err.statusCode = 404;
      throw err;
    }
    return { id: String(found.ID), specName: String(found.Spec?.Name), svc: found };
  }

  async streamServiceLogs(
    name: string,
    target: string,
    tailLines: number,
  ): Promise<{ stream: NodeJS.ReadableStream; close: () => void }> {
    const { specName } = await this.resolveOwnedService(name, target);
    const svc = this.docker.getService(specName);
    const stream = (await svc.logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail: tailLines,
    })) as unknown as NodeJS.ReadableStream;
    const close = () => {
      const s = stream as unknown as { destroy?: () => void };
      try {
        s.destroy?.();
      } catch {
        // already gone
      }
    };
    return { stream, close };
  }

  async execInService(
    name: string,
    target: string,
    cmd: string[],
    timeoutMs = 30_000,
  ): Promise<{ output: string; exitCode: number | null; timedOut: boolean }> {
    const { specName } = await this.resolveOwnedService(name, target);
    const task = await this.newestTask(specName, { runningOnly: true });
    if (!task?.containerId) {
      const err = new Error(`no running container for "${target}"`) as Error & {
        statusCode: number;
      };
      err.statusCode = 409;
      throw err;
    }
    // Multi-node swarm: the local docker.sock only reaches containers on this
    // node. If the task landed elsewhere, relay through the per-node exec agent.
    const selfNode = await this.getSelfNodeId();
    if (task.nodeId && selfNode && task.nodeId !== selfNode) {
      return this.execViaAgent(task.nodeId, task.containerId, cmd, timeoutMs);
    }
    const container = this.docker.getContainer(task.containerId);
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = (await exec.start({})) as NodeJS.ReadableStream & { destroy?: () => void };
    const demux = createLogDemuxer();
    let output = '';
    let timedOut = false;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        stream.destroy?.();
        resolve();
      }, timeoutMs);
      stream.on('data', (chunk: Buffer) => {
        output += demux.push(chunk);
        if (output.length > 256 * 1024) {
          timedOut = false;
          clearTimeout(timer);
          stream.destroy?.();
          resolve();
        }
      });
      stream.on('end', () => {
        clearTimeout(timer);
        resolve();
      });
      stream.on('error', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    let exitCode: number | null = null;
    if (!timedOut) {
      try {
        const inspect = await exec.inspect();
        exitCode = typeof inspect.ExitCode === 'number' ? inspect.ExitCode : null;
      } catch {
        exitCode = null;
      }
    }
    return { output, exitCode, timedOut };
  }

  private async getSelfNodeId(): Promise<string | null> {
    if (this.selfNodeId !== undefined) {
      return this.selfNodeId;
    }
    try {
      const info = (await this.docker.info()) as Record<string, any>;
      this.selfNodeId = info?.Swarm?.NodeID ? String(info.Swarm.NodeID) : null;
    } catch {
      this.selfNodeId = null;
    }
    return this.selfNodeId;
  }

  /** Relay an exec to the floci-exec-agent task on the container's node. */
  private async execViaAgent(
    nodeId: string,
    containerId: string,
    cmd: string[],
    timeoutMs: number,
  ): Promise<{ output: string; exitCode: number | null; timedOut: boolean }> {
    const tasks = (await this.docker.listTasks({
      filters: JSON.stringify({
        service: [EXEC_AGENT_SERVICE],
        'desired-state': ['running'],
      }),
    })) as Array<Record<string, any>>;
    const ip = agentTaskAddress(tasks, nodeId, NETWORK_NAME);
    if (!ip) {
      const err = new Error(
        `container runs on another node and no exec agent is available there (node ${nodeId})`,
      ) as Error & { statusCode: number };
      err.statusCode = 502;
      throw err;
    }
    const token = process.env.FLOCI_CLOUD_TOKEN ?? '';
    let res: Response;
    try {
      res = await fetch(`http://${ip}:${EXEC_AGENT_PORT}/agent/exec`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ containerId, cmd }),
        signal: AbortSignal.timeout(timeoutMs + 5_000),
      });
    } catch (e) {
      const err = new Error(
        `exec agent unreachable at ${ip}: ${e instanceof Error ? e.message : String(e)}`,
      ) as Error & { statusCode: number };
      err.statusCode = 502;
      throw err;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`exec agent error ${res.status}: ${body.slice(0, 200)}`) as Error & {
        statusCode: number;
      };
      err.statusCode = 502;
      throw err;
    }
    const data = (await res.json()) as {
      output?: unknown;
      exitCode?: unknown;
      timedOut?: unknown;
    };
    return {
      output: typeof data.output === 'string' ? data.output : '',
      exitCode: typeof data.exitCode === 'number' ? data.exitCode : null,
      timedOut: data.timedOut === true,
    };
  }

  /**
   * Ensure the global floci-exec-agent service exists and runs the same image
   * as this API (one task per node, local docker.sock). Called at boot;
   * updates the service when the image digest changes so agents follow deploys.
   */
  async ensureExecAgent(): Promise<void> {
    await this.ensureNetwork();
    const image = await this.selfImageRef();
    const spec: Record<string, any> = {
      Name: EXEC_AGENT_SERVICE,
      Labels: { [EXEC_AGENT_LABEL]: 'exec-agent' },
      TaskTemplate: {
        ContainerSpec: {
          Image: image,
          Command: ['node', 'src/agent/exec-agent.ts'],
          User: '0',
          Env: [`FLOCI_CLOUD_TOKEN=${process.env.FLOCI_CLOUD_TOKEN ?? ''}`],
          Mounts: [
            { Type: 'bind', Source: DOCKER_SOCK, Target: '/var/run/docker.sock' },
          ],
        },
        RestartPolicy: { Condition: 'any', Delay: 5_000_000_000 },
        Networks: [{ Target: NETWORK_NAME }],
      },
      Mode: { Global: {} },
    };
    const existing = (await this.docker.listServices({
      filters: JSON.stringify({ name: [EXEC_AGENT_SERVICE] }),
    })) as Array<Record<string, any>>;
    const current = existing.find((s) => s.Spec?.Name === EXEC_AGENT_SERVICE);
    if (!current) {
      await this.createSwarmService(spec as Docker.CreateServiceOptions);
      return;
    }
    const currentImage = String(current.Spec?.TaskTemplate?.ContainerSpec?.Image ?? '');
    if (currentImage === image) {
      return;
    }
    const service = this.docker.getService(String(current.ID));
    const inspected = (await service.inspect()) as Record<string, any>;
    await service.update({
      version: Number(inspected.Version?.Index ?? 0),
      ...spec,
    } as Record<string, any>);
  }

  /**
   * Image reference for the exec agent. Prefer a registry-pullable digest of
   * *this* container's image (RepoDigests) — a bare image ID is node-local and
   * unusable on other nodes. Falls back to env/latest tag.
   */
  private async selfImageRef(): Promise<string> {
    const fallback = process.env.FLOCI_AGENT_IMAGE ?? 'ghcr.io/mbergo/sm4rt-cloud:latest';
    try {
      const hostname = process.env.HOSTNAME ?? '';
      if (!hostname) {
        return fallback;
      }
      const me = await this.docker.getContainer(hostname).inspect();
      const imageId = me.Image;
      const img = (await this.docker.getImage(imageId).inspect()) as Record<string, any>;
      const digest = (img.RepoDigests ?? [])[0];
      return typeof digest === 'string' && digest.length > 0 ? digest : fallback;
    } catch {
      return fallback;
    }
  }

  async getServiceConfig(name: string, target: string): Promise<ServiceConfigInfo> {
    const { svc, specName } = await this.resolveOwnedService(name, target);
    const spec = svc.Spec ?? {};
    const containerSpec = spec.TaskTemplate?.ContainerSpec ?? {};
    const mounts = (containerSpec.Mounts ?? []).map((m: Record<string, any>) => ({
      source: String(m.Source ?? ''),
      target: String(m.Target ?? ''),
      type: String(m.Type ?? 'volume'),
    }));
    const ports = (svc.Endpoint?.Ports ?? spec.EndpointSpec?.Ports ?? []).map(
      (p: Record<string, any>) => ({
        published: typeof p.PublishedPort === 'number' ? p.PublishedPort : null,
        target: Number(p.TargetPort ?? 0),
        protocol: String(p.Protocol ?? 'tcp'),
      }),
    );
    return {
      name: specName,
      image: String(containerSpec.Image ?? ''),
      env: (containerSpec.Env ?? []).map(String),
      mounts,
      ports,
      replicas: spec.Mode?.Replicated?.Replicas ?? null,
      createdAt: svc.CreatedAt ?? null,
      updatedAt: svc.UpdatedAt ?? null,
    };
  }

  async updateServiceEnv(name: string, target: string, env: string[]): Promise<void> {
    const { id, svc } = await this.resolveOwnedService(name, target);
    const service = this.docker.getService(id);
    const current = (await service.inspect()) as Record<string, any>;
    const spec = structuredClone(current.Spec ?? svc.Spec ?? {});
    spec.TaskTemplate = spec.TaskTemplate ?? {};
    spec.TaskTemplate.ContainerSpec = spec.TaskTemplate.ContainerSpec ?? {};
    spec.TaskTemplate.ContainerSpec.Env = env;
    // bump ForceUpdate so swarm restarts tasks even if only env changed
    spec.TaskTemplate.ForceUpdate = (Number(spec.TaskTemplate.ForceUpdate) || 0) + 1;
    await service.update({
      version: Number(current.Version?.Index ?? 0),
      ...spec,
    } as Record<string, any>);
  }

  async listServiceTargets(name: string): Promise<ServiceTargetInfo[]> {
    const services = await this.listManagedServices({});
    const targets: ServiceTargetInfo[] = [];
    for (const svc of services as Array<Record<string, any>>) {
      const labels: Record<string, string> = svc.Spec?.Labels ?? {};
      const specName = String(svc.Spec?.Name ?? '');
      if (labels[INSTANCE_LABEL] === name) {
        const serviceId = labels[SERVICE_LABEL] ?? null;
        const inst = labels[SERVICE_INSTANCE_LABEL] || null;
        const catalogSpec =
          serviceId && serviceId in SERVICE_CATALOG
            ? SERVICE_CATALOG[serviceId as RealServiceId]
            : null;
        const base = catalogSpec?.label ?? serviceId ?? specName;
        targets.push({
          name: specName,
          kind: 'catalog',
          service: serviceId,
          label: inst ? `${base} (${inst})` : base,
        });
      } else if (labels[WS_OWNER_LABEL] === name) {
        targets.push({
          name: specName,
          kind: 'compute',
          service: labels['sm4rt.kind'] ?? null,
          label: labels['sm4rt.name'] ?? specName,
        });
      }
    }
    return targets.sort((a, b) => a.label.localeCompare(b.label));
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
    const [nodes, reserved] = await Promise.all([
      this.docker.listNodes() as Promise<Array<Record<string, any>>>,
      this.reservedPerNode(),
    ]);
    return nodes
      .map((node) => {
        const id = String(node.ID ?? '');
        const used = reserved.get(id);
        return {
          id,
          hostname: String(node.Description?.Hostname ?? 'unknown'),
          role: (node.Spec?.Role === 'manager' ? 'manager' : 'worker') as 'manager' | 'worker',
          state: String(node.Status?.State ?? 'unknown'),
          addr: node.Status?.Addr ? String(node.Status.Addr) : null,
          cpuTotalMilli: Math.round((node.Description?.Resources?.NanoCPUs ?? 0) / 1e6),
          memTotalBytes: Number(node.Description?.Resources?.MemoryBytes ?? 0),
          cpuUsedMilli: used?.cpuMilli ?? 0,
          memUsedBytes: used?.memBytes ?? 0,
        };
      })
      .sort((a, b) => a.hostname.localeCompare(b.hostname));
  }

  /**
   * How much of each node the pool has already committed, keyed by node id.
   *
   * This sums what running tasks *reserved*, not what their processes are
   * touching right now. That is deliberate: reservations are the same numbers
   * the scheduler uses to decide whether the next workspace fits, so "in use"
   * means the same thing to the admin view and to swarm. Live usage would look
   * lower and would tempt someone to over-commit the pool. Tasks that reserve
   * nothing contribute nothing, which mirrors how swarm treats them.
   */
  private async reservedPerNode(): Promise<Map<string, { cpuMilli: number; memBytes: number }>> {
    const totals = new Map<string, { cpuMilli: number; memBytes: number }>();
    const tasks = (await this.docker.listTasks({
      filters: JSON.stringify({ 'desired-state': ['running'] }),
    })) as Array<Record<string, any>>;
    for (const task of tasks) {
      const nodeId = task.NodeID ? String(task.NodeID) : '';
      if (!nodeId) continue;
      const res = task.Spec?.Resources?.Reservations;
      const cpuMilli = Math.round((res?.NanoCPUs ?? 0) / 1e6);
      const memBytes = Number(res?.MemoryBytes ?? 0);
      if (!cpuMilli && !memBytes) continue;
      const acc = totals.get(nodeId) ?? { cpuMilli: 0, memBytes: 0 };
      acc.cpuMilli += cpuMilli;
      acc.memBytes += memBytes;
      totals.set(nodeId, acc);
    }
    return totals;
  }

  /**
   * Node-level eBPF (Grafana Beyla): fan the action out to the exec agent on
   * every node — each agent runs/removes a privileged pid=host container that
   * swarm services cannot express. Returns one row per reachable agent.
   */
  async ebpfFanout(
    action: 'ensure' | 'remove' | 'status',
    otlpEndpoint: string,
  ): Promise<Array<{ node: string; state: string; error?: string }>> {
    const tasks = (await this.docker.listTasks({
      filters: JSON.stringify({ service: [EXEC_AGENT_SERVICE], 'desired-state': ['running'] }),
    })) as Array<Record<string, any>>;
    const token = process.env.FLOCI_CLOUD_TOKEN ?? '';
    const nodes = new Map<string, string>(); // nodeId -> agent ip
    for (const t of tasks) {
      const nodeId = String(t.NodeID ?? '');
      if (!nodeId || nodes.has(nodeId)) continue;
      const ip = agentTaskAddress(tasks, nodeId, NETWORK_NAME);
      if (ip) nodes.set(nodeId, ip);
    }
    const results = await Promise.all(
      [...nodes.entries()].map(async ([nodeId, ip]) => {
        try {
          const res = await fetch(`http://${ip}:${EXEC_AGENT_PORT}/agent/ebpf`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify({ action, otlpEndpoint, network: NETWORK_NAME }),
            signal: AbortSignal.timeout(120_000),
          });
          const data = (await res.json()) as { node?: string; state?: string; error?: string };
          return {
            node: data.node || nodeId.slice(0, 8),
            state: data.state ?? 'unknown',
            ...(data.error ? { error: data.error } : {}),
          };
        } catch (err) {
          return {
            node: nodeId.slice(0, 8),
            state: 'unreachable',
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
    return results.sort((a, b) => a.node.localeCompare(b.node));
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
