// ComputeManager — real compute primitives for sm4rt-cloud on Docker Swarm.
// VMs (SSH-able distro containers), tasks (user images with public URLs),
// databases, caches, per-workspace API gateways (Caddy), CDN (Varnish),
// DNS records and an LGTM observability stack with automatic discovery.
//
// Deliberately standalone from SwarmDriver: different label namespace
// (sm4rt.*) so compute services never show up as console instances.
import Docker from 'dockerode';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  CACHE_ENGINES,
  CACHE_PORT_RANGE,
  DB_ENGINES,
  DB_PORT_RANGE,
  SM4RT_KIND_LABEL,
  SM4RT_META_LABEL,
  SM4RT_NAME_LABEL,
  SM4RT_WS_LABEL,
  SSH_PORT_RANGE,
  VM_IMAGES,
  VM_PLANS,
  alloyLogsConfig,
  alloyScrapeConfig,
  allocatePort,
  cdnTlsHelperConf,
  cdnVcl,
  gatewayCaddyfile,
  isCacheEngineId,
  isDbEngineId,
  isValidDnsRecordName,
  isValidImageRef,
  isValidResourceName,
  isVmImageId,
  isVmPlanId,
  otelEnvFor,
  parseCdnOrigin,
  vmBootstrapScript,
  type CacheEngineId,
  type DbEngineId,
  type GatewayRoute,
  type ScrapeTarget,
  type VmImageId,
  type VmPlanId,
} from './compute-templates.ts';

const NETWORK_NAME = process.env.SWARM_NETWORK ?? 'floci-net';
const DOCKER_SOCK = process.env.DOCKER_SOCK ?? '/var/run/docker.sock';
const IN_CONTAINER = existsSync('/.dockerenv');

export class ComputeError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function isNotFoundErr(err: unknown): boolean {
  return (err as { statusCode?: number })?.statusCode === 404;
}

function demuxLogs(buf: Buffer): string {
  if (buf.length === 0) return '';
  const first = buf[0] ?? 255;
  const looksMultiplexed = first <= 2 && buf[1] === 0 && buf[2] === 0 && buf[3] === 0;
  if (!looksMultiplexed) return buf.toString('utf8');
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

function cpusToNano(cpus: number): number {
  return Math.round(cpus * 1e9);
}
function mbToBytes(mb: number): number {
  return Math.round(mb * 1024 ** 2);
}

function genPassword(len = 18): string {
  return randomBytes(len).toString('base64url').replace(/[^A-Za-z0-9_-]/g, '').slice(0, len);
}

function shortId(): string {
  return randomBytes(4).toString('hex');
}

interface SvcRaw {
  ID: string;
  Version: { Index: number };
  CreatedAt?: string;
  UpdatedAt?: string;
  Spec: {
    Name: string;
    Labels?: Record<string, string>;
    TaskTemplate?: {
      ContainerSpec?: {
        Image?: string;
        Env?: string[];
        Labels?: Record<string, string>;
        Configs?: Array<{ ConfigID: string; ConfigName: string; File?: { Name: string } }>;
      };
      ForceUpdate?: number;
    };
    Mode?: { Replicated?: { Replicas?: number }; Global?: Record<string, never> };
    EndpointSpec?: { Ports?: Array<{ TargetPort?: number; PublishedPort?: number }> };
  };
  Endpoint?: { Ports?: Array<{ TargetPort?: number; PublishedPort?: number }> };
}

export interface ComputeOptions {
  instanceDomain: string;
  tls: boolean;
}

export interface VmInfo {
  id: string;
  name: string;
  image: VmImageId;
  imageLabel: string;
  plan: VmPlanId;
  planLabel: string;
  state: string;
  desiredReplicas: number;
  sshHost: string;
  sshPort: number;
  sshUser: string;
  sshPassword: string;
  sshCommand: string;
  createdAt: string | null;
}

export interface TaskInfo {
  name: string;
  image: string;
  port: number | null;
  replicas: number;
  runningReplicas: number;
  state: string;
  url: string | null;
  env: Record<string, string>;
  metricsPort: number | null;
  metricsPath: string;
  gitopsApp: string | null;
  gitopsRev: string | null;
  createdAt: string | null;
}

export interface DbInfo {
  name: string;
  engine: DbEngineId;
  engineLabel: string;
  state: string;
  host: string;
  port: number;
  externalPort: number | null;
  externalHost: string | null;
  user: string;
  password: string;
  database: string;
  connectionUri: string;
  createdAt: string | null;
}

export interface CacheInfo {
  name: string;
  engine: CacheEngineId;
  engineLabel: string;
  state: string;
  host: string;
  port: number;
  externalPort: number | null;
  externalHost: string | null;
  password: string;
  connectionUri: string;
  createdAt: string | null;
}

export interface GatewayInfo {
  name: string;
  state: string;
  url: string;
  routes: GatewayRoute[];
  createdAt: string | null;
}

export interface CdnInfo {
  name: string;
  state: string;
  url: string;
  origin: string;
  ttlSeconds: number;
  memory: string;
  createdAt: string | null;
}

export interface DnsRecord {
  record: string;
  fqdn: string;
  type: 'ALIAS' | 'A' | 'CNAME' | 'TXT' | 'MX';
  target: string;
  informational: boolean;
}

export interface ObsInfo {
  state: string;
  grafanaUrl: string;
  grafanaUser: string;
  grafanaPassword: string;
  otlpUrl: string;
  otlpInternal: string;
  scrapeTargets: ScrapeTarget[];
  createdAt: string | null;
}

export class ComputeManager {
  private docker: Docker;
  private opts: ComputeOptions;
  private networkReady = false;

  constructor(opts: ComputeOptions) {
    this.opts = opts;
    this.docker = new Docker({ socketPath: DOCKER_SOCK });
  }

  // — naming —
  private vmService(ws: string, id: string) {
    return `sm4rt-vm-${ws}-${id}`;
  }
  private taskService(ws: string, name: string) {
    return `sm4rt-task-${ws}-${name}`;
  }
  private dbService(ws: string, name: string) {
    return `sm4rt-db-${ws}-${name}`;
  }
  private cacheService(ws: string, name: string) {
    return `sm4rt-cache-${ws}-${name}`;
  }
  private gwService(ws: string, name: string) {
    return `sm4rt-gw-${ws}-${name}`;
  }
  private cdnService(ws: string, name: string) {
    return `sm4rt-cdn-${ws}-${name}`;
  }
  private cdnHelperService(ws: string, name: string) {
    return `sm4rt-cdnh-${ws}-${name}`;
  }
  private obsService(ws: string) {
    return `sm4rt-obs-${ws}`;
  }
  private obsAgentService(ws: string) {
    return `sm4rt-obs-agent-${ws}`;
  }
  private obsScrapeService(ws: string) {
    return `sm4rt-obs-scrape-${ws}`;
  }

  scheme(): string {
    return this.opts.tls ? 'https' : 'http';
  }
  private publicHost(sub: string): string {
    return `${sub}.${this.opts.instanceDomain}`;
  }
  taskUrl(ws: string, task: string): string {
    return `${this.scheme()}://${this.publicHost(`${task}.${ws}`)}`;
  }

  private caddyLabels(host: string, port: number, idx = 0): Record<string, string> {
    const p = idx === 0 ? 'caddy' : `caddy_${idx}`;
    const labels: Record<string, string> = {
      [p]: this.opts.tls ? host : `http://${host}`,
      [`${p}.reverse_proxy`]: `{{upstreams ${port}}}`,
    };
    if (this.opts.tls) labels[`${p}.tls.on_demand`] = '';
    return labels;
  }

  private async ensureNetwork(): Promise<void> {
    if (this.networkReady) return;
    const nets = await this.docker.listNetworks({
      filters: JSON.stringify({ name: [NETWORK_NAME] }),
    });
    if (!nets.some((n) => n.Name === NETWORK_NAME)) {
      await this.docker.createNetwork({ Name: NETWORK_NAME, Driver: 'overlay', Attachable: true });
    }
    this.networkReady = true;
  }

  // — generic service helpers —
  private async listByLabels(labels: string[]): Promise<SvcRaw[]> {
    const svcs = await this.docker.listServices({
      filters: JSON.stringify({ label: labels }),
    });
    return svcs as unknown as SvcRaw[];
  }

  private async getService(name: string): Promise<SvcRaw | null> {
    try {
      const svc = await this.docker.getService(name).inspect();
      return svc as unknown as SvcRaw;
    } catch (err) {
      if (isNotFoundErr(err)) return null;
      throw err;
    }
  }

  private async serviceState(name: string): Promise<{ state: string; running: number }> {
    try {
      const tasks = (await this.docker.listTasks({
        filters: JSON.stringify({ service: [name] }),
      })) as Array<Record<string, any>>;
      const running = tasks.filter(
        (t) => t.Status?.State === 'running' && t.DesiredState === 'running',
      ).length;
      if (running > 0) return { state: 'running', running };
      const sorted = tasks.sort((a, b) =>
        String(b.CreatedAt ?? '').localeCompare(String(a.CreatedAt ?? '')),
      );
      const newest = sorted[0];
      if (!newest) return { state: 'stopped', running: 0 };
      const st = String(newest.Status?.State ?? 'unknown');
      if (newest.Status?.Err) return { state: 'error', running: 0 };
      if (['new', 'pending', 'assigned', 'accepted', 'preparing', 'starting'].includes(st)) {
        return { state: 'starting', running: 0 };
      }
      return { state: st === 'running' ? 'running' : 'stopped', running };
    } catch {
      return { state: 'unknown', running: 0 };
    }
  }

  private meta<T>(svc: SvcRaw): T {
    try {
      return JSON.parse(svc.Spec.Labels?.[SM4RT_META_LABEL] ?? '{}') as T;
    } catch {
      return {} as T;
    }
  }

  private desiredReplicas(svc: SvcRaw): number {
    return svc.Spec.Mode?.Replicated?.Replicas ?? 1;
  }

  private async usedPublishedPorts(): Promise<Set<number>> {
    const svcs = (await this.docker.listServices()) as unknown as SvcRaw[];
    const used = new Set<number>();
    for (const s of svcs) {
      for (const p of s.Spec.EndpointSpec?.Ports ?? []) {
        if (p.PublishedPort) used.add(p.PublishedPort);
      }
      for (const p of s.Endpoint?.Ports ?? []) {
        if (p.PublishedPort) used.add(p.PublishedPort);
      }
    }
    return used;
  }

  private async removeService(name: string): Promise<boolean> {
    try {
      await this.docker.getService(name).remove();
      return true;
    } catch (err) {
      if (isNotFoundErr(err)) return false;
      throw err;
    }
  }

  async serviceLogs(name: string, tail = 200): Promise<string> {
    try {
      const svc = this.docker.getService(name);
      const buf = (await svc.logs({
        stdout: true,
        stderr: true,
        tail,
        timestamps: false,
      })) as unknown as Buffer;
      return demuxLogs(buf);
    } catch (err) {
      if (isNotFoundErr(err)) return '';
      throw err;
    }
  }

  // — docker configs (immutable; rotate with timestamp suffix) —
  private async createConfig(baseName: string, data: string): Promise<string> {
    const name = `${baseName}-${Date.now().toString(36)}`;
    await this.docker.createConfig({
      Name: name,
      Data: Buffer.from(data, 'utf8').toString('base64'),
      Labels: { [SM4RT_KIND_LABEL]: 'config' },
    });
    return name;
  }

  private async removeConfigsByPrefix(prefix: string, except?: string): Promise<void> {
    try {
      const configs = (await this.docker.listConfigs({})) as Array<{
        ID: string;
        Spec?: { Name?: string };
      }>;
      for (const c of configs) {
        const n = c.Spec?.Name ?? '';
        if (n.startsWith(`${prefix}-`) && n !== except) {
          try {
            await this.docker.getConfig(c.ID).remove();
          } catch {
            // in use or already gone — best effort
          }
        }
      }
    } catch {
      // listConfigs unsupported — ignore
    }
  }

  private async configIdFor(name: string): Promise<string> {
    const configs = (await this.docker.listConfigs({
      filters: JSON.stringify({ name: [name] }),
    })) as Array<{ ID: string; Spec?: { Name?: string } }>;
    const found = configs.find((c) => c.Spec?.Name === name);
    if (!found) throw new ComputeError(500, `config ${name} not found after create`);
    return found.ID;
  }

  private configMount(configName: string, configId: string, target: string) {
    return {
      ConfigID: configId,
      ConfigName: configName,
      File: { Name: target, UID: '0', GID: '0', Mode: 0o444 },
    };
  }

  // ————————————————— VMs —————————————————

  private vmInfoFrom(svc: SvcRaw, state: string): VmInfo {
    const m = this.meta<{
      id: string;
      name: string;
      image: VmImageId;
      plan: VmPlanId;
      user: string;
      pass: string;
      sshPort: number;
    }>(svc);
    const sshHost = `${svc.Spec.Labels?.[SM4RT_WS_LABEL]}.${this.opts.instanceDomain}`;
    return {
      id: m.id,
      name: m.name,
      image: m.image,
      imageLabel: VM_IMAGES[m.image]?.label ?? m.image,
      plan: m.plan,
      planLabel: VM_PLANS[m.plan]?.label ?? m.plan,
      state,
      desiredReplicas: this.desiredReplicas(svc),
      sshHost,
      sshPort: m.sshPort,
      sshUser: m.user,
      sshPassword: m.pass,
      sshCommand: `ssh -p ${m.sshPort} ${m.user}@${sshHost}`,
      createdAt: svc.CreatedAt ?? null,
    };
  }

  async listVms(ws: string): Promise<VmInfo[]> {
    const svcs = await this.listByLabels([`${SM4RT_WS_LABEL}=${ws}`, `${SM4RT_KIND_LABEL}=vm`]);
    return Promise.all(
      svcs.map(async (s) => this.vmInfoFrom(s, (await this.serviceState(s.Spec.Name)).state)),
    );
  }

  async createVm(
    ws: string,
    input: { name: string; image: string; plan: string },
  ): Promise<VmInfo> {
    if (!isValidResourceName(input.name)) throw new ComputeError(400, 'invalid VM name');
    if (!isVmImageId(input.image)) throw new ComputeError(400, `unknown image: ${input.image}`);
    if (!isVmPlanId(input.plan)) throw new ComputeError(400, `unknown plan: ${input.plan}`);
    await this.ensureNetwork();
    const existing = await this.listVms(ws);
    if (existing.some((v) => v.name === input.name)) {
      throw new ComputeError(409, `VM "${input.name}" already exists`);
    }
    if (existing.length >= 10) throw new ComputeError(400, 'VM limit reached (10 per workspace)');
    const sshPort = allocatePort(await this.usedPublishedPorts(), SSH_PORT_RANGE);
    if (!sshPort) throw new ComputeError(503, 'no free SSH ports left on the cluster');
    const id = shortId();
    const user = 'sm4rt';
    const pass = genPassword();
    const plan = VM_PLANS[input.plan];
    const img = VM_IMAGES[input.image];
    const meta = { id, name: input.name, image: input.image, plan: input.plan, user, pass, sshPort };
    const serviceName = this.vmService(ws, id);
    const script = vmBootstrapScript(input.image, user, pass);
    await this.docker.createService({
      Name: serviceName,
      Labels: {
        [SM4RT_KIND_LABEL]: 'vm',
        [SM4RT_WS_LABEL]: ws,
        [SM4RT_NAME_LABEL]: input.name,
        [SM4RT_META_LABEL]: JSON.stringify(meta),
      },
      TaskTemplate: {
        ContainerSpec: {
          Image: img.image,
          Command: [img.shell, '-lc', script],
          Labels: { [SM4RT_WS_LABEL]: ws, [SM4RT_KIND_LABEL]: 'vm', [SM4RT_NAME_LABEL]: input.name },
        },
        Resources: {
          Limits: { NanoCPUs: cpusToNano(plan.cpus), MemoryBytes: mbToBytes(plan.memoryMb) },
        },
        RestartPolicy: { Condition: 'any', Delay: 5_000_000_000 },
        Networks: [{ Target: NETWORK_NAME }],
      },
      Mode: { Replicated: { Replicas: 1 } },
      // vip mode: published ports need the ingress routing mesh
      EndpointSpec: {
        Ports: [{ Protocol: 'tcp', TargetPort: 22, PublishedPort: sshPort }],
      },
    });
    const svc = await this.getService(serviceName);
    return this.vmInfoFrom(svc!, 'starting');
  }

  private async findVm(ws: string, id: string): Promise<SvcRaw> {
    const svc = await this.getService(this.vmService(ws, id));
    if (!svc || svc.Spec.Labels?.[SM4RT_WS_LABEL] !== ws) {
      throw new ComputeError(404, `VM ${id} not found`);
    }
    return svc;
  }

  async vmAction(
    ws: string,
    id: string,
    action: 'stop' | 'start' | 'reboot' | 'terminate',
  ): Promise<void> {
    const svc = await this.findVm(ws, id);
    if (action === 'terminate') {
      await this.removeService(svc.Spec.Name);
      return;
    }
    const inspect = (await this.docker.getService(svc.Spec.Name).inspect()) as unknown as SvcRaw & {
      Spec: Record<string, any>;
    };
    const spec = inspect.Spec as Record<string, any>;
    if (action === 'stop') {
      spec.Mode = { Replicated: { Replicas: 0 } };
    } else if (action === 'start') {
      spec.Mode = { Replicated: { Replicas: 1 } };
    } else {
      spec.TaskTemplate = spec.TaskTemplate ?? {};
      spec.TaskTemplate.ForceUpdate = (spec.TaskTemplate.ForceUpdate ?? 0) + 1;
    }
    await this.docker.getService(svc.Spec.Name).update({
      version: inspect.Version.Index,
      ...spec,
    });
  }

  async vmLogs(ws: string, id: string, tail = 200): Promise<string> {
    const svc = await this.findVm(ws, id);
    return this.serviceLogs(svc.Spec.Name, tail);
  }

  // ————————————————— Tasks (ECS-style) —————————————————

  private taskInfoFrom(svc: SvcRaw, state: string, running: number): TaskInfo {
    const m = this.meta<{
      name: string;
      image: string;
      port: number | null;
      env: Record<string, string>;
      metricsPort: number | null;
      metricsPath: string;
    }>(svc);
    const ws = svc.Spec.Labels?.[SM4RT_WS_LABEL] ?? '';
    return {
      name: m.name,
      image: m.image,
      port: m.port ?? null,
      replicas: this.desiredReplicas(svc),
      runningReplicas: running,
      state,
      url: m.port ? this.taskUrl(ws, m.name) : null,
      env: m.env ?? {},
      metricsPort: m.metricsPort ?? null,
      metricsPath: m.metricsPath ?? '/metrics',
      gitopsApp: svc.Spec.Labels?.['sm4rt.gitops.app'] ?? null,
      gitopsRev: svc.Spec.Labels?.['sm4rt.gitops.rev'] ?? null,
      createdAt: svc.CreatedAt ?? null,
    };
  }

  async listTasks(ws: string): Promise<TaskInfo[]> {
    const svcs = await this.listByLabels([`${SM4RT_WS_LABEL}=${ws}`, `${SM4RT_KIND_LABEL}=task`]);
    return Promise.all(
      svcs.map(async (s) => {
        const st = await this.serviceState(s.Spec.Name);
        return this.taskInfoFrom(s, st.state, st.running);
      }),
    );
  }

  private async obsRunning(ws: string): Promise<boolean> {
    return (await this.getService(this.obsService(ws))) !== null;
  }

  async createTask(
    ws: string,
    input: {
      name: string;
      image: string;
      port?: number | null;
      env?: Record<string, string>;
      replicas?: number;
      cpus?: number;
      memoryMb?: number;
      metricsPort?: number | null;
      metricsPath?: string;
      gitopsApp?: string;
      gitopsRev?: string;
    },
  ): Promise<TaskInfo> {
    if (!isValidResourceName(input.name)) throw new ComputeError(400, 'invalid task name');
    if (!isValidImageRef(input.image)) throw new ComputeError(400, 'invalid image reference');
    const port = input.port ?? null;
    if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      throw new ComputeError(400, 'invalid port');
    }
    const replicas = input.replicas ?? 1;
    if (!Number.isInteger(replicas) || replicas < 0 || replicas > 10) {
      throw new ComputeError(400, 'replicas must be 0-10');
    }
    await this.ensureNetwork();
    const serviceName = this.taskService(ws, input.name);
    if (await this.getService(serviceName)) {
      throw new ComputeError(409, `task "${input.name}" already exists`);
    }
    const spec = await this.taskSpec(ws, { ...input, port, replicas });
    await this.docker.createService(spec);
    await this.syncObsScrape(ws).catch(() => {});
    const svc = await this.getService(serviceName);
    return this.taskInfoFrom(svc!, 'starting', 0);
  }

  private async taskSpec(
    ws: string,
    input: {
      name: string;
      image: string;
      port: number | null;
      env?: Record<string, string>;
      replicas: number;
      cpus?: number;
      memoryMb?: number;
      metricsPort?: number | null;
      metricsPath?: string;
      gitopsApp?: string;
      gitopsRev?: string;
    },
  ): Promise<Docker.CreateServiceOptions> {
    const serviceName = this.taskService(ws, input.name);
    const env: string[] = Object.entries(input.env ?? {}).map(([k, v]) => `${k}=${v}`);
    if (await this.obsRunning(ws)) {
      const injected = otelEnvFor(ws, input.name, this.obsService(ws));
      const userKeys = new Set(Object.keys(input.env ?? {}));
      for (const e of injected) {
        if (!userKeys.has(e.split('=')[0]!)) env.push(e);
      }
    }
    const meta = {
      name: input.name,
      image: input.image,
      port: input.port,
      env: input.env ?? {},
      metricsPort: input.metricsPort ?? null,
      metricsPath: input.metricsPath ?? '/metrics',
    };
    const labels: Record<string, string> = {
      [SM4RT_KIND_LABEL]: 'task',
      [SM4RT_WS_LABEL]: ws,
      [SM4RT_NAME_LABEL]: input.name,
      [SM4RT_META_LABEL]: JSON.stringify(meta),
    };
    if (input.gitopsApp) labels['sm4rt.gitops.app'] = input.gitopsApp;
    if (input.gitopsRev) labels['sm4rt.gitops.rev'] = input.gitopsRev;
    if (input.port) {
      Object.assign(labels, this.caddyLabels(this.publicHost(`${input.name}.${ws}`), input.port));
    }
    const cpus = input.cpus ?? 0.5;
    const memoryMb = input.memoryMb ?? 512;
    return {
      Name: serviceName,
      Labels: labels,
      TaskTemplate: {
        ContainerSpec: {
          Image: input.image,
          Env: env,
          Labels: {
            [SM4RT_WS_LABEL]: ws,
            [SM4RT_KIND_LABEL]: 'task',
            [SM4RT_NAME_LABEL]: input.name,
          },
        },
        Resources: {
          Limits: { NanoCPUs: cpusToNano(cpus), MemoryBytes: mbToBytes(memoryMb) },
        },
        RestartPolicy: { Condition: 'any', Delay: 5_000_000_000 },
        Networks: [{ Target: NETWORK_NAME, Aliases: [serviceName] }],
      },
      Mode: { Replicated: { Replicas: input.replicas } },
      EndpointSpec: { Mode: 'dnsrr' },
    };
  }

  private async findTask(ws: string, name: string): Promise<SvcRaw> {
    const svc = await this.getService(this.taskService(ws, name));
    if (!svc || svc.Spec.Labels?.[SM4RT_WS_LABEL] !== ws) {
      throw new ComputeError(404, `task "${name}" not found`);
    }
    return svc;
  }

  async updateTask(
    ws: string,
    name: string,
    patch: {
      image?: string;
      port?: number | null;
      env?: Record<string, string>;
      replicas?: number;
      metricsPort?: number | null;
      metricsPath?: string;
      gitopsRev?: string;
    },
  ): Promise<TaskInfo> {
    const svc = await this.findTask(ws, name);
    const m = this.meta<{
      name: string;
      image: string;
      port: number | null;
      env: Record<string, string>;
      metricsPort: number | null;
      metricsPath: string;
    }>(svc);
    if (patch.image !== undefined && !isValidImageRef(patch.image)) {
      throw new ComputeError(400, 'invalid image reference');
    }
    const merged = {
      name,
      image: patch.image ?? m.image,
      port: patch.port !== undefined ? patch.port : m.port,
      env: patch.env ?? m.env ?? {},
      replicas: patch.replicas ?? this.desiredReplicas(svc),
      metricsPort: patch.metricsPort !== undefined ? patch.metricsPort : m.metricsPort,
      metricsPath: patch.metricsPath ?? m.metricsPath ?? '/metrics',
      gitopsApp: svc.Spec.Labels?.['sm4rt.gitops.app'] ?? undefined,
      gitopsRev: patch.gitopsRev ?? svc.Spec.Labels?.['sm4rt.gitops.rev'] ?? undefined,
    };
    if (!Number.isInteger(merged.replicas) || merged.replicas < 0 || merged.replicas > 10) {
      throw new ComputeError(400, 'replicas must be 0-10');
    }
    // preserve any DNS alias labels that were attached to this task service
    const spec = await this.taskSpec(ws, merged);
    const extraLabels: Record<string, string> = {};
    for (const [k, v] of Object.entries(svc.Spec.Labels ?? {})) {
      if (k.startsWith('sm4rt.dns.') || /^caddy_\d+/.test(k)) extraLabels[k] = v;
    }
    Object.assign(spec.Labels!, extraLabels);
    await this.docker.getService(svc.Spec.Name).update({
      version: svc.Version.Index,
      ...spec,
    });
    await this.syncObsScrape(ws).catch(() => {});
    const after = await this.getService(svc.Spec.Name);
    const st = await this.serviceState(svc.Spec.Name);
    return this.taskInfoFrom(after!, st.state, st.running);
  }

  async taskAction(ws: string, name: string, action: 'restart' | 'delete'): Promise<void> {
    const svc = await this.findTask(ws, name);
    if (action === 'delete') {
      await this.removeService(svc.Spec.Name);
      await this.syncObsScrape(ws).catch(() => {});
      return;
    }
    const inspect = (await this.docker.getService(svc.Spec.Name).inspect()) as unknown as SvcRaw;
    const spec = inspect.Spec as Record<string, any>;
    spec.TaskTemplate = spec.TaskTemplate ?? {};
    spec.TaskTemplate.ForceUpdate = (spec.TaskTemplate.ForceUpdate ?? 0) + 1;
    await this.docker.getService(svc.Spec.Name).update({ version: inspect.Version.Index, ...spec });
  }

  async taskLogs(ws: string, name: string, tail = 200): Promise<string> {
    const svc = await this.findTask(ws, name);
    return this.serviceLogs(svc.Spec.Name, tail);
  }

  // ————————————————— Databases —————————————————

  private dbInfoFrom(svc: SvcRaw, state: string): DbInfo {
    const m = this.meta<{
      name: string;
      engine: DbEngineId;
      pass: string;
      externalPort: number | null;
    }>(svc);
    const eng = DB_ENGINES[m.engine];
    const host = svc.Spec.Name;
    const proto = m.engine === 'postgres-16' ? 'postgresql' : 'mysql';
    return {
      name: m.name,
      engine: m.engine,
      engineLabel: eng?.label ?? m.engine,
      state,
      host,
      port: eng?.port ?? 5432,
      externalPort: m.externalPort ?? null,
      externalHost: m.externalPort
        ? `${svc.Spec.Labels?.[SM4RT_WS_LABEL]}.${this.opts.instanceDomain}`
        : null,
      user: eng?.user ?? 'sm4rt',
      password: m.pass,
      database: eng?.database ?? 'app',
      connectionUri: `${proto}://${eng?.user}:${m.pass}@${host}:${eng?.port}/${eng?.database}`,
      createdAt: svc.CreatedAt ?? null,
    };
  }

  async listDatabases(ws: string): Promise<DbInfo[]> {
    const svcs = await this.listByLabels([`${SM4RT_WS_LABEL}=${ws}`, `${SM4RT_KIND_LABEL}=db`]);
    return Promise.all(
      svcs.map(async (s) => this.dbInfoFrom(s, (await this.serviceState(s.Spec.Name)).state)),
    );
  }

  async createDatabase(
    ws: string,
    input: { name: string; engine: string; external?: boolean },
  ): Promise<DbInfo> {
    if (!isValidResourceName(input.name)) throw new ComputeError(400, 'invalid database name');
    if (!isDbEngineId(input.engine)) throw new ComputeError(400, `unknown engine: ${input.engine}`);
    await this.ensureNetwork();
    const serviceName = this.dbService(ws, input.name);
    if (await this.getService(serviceName)) {
      throw new ComputeError(409, `database "${input.name}" already exists`);
    }
    const eng = DB_ENGINES[input.engine];
    const pass = genPassword();
    let externalPort: number | null = null;
    if (input.external) {
      externalPort = allocatePort(await this.usedPublishedPorts(), DB_PORT_RANGE);
      if (!externalPort) throw new ComputeError(503, 'no free database ports on the cluster');
    }
    const env: string[] = [];
    if (input.engine === 'postgres-16') {
      env.push(
        `POSTGRES_PASSWORD=${pass}`,
        `POSTGRES_USER=${eng.user}`,
        `POSTGRES_DB=${eng.database}`,
        'PGDATA=/var/lib/postgresql/data/pgdata',
      );
    } else if (input.engine === 'mysql-8') {
      env.push(
        `MYSQL_ROOT_PASSWORD=${pass}`,
        `MYSQL_DATABASE=${eng.database}`,
        `MYSQL_USER=${eng.user}`,
        `MYSQL_PASSWORD=${pass}`,
      );
    } else {
      env.push(
        `MARIADB_ROOT_PASSWORD=${pass}`,
        `MARIADB_DATABASE=${eng.database}`,
        `MARIADB_USER=${eng.user}`,
        `MARIADB_PASSWORD=${pass}`,
      );
    }
    const meta = { name: input.name, engine: input.engine, pass, externalPort };
    const volumeName = `${serviceName}-data`;
    const spec: Docker.CreateServiceOptions = {
      Name: serviceName,
      Labels: {
        [SM4RT_KIND_LABEL]: 'db',
        [SM4RT_WS_LABEL]: ws,
        [SM4RT_NAME_LABEL]: input.name,
        [SM4RT_META_LABEL]: JSON.stringify(meta),
      },
      TaskTemplate: {
        ContainerSpec: {
          Image: eng.image,
          Env: env,
          Labels: { [SM4RT_WS_LABEL]: ws, [SM4RT_KIND_LABEL]: 'db', [SM4RT_NAME_LABEL]: input.name },
          Mounts: [
            {
              Type: 'volume',
              Source: volumeName,
              Target: eng.dataDir,
              VolumeOptions: { Labels: { [SM4RT_WS_LABEL]: ws } },
            } as unknown as Docker.MountSettings,
          ],
        },
        Resources: { Limits: { NanoCPUs: cpusToNano(1), MemoryBytes: mbToBytes(1024) } },
        RestartPolicy: { Condition: 'any', Delay: 5_000_000_000 },
        Networks: [{ Target: NETWORK_NAME, Aliases: [serviceName] }],
      },
      Mode: { Replicated: { Replicas: 1 } },
      EndpointSpec: externalPort
        ? { Ports: [{ Protocol: 'tcp', TargetPort: eng.port, PublishedPort: externalPort }] }
        : { Mode: 'dnsrr' },
    };
    await this.docker.createService(spec);
    const svc = await this.getService(serviceName);
    return this.dbInfoFrom(svc!, 'starting');
  }

  async deleteDatabase(ws: string, name: string): Promise<void> {
    const svc = await this.getService(this.dbService(ws, name));
    if (!svc || svc.Spec.Labels?.[SM4RT_WS_LABEL] !== ws) {
      throw new ComputeError(404, `database "${name}" not found`);
    }
    await this.removeService(svc.Spec.Name);
  }

  async databaseLogs(ws: string, name: string, tail = 200): Promise<string> {
    const svc = await this.getService(this.dbService(ws, name));
    if (!svc) throw new ComputeError(404, `database "${name}" not found`);
    return this.serviceLogs(svc.Spec.Name, tail);
  }

  // ————————————————— Caches —————————————————

  private cacheInfoFrom(svc: SvcRaw, state: string): CacheInfo {
    const m = this.meta<{
      name: string;
      engine: CacheEngineId;
      pass: string;
      externalPort: number | null;
    }>(svc);
    const eng = CACHE_ENGINES[m.engine];
    const host = svc.Spec.Name;
    return {
      name: m.name,
      engine: m.engine,
      engineLabel: eng?.label ?? m.engine,
      state,
      host,
      port: eng?.port ?? 6379,
      externalPort: m.externalPort ?? null,
      externalHost: m.externalPort
        ? `${svc.Spec.Labels?.[SM4RT_WS_LABEL]}.${this.opts.instanceDomain}`
        : null,
      password: m.pass,
      connectionUri: `redis://:${m.pass}@${host}:${eng?.port ?? 6379}`,
      createdAt: svc.CreatedAt ?? null,
    };
  }

  async listCaches(ws: string): Promise<CacheInfo[]> {
    const svcs = await this.listByLabels([`${SM4RT_WS_LABEL}=${ws}`, `${SM4RT_KIND_LABEL}=cache`]);
    return Promise.all(
      svcs.map(async (s) => this.cacheInfoFrom(s, (await this.serviceState(s.Spec.Name)).state)),
    );
  }

  async createCache(
    ws: string,
    input: { name: string; engine: string; external?: boolean },
  ): Promise<CacheInfo> {
    if (!isValidResourceName(input.name)) throw new ComputeError(400, 'invalid cache name');
    if (!isCacheEngineId(input.engine)) {
      throw new ComputeError(400, `unknown engine: ${input.engine}`);
    }
    await this.ensureNetwork();
    const serviceName = this.cacheService(ws, input.name);
    if (await this.getService(serviceName)) {
      throw new ComputeError(409, `cache "${input.name}" already exists`);
    }
    const eng = CACHE_ENGINES[input.engine];
    const pass = genPassword();
    let externalPort: number | null = null;
    if (input.external) {
      externalPort = allocatePort(await this.usedPublishedPorts(), CACHE_PORT_RANGE);
      if (!externalPort) throw new ComputeError(503, 'no free cache ports on the cluster');
    }
    const meta = { name: input.name, engine: input.engine, pass, externalPort };
    await this.docker.createService({
      Name: serviceName,
      Labels: {
        [SM4RT_KIND_LABEL]: 'cache',
        [SM4RT_WS_LABEL]: ws,
        [SM4RT_NAME_LABEL]: input.name,
        [SM4RT_META_LABEL]: JSON.stringify(meta),
      },
      TaskTemplate: {
        ContainerSpec: {
          Image: eng.image,
          Args: ['redis-server', '--requirepass', pass, '--appendonly', 'no'],
          Labels: {
            [SM4RT_WS_LABEL]: ws,
            [SM4RT_KIND_LABEL]: 'cache',
            [SM4RT_NAME_LABEL]: input.name,
          },
        },
        Resources: { Limits: { NanoCPUs: cpusToNano(0.5), MemoryBytes: mbToBytes(512) } },
        RestartPolicy: { Condition: 'any', Delay: 5_000_000_000 },
        Networks: [{ Target: NETWORK_NAME, Aliases: [serviceName] }],
      },
      Mode: { Replicated: { Replicas: 1 } },
      EndpointSpec: externalPort
        ? { Ports: [{ Protocol: 'tcp', TargetPort: eng.port, PublishedPort: externalPort }] }
        : { Mode: 'dnsrr' },
    });
    const svc = await this.getService(serviceName);
    return this.cacheInfoFrom(svc!, 'starting');
  }

  async deleteCache(ws: string, name: string): Promise<void> {
    const svc = await this.getService(this.cacheService(ws, name));
    if (!svc || svc.Spec.Labels?.[SM4RT_WS_LABEL] !== ws) {
      throw new ComputeError(404, `cache "${name}" not found`);
    }
    await this.removeService(svc.Spec.Name);
  }

  // ————————————————— API Gateways —————————————————

  private gwInfoFrom(svc: SvcRaw, state: string): GatewayInfo {
    const m = this.meta<{ name: string; routes: GatewayRoute[] }>(svc);
    const ws = svc.Spec.Labels?.[SM4RT_WS_LABEL] ?? '';
    return {
      name: m.name,
      state,
      url: `${this.scheme()}://${this.publicHost(`${m.name}-gw.${ws}`)}`,
      routes: m.routes ?? [],
      createdAt: svc.CreatedAt ?? null,
    };
  }

  async listGateways(ws: string): Promise<GatewayInfo[]> {
    const svcs = await this.listByLabels([
      `${SM4RT_WS_LABEL}=${ws}`,
      `${SM4RT_KIND_LABEL}=gateway`,
    ]);
    return Promise.all(
      svcs.map(async (s) => this.gwInfoFrom(s, (await this.serviceState(s.Spec.Name)).state)),
    );
  }

  private async buildGwCaddyfile(ws: string, routes: GatewayRoute[]): Promise<string> {
    const tasks = await this.listTasks(ws);
    const byName = new Map(tasks.map((t) => [t.name, t]));
    return gatewayCaddyfile(
      routes,
      (task) => this.taskService(ws, task),
      (task) => byName.get(task)?.port ?? null,
    );
  }

  async createGateway(
    ws: string,
    input: { name: string; routes: GatewayRoute[] },
  ): Promise<GatewayInfo> {
    if (!isValidResourceName(input.name)) throw new ComputeError(400, 'invalid gateway name');
    if (!Array.isArray(input.routes) || input.routes.length === 0) {
      throw new ComputeError(400, 'at least one route is required');
    }
    if (input.routes.length > 30) throw new ComputeError(400, 'too many routes (max 30)');
    await this.ensureNetwork();
    const serviceName = this.gwService(ws, input.name);
    if (await this.getService(serviceName)) {
      throw new ComputeError(409, `gateway "${input.name}" already exists`);
    }
    let caddyfile: string;
    try {
      caddyfile = await this.buildGwCaddyfile(ws, input.routes);
    } catch (err) {
      throw new ComputeError(400, (err as Error).message);
    }
    const configName = await this.createConfig(`${serviceName}-cfg`, caddyfile);
    const configId = await this.configIdFor(configName);
    const meta = { name: input.name, routes: input.routes };
    await this.docker.createService({
      Name: serviceName,
      Labels: {
        [SM4RT_KIND_LABEL]: 'gateway',
        [SM4RT_WS_LABEL]: ws,
        [SM4RT_NAME_LABEL]: input.name,
        [SM4RT_META_LABEL]: JSON.stringify(meta),
        ...this.caddyLabels(this.publicHost(`${input.name}-gw.${ws}`), 8080),
      },
      TaskTemplate: {
        ContainerSpec: {
          Image: 'caddy:2-alpine',
          Args: ['caddy', 'run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'],
          Labels: {
            [SM4RT_WS_LABEL]: ws,
            [SM4RT_KIND_LABEL]: 'gateway',
            [SM4RT_NAME_LABEL]: input.name,
          },
          Configs: [this.configMount(configName, configId, '/etc/caddy/Caddyfile')],
        },
        Resources: { Limits: { NanoCPUs: cpusToNano(0.5), MemoryBytes: mbToBytes(256) } },
        RestartPolicy: { Condition: 'any', Delay: 5_000_000_000 },
        Networks: [{ Target: NETWORK_NAME, Aliases: [serviceName] }],
      },
      Mode: { Replicated: { Replicas: 1 } },
      EndpointSpec: { Mode: 'dnsrr' },
    } as Docker.CreateServiceOptions);
    const svc = await this.getService(serviceName);
    return this.gwInfoFrom(svc!, 'starting');
  }

  async updateGateway(ws: string, name: string, routes: GatewayRoute[]): Promise<GatewayInfo> {
    if (!Array.isArray(routes) || routes.length === 0) {
      throw new ComputeError(400, 'at least one route is required');
    }
    const serviceName = this.gwService(ws, name);
    const svc = await this.getService(serviceName);
    if (!svc || svc.Spec.Labels?.[SM4RT_WS_LABEL] !== ws) {
      throw new ComputeError(404, `gateway "${name}" not found`);
    }
    let caddyfile: string;
    try {
      caddyfile = await this.buildGwCaddyfile(ws, routes);
    } catch (err) {
      throw new ComputeError(400, (err as Error).message);
    }
    const configName = await this.createConfig(`${serviceName}-cfg`, caddyfile);
    const configId = await this.configIdFor(configName);
    const spec = svc.Spec as Record<string, any>;
    spec.Labels[SM4RT_META_LABEL] = JSON.stringify({ name, routes });
    spec.TaskTemplate.ContainerSpec.Configs = [
      this.configMount(configName, configId, '/etc/caddy/Caddyfile'),
    ];
    spec.TaskTemplate.ForceUpdate = (spec.TaskTemplate.ForceUpdate ?? 0) + 1;
    await this.docker.getService(serviceName).update({ version: svc.Version.Index, ...spec });
    await this.removeConfigsByPrefix(`${serviceName}-cfg`, configName);
    const after = await this.getService(serviceName);
    return this.gwInfoFrom(after!, (await this.serviceState(serviceName)).state);
  }

  async deleteGateway(ws: string, name: string): Promise<void> {
    const serviceName = this.gwService(ws, name);
    const svc = await this.getService(serviceName);
    if (!svc || svc.Spec.Labels?.[SM4RT_WS_LABEL] !== ws) {
      throw new ComputeError(404, `gateway "${name}" not found`);
    }
    await this.removeService(serviceName);
    await this.removeConfigsByPrefix(`${serviceName}-cfg`);
  }

  // ————————————————— CDN (Varnish) —————————————————

  private cdnInfoFrom(svc: SvcRaw, state: string): CdnInfo {
    const m = this.meta<{ name: string; origin: string; ttl: number; memory: string }>(svc);
    const ws = svc.Spec.Labels?.[SM4RT_WS_LABEL] ?? '';
    return {
      name: m.name,
      state,
      url: `${this.scheme()}://${this.publicHost(`${m.name}-cdn.${ws}`)}`,
      origin: m.origin,
      ttlSeconds: m.ttl,
      memory: m.memory,
      createdAt: svc.CreatedAt ?? null,
    };
  }

  async listCdns(ws: string): Promise<CdnInfo[]> {
    const svcs = await this.listByLabels([`${SM4RT_WS_LABEL}=${ws}`, `${SM4RT_KIND_LABEL}=cdn`]);
    return Promise.all(
      svcs.map(async (s) => this.cdnInfoFrom(s, (await this.serviceState(s.Spec.Name)).state)),
    );
  }

  async createCdn(
    ws: string,
    input: { name: string; origin: string; ttlSeconds?: number },
  ): Promise<CdnInfo> {
    if (!isValidResourceName(input.name)) throw new ComputeError(400, 'invalid CDN name');
    let parsed: ReturnType<typeof parseCdnOrigin>;
    try {
      parsed = parseCdnOrigin(input.origin);
    } catch (err) {
      throw new ComputeError(400, (err as Error).message);
    }
    const ttl = input.ttlSeconds ?? 300;
    await this.ensureNetwork();
    const serviceName = this.cdnService(ws, input.name);
    if (await this.getService(serviceName)) {
      throw new ComputeError(409, `CDN "${input.name}" already exists`);
    }
    const helperName = this.cdnHelperService(ws, input.name);
    // https origin: varnish OSS has no TLS backend support — nginx helper terminates it
    if (parsed.scheme === 'https') {
      const helperConf = cdnTlsHelperConf(parsed.host, parsed.port);
      const hcfgName = await this.createConfig(`${helperName}-cfg`, helperConf);
      const hcfgId = await this.configIdFor(hcfgName);
      await this.docker.createService({
        Name: helperName,
        Labels: {
          [SM4RT_KIND_LABEL]: 'cdn-helper',
          [SM4RT_WS_LABEL]: ws,
          [SM4RT_NAME_LABEL]: input.name,
        },
        TaskTemplate: {
          ContainerSpec: {
            Image: 'nginx:1.27-alpine',
            Labels: {
              [SM4RT_WS_LABEL]: ws,
              [SM4RT_KIND_LABEL]: 'cdn-helper',
              [SM4RT_NAME_LABEL]: input.name,
            },
            Configs: [this.configMount(hcfgName, hcfgId, '/etc/nginx/nginx.conf')],
          },
          Resources: { Limits: { NanoCPUs: cpusToNano(0.25), MemoryBytes: mbToBytes(128) } },
          RestartPolicy: { Condition: 'any', Delay: 5_000_000_000 },
          Networks: [{ Target: NETWORK_NAME, Aliases: [helperName] }],
        },
        Mode: { Replicated: { Replicas: 1 } },
        EndpointSpec: { Mode: 'dnsrr' },
      } as Docker.CreateServiceOptions);
    }
    const backend =
      parsed.scheme === 'https'
        ? { host: helperName, port: 8080, hostHeader: parsed.host }
        : { host: parsed.host, port: parsed.port, hostHeader: parsed.host };
    const vcl = cdnVcl(input.name, backend, ttl);
    const cfgName = await this.createConfig(`${serviceName}-vcl`, vcl);
    const cfgId = await this.configIdFor(cfgName);
    const memory = '256m';
    const meta = { name: input.name, origin: input.origin, ttl, memory };
    await this.docker.createService({
      Name: serviceName,
      Labels: {
        [SM4RT_KIND_LABEL]: 'cdn',
        [SM4RT_WS_LABEL]: ws,
        [SM4RT_NAME_LABEL]: input.name,
        [SM4RT_META_LABEL]: JSON.stringify(meta),
        ...this.caddyLabels(this.publicHost(`${input.name}-cdn.${ws}`), 80),
      },
      TaskTemplate: {
        ContainerSpec: {
          Image: 'varnish:7.6',
          Env: [`VARNISH_SIZE=${memory}`],
          Labels: {
            [SM4RT_WS_LABEL]: ws,
            [SM4RT_KIND_LABEL]: 'cdn',
            [SM4RT_NAME_LABEL]: input.name,
          },
          Configs: [this.configMount(cfgName, cfgId, '/etc/varnish/default.vcl')],
        },
        Resources: { Limits: { NanoCPUs: cpusToNano(0.5), MemoryBytes: mbToBytes(512) } },
        RestartPolicy: { Condition: 'any', Delay: 5_000_000_000 },
        Networks: [{ Target: NETWORK_NAME, Aliases: [serviceName] }],
      },
      Mode: { Replicated: { Replicas: 1 } },
      EndpointSpec: { Mode: 'dnsrr' },
    } as Docker.CreateServiceOptions);
    const svc = await this.getService(serviceName);
    return this.cdnInfoFrom(svc!, 'starting');
  }

  /** Purge = rolling restart; Varnish malloc storage empties on restart. */
  async purgeCdn(ws: string, name: string): Promise<void> {
    const serviceName = this.cdnService(ws, name);
    const svc = await this.getService(serviceName);
    if (!svc || svc.Spec.Labels?.[SM4RT_WS_LABEL] !== ws) {
      throw new ComputeError(404, `CDN "${name}" not found`);
    }
    const spec = svc.Spec as Record<string, any>;
    spec.TaskTemplate.ForceUpdate = (spec.TaskTemplate.ForceUpdate ?? 0) + 1;
    await this.docker.getService(serviceName).update({ version: svc.Version.Index, ...spec });
  }

  async deleteCdn(ws: string, name: string): Promise<void> {
    const serviceName = this.cdnService(ws, name);
    const svc = await this.getService(serviceName);
    if (!svc || svc.Spec.Labels?.[SM4RT_WS_LABEL] !== ws) {
      throw new ComputeError(404, `CDN "${name}" not found`);
    }
    await this.removeService(serviceName);
    await this.removeService(this.cdnHelperService(ws, name));
    await this.removeConfigsByPrefix(`${serviceName}-vcl`);
    await this.removeConfigsByPrefix(`${this.cdnHelperService(ws, name)}-cfg`);
  }

  // ————————————————— DNS —————————————————

  /**
   * ALIAS records add a caddy_<i> site label to the *target* service so the
   * edge proxy serves the extra hostname. Label-only updates do not restart
   * swarm tasks. A/TXT/CNAME/MX records are stored as informational labels on
   * the workspace instance service (this cloud does not run its own
   * authoritative DNS — the wildcard *.domain already points at the cluster).
   */
  async listDns(ws: string): Promise<DnsRecord[]> {
    const out: DnsRecord[] = [];
    const svcs = await this.listByLabels([`${SM4RT_WS_LABEL}=${ws}`]);
    for (const s of svcs) {
      for (const [k, v] of Object.entries(s.Spec.Labels ?? {})) {
        if (k.startsWith('sm4rt.dns.')) {
          try {
            const rec = JSON.parse(v) as { type: 'ALIAS'; target: string };
            const record = k.slice('sm4rt.dns.'.length);
            out.push({
              record,
              fqdn: this.publicHost(`${record}.${ws}`),
              type: 'ALIAS',
              target: rec.target,
              informational: false,
            });
          } catch {
            // skip malformed
          }
        }
      }
    }
    const inst = await this.getService(`floci-i-${ws}`);
    for (const [k, v] of Object.entries(inst?.Spec.Labels ?? {})) {
      if (k.startsWith('sm4rt.dnsinfo.')) {
        try {
          const rec = JSON.parse(v) as { type: DnsRecord['type']; target: string };
          const record = k.slice('sm4rt.dnsinfo.'.length);
          out.push({
            record,
            fqdn: this.publicHost(`${record}.${ws}`),
            type: rec.type,
            target: rec.target,
            informational: true,
          });
        } catch {
          // skip malformed
        }
      }
    }
    return out.sort((a, b) => a.record.localeCompare(b.record));
  }

  private nextCaddyIdx(labels: Record<string, string>): number {
    let max = 9;
    for (const k of Object.keys(labels)) {
      const m = /^caddy_(\d+)$/.exec(k);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max + 1;
  }

  async createDns(
    ws: string,
    input: { record: string; type: string; target: string },
  ): Promise<DnsRecord> {
    if (!isValidDnsRecordName(input.record)) throw new ComputeError(400, 'invalid record name');
    const type = input.type.toUpperCase();
    const existing = await this.listDns(ws);
    if (existing.some((r) => r.record === input.record)) {
      throw new ComputeError(409, `record "${input.record}" already exists`);
    }
    if (type === 'ALIAS') {
      // target: task name in this workspace
      const svc = await this.findTask(ws, input.target).catch(() => null);
      if (!svc) throw new ComputeError(400, `ALIAS target must be an existing task`);
      const m = this.meta<{ port: number | null }>(svc);
      if (!m.port) throw new ComputeError(400, `task "${input.target}" exposes no HTTP port`);
      const spec = svc.Spec as Record<string, any>;
      const idx = this.nextCaddyIdx(spec.Labels ?? {});
      const host = this.publicHost(`${input.record}.${ws}`);
      Object.assign(spec.Labels, this.caddyLabels(host, m.port, idx));
      spec.Labels[`sm4rt.dns.${input.record}`] = JSON.stringify({
        type: 'ALIAS',
        target: input.target,
        caddyIdx: idx,
      });
      await this.docker.getService(svc.Spec.Name).update({ version: svc.Version.Index, ...spec });
      return {
        record: input.record,
        fqdn: host,
        type: 'ALIAS',
        target: input.target,
        informational: false,
      };
    }
    if (!['A', 'CNAME', 'TXT', 'MX'].includes(type)) {
      throw new ComputeError(400, `unsupported record type: ${type}`);
    }
    if (input.target.length > 500) throw new ComputeError(400, 'target too long');
    const inst = await this.getService(`floci-i-${ws}`);
    if (!inst) throw new ComputeError(404, `workspace "${ws}" not found`);
    const spec = inst.Spec as Record<string, any>;
    spec.Labels[`sm4rt.dnsinfo.${input.record}`] = JSON.stringify({ type, target: input.target });
    await this.docker.getService(inst.Spec.Name).update({ version: inst.Version.Index, ...spec });
    return {
      record: input.record,
      fqdn: this.publicHost(`${input.record}.${ws}`),
      type: type as DnsRecord['type'],
      target: input.target,
      informational: true,
    };
  }

  async deleteDns(ws: string, record: string): Promise<void> {
    const svcs = await this.listByLabels([`${SM4RT_WS_LABEL}=${ws}`]);
    for (const s of svcs) {
      const key = `sm4rt.dns.${record}`;
      if (s.Spec.Labels?.[key]) {
        const spec = s.Spec as Record<string, any>;
        let caddyIdx: number | null = null;
        try {
          caddyIdx = (JSON.parse(spec.Labels[key]) as { caddyIdx?: number }).caddyIdx ?? null;
        } catch {
          // ignore
        }
        delete spec.Labels[key];
        if (caddyIdx !== null) {
          for (const k of Object.keys(spec.Labels)) {
            if (k === `caddy_${caddyIdx}` || k.startsWith(`caddy_${caddyIdx}.`)) {
              delete spec.Labels[k];
            }
          }
        }
        await this.docker.getService(s.Spec.Name).update({ version: s.Version.Index, ...spec });
        return;
      }
    }
    const inst = await this.getService(`floci-i-${ws}`);
    const infoKey = `sm4rt.dnsinfo.${record}`;
    if (inst?.Spec.Labels?.[infoKey]) {
      const spec = inst.Spec as Record<string, any>;
      delete spec.Labels[infoKey];
      await this.docker.getService(inst.Spec.Name).update({ version: inst.Version.Index, ...spec });
      return;
    }
    throw new ComputeError(404, `record "${record}" not found`);
  }

  // ————————————————— Observability (LGTM + discovery) —————————————————

  private obsInfoFrom(svc: SvcRaw, state: string, targets: ScrapeTarget[]): ObsInfo {
    const m = this.meta<{ grafanaPass: string }>(svc);
    const ws = svc.Spec.Labels?.[SM4RT_WS_LABEL] ?? '';
    return {
      state,
      grafanaUrl: `${this.scheme()}://${this.publicHost(`obs.${ws}`)}`,
      grafanaUser: 'admin',
      grafanaPassword: m.grafanaPass,
      otlpUrl: `${this.scheme()}://${this.publicHost(`otlp.${ws}`)}`,
      otlpInternal: `http://${this.obsService(ws)}:4318`,
      scrapeTargets: targets,
      createdAt: svc.CreatedAt ?? null,
    };
  }

  async getObservability(ws: string): Promise<ObsInfo | null> {
    const svc = await this.getService(this.obsService(ws));
    if (!svc) return null;
    const targets = await this.currentScrapeTargets(ws);
    return this.obsInfoFrom(svc, (await this.serviceState(svc.Spec.Name)).state, targets);
  }

  private async currentScrapeTargets(ws: string): Promise<ScrapeTarget[]> {
    const tasks = await this.listTasks(ws);
    return tasks
      .filter((t) => t.metricsPort)
      .map((t) => ({
        taskName: t.name,
        serviceHost: this.taskService(ws, t.name),
        port: t.metricsPort!,
        path: t.metricsPath || '/metrics',
      }));
  }

  async enableObservability(ws: string): Promise<ObsInfo> {
    await this.ensureNetwork();
    const obsName = this.obsService(ws);
    if (await this.getService(obsName)) {
      throw new ComputeError(409, 'observability stack already enabled');
    }
    const grafanaPass = genPassword(16);
    const meta = { grafanaPass };
    // grafana/otel-lgtm: Grafana:3000, OTLP http:4318 grpc:4317, Prom:9090 (remote-write), Loki:3100
    const labels: Record<string, string> = {
      [SM4RT_KIND_LABEL]: 'obs',
      [SM4RT_WS_LABEL]: ws,
      [SM4RT_NAME_LABEL]: 'obs',
      [SM4RT_META_LABEL]: JSON.stringify(meta),
      ...this.caddyLabels(this.publicHost(`obs.${ws}`), 3000, 0),
      ...this.caddyLabels(this.publicHost(`otlp.${ws}`), 4318, 1),
    };
    await this.docker.createService({
      Name: obsName,
      Labels: labels,
      TaskTemplate: {
        ContainerSpec: {
          Image: 'grafana/otel-lgtm:latest',
          Env: [
            `GF_SECURITY_ADMIN_PASSWORD=${grafanaPass}`,
            'GF_SECURITY_ADMIN_USER=admin',
            'ENABLE_LOGS_ALL=false',
          ],
          Labels: { [SM4RT_WS_LABEL]: ws, [SM4RT_KIND_LABEL]: 'obs', [SM4RT_NAME_LABEL]: 'obs' },
        },
        Resources: { Limits: { NanoCPUs: cpusToNano(2), MemoryBytes: mbToBytes(2048) } },
        RestartPolicy: { Condition: 'any', Delay: 5_000_000_000 },
        Networks: [{ Target: NETWORK_NAME, Aliases: [obsName] }],
      },
      Mode: { Replicated: { Replicas: 1 } },
      EndpointSpec: { Mode: 'dnsrr' },
    });
    // global log agent — every node ships workspace container logs to Loki
    const agentName = this.obsAgentService(ws);
    const logsCfg = alloyLogsConfig(ws, obsName);
    const logsCfgName = await this.createConfig(`${agentName}-cfg`, logsCfg);
    const logsCfgId = await this.configIdFor(logsCfgName);
    await this.docker.createService({
      Name: agentName,
      Labels: { [SM4RT_KIND_LABEL]: 'obs-agent', [SM4RT_WS_LABEL]: ws, [SM4RT_NAME_LABEL]: 'obs-agent' },
      TaskTemplate: {
        ContainerSpec: {
          Image: 'grafana/alloy:latest',
          Args: ['run', '/etc/alloy/config.alloy', '--storage.path=/tmp/alloy'],
          Labels: {
            [SM4RT_WS_LABEL]: ws,
            [SM4RT_KIND_LABEL]: 'obs-agent',
            [SM4RT_NAME_LABEL]: 'obs-agent',
          },
          Mounts: [
            {
              Type: 'bind',
              Source: '/var/run/docker.sock',
              Target: '/var/run/docker.sock',
              ReadOnly: true,
            } as unknown as Docker.MountSettings,
          ],
          Configs: [this.configMount(logsCfgName, logsCfgId, '/etc/alloy/config.alloy')],
        },
        Resources: { Limits: { NanoCPUs: cpusToNano(0.5), MemoryBytes: mbToBytes(256) } },
        RestartPolicy: { Condition: 'any', Delay: 5_000_000_000 },
        Networks: [{ Target: NETWORK_NAME }],
      },
      Mode: { Global: {} },
      EndpointSpec: { Mode: 'dnsrr' },
    } as Docker.CreateServiceOptions);
    await this.syncObsScrape(ws);
    const svc = await this.getService(obsName);
    return this.obsInfoFrom(svc!, 'starting', await this.currentScrapeTargets(ws));
  }

  /**
   * (Re)generate the single-replica metrics scraper from current tasks with a
   * metricsPort. Called on obs enable and whenever tasks change.
   */
  async syncObsScrape(ws: string): Promise<void> {
    const obsName = this.obsService(ws);
    if (!(await this.getService(obsName))) return;
    const scrapeName = this.obsScrapeService(ws);
    const targets = await this.currentScrapeTargets(ws);
    const cfg = alloyScrapeConfig(ws, obsName, targets);
    const cfgName = await this.createConfig(`${scrapeName}-cfg`, cfg);
    const cfgId = await this.configIdFor(cfgName);
    const existing = await this.getService(scrapeName);
    if (existing) {
      const spec = existing.Spec as Record<string, any>;
      spec.TaskTemplate.ContainerSpec.Configs = [
        this.configMount(cfgName, cfgId, '/etc/alloy/config.alloy'),
      ];
      spec.TaskTemplate.ForceUpdate = (spec.TaskTemplate.ForceUpdate ?? 0) + 1;
      await this.docker.getService(scrapeName).update({ version: existing.Version.Index, ...spec });
      await this.removeConfigsByPrefix(`${scrapeName}-cfg`, cfgName);
      return;
    }
    await this.docker.createService({
      Name: scrapeName,
      Labels: {
        [SM4RT_KIND_LABEL]: 'obs-scrape',
        [SM4RT_WS_LABEL]: ws,
        [SM4RT_NAME_LABEL]: 'obs-scrape',
      },
      TaskTemplate: {
        ContainerSpec: {
          Image: 'grafana/alloy:latest',
          Args: ['run', '/etc/alloy/config.alloy', '--storage.path=/tmp/alloy'],
          Labels: {
            [SM4RT_WS_LABEL]: ws,
            [SM4RT_KIND_LABEL]: 'obs-scrape',
            [SM4RT_NAME_LABEL]: 'obs-scrape',
          },
          Configs: [this.configMount(cfgName, cfgId, '/etc/alloy/config.alloy')],
        },
        Resources: { Limits: { NanoCPUs: cpusToNano(0.5), MemoryBytes: mbToBytes(256) } },
        RestartPolicy: { Condition: 'any', Delay: 5_000_000_000 },
        Networks: [{ Target: NETWORK_NAME, Aliases: [scrapeName] }],
      },
      Mode: { Replicated: { Replicas: 1 } },
      EndpointSpec: { Mode: 'dnsrr' },
    } as Docker.CreateServiceOptions);
  }

  async disableObservability(ws: string): Promise<void> {
    const removedObs = await this.removeService(this.obsService(ws));
    await this.removeService(this.obsAgentService(ws));
    await this.removeService(this.obsScrapeService(ws));
    await this.removeConfigsByPrefix(`${this.obsAgentService(ws)}-cfg`);
    await this.removeConfigsByPrefix(`${this.obsScrapeService(ws)}-cfg`);
    if (!removedObs) throw new ComputeError(404, 'observability stack is not enabled');
  }

  // ————————————————— summary + cleanup —————————————————

  async summary(ws: string): Promise<Record<string, number>> {
    const svcs = await this.listByLabels([`${SM4RT_WS_LABEL}=${ws}`]);
    const counts: Record<string, number> = {};
    for (const s of svcs) {
      const kind = s.Spec.Labels?.[SM4RT_KIND_LABEL] ?? 'other';
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
    const dns = await this.listDns(ws).catch(() => []);
    counts['dns-records'] = dns.length;
    return counts;
  }

  /** Remove every sm4rt service + config for a workspace (workspace delete). */
  async deleteAllFor(ws: string): Promise<number> {
    const svcs = await this.listByLabels([`${SM4RT_WS_LABEL}=${ws}`]);
    let removed = 0;
    for (const s of svcs) {
      try {
        await this.docker.getService(s.ID).remove();
        removed++;
      } catch (err) {
        if (!isNotFoundErr(err)) throw err;
      }
    }
    // configs created for this workspace's services
    try {
      const configs = (await this.docker.listConfigs({})) as Array<{
        ID: string;
        Spec?: { Name?: string };
      }>;
      for (const c of configs) {
        const n = c.Spec?.Name ?? '';
        if (
          n.startsWith(`sm4rt-gw-${ws}-`) ||
          n.startsWith(`sm4rt-cdn-${ws}-`) ||
          n.startsWith(`sm4rt-cdnh-${ws}-`) ||
          n.startsWith(`sm4rt-obs-agent-${ws}-`) ||
          n.startsWith(`sm4rt-obs-scrape-${ws}-`) ||
          n.startsWith(`sm4rt-devops-${ws}-`) ||
          n.startsWith(`sm4rt-gitops-${ws}`)
        ) {
          try {
            await this.docker.getConfig(c.ID).remove();
          } catch {
            // best effort
          }
        }
      }
    } catch {
      // ignore
    }
    return removed;
  }

  /** Exposed for DevopsManager and routes. */
  get dockerClient(): Docker {
    return this.docker;
  }
  get options(): ComputeOptions {
    return this.opts;
  }
  taskServiceName(ws: string, name: string): string {
    return this.taskService(ws, name);
  }
  async ensureNet(): Promise<void> {
    return this.ensureNetwork();
  }
  caddyLabelsFor(host: string, port: number, idx = 0): Record<string, string> {
    return this.caddyLabels(host, port, idx);
  }
  publicHostFor(sub: string): string {
    return this.publicHost(sub);
  }
}
