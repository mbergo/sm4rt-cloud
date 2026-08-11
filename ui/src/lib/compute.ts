/**
 * sm4rt compute client — real workloads (VMs, containers, databases, caches,
 * DNS, gateways, CDN, observability, DevOps) under /api/instances/:ws/compute.
 */
import { request } from './api';

// — Catalog constants (mirrors api/src/compute-templates.ts) —

export const VM_IMAGES = [
  { id: 'ubuntu-24', label: 'Ubuntu 24.04 LTS' },
  { id: 'debian-12', label: 'Debian 12 (bookworm)' },
  { id: 'alpine-3', label: 'Alpine 3.20' },
] as const;
export type VmImageId = (typeof VM_IMAGES)[number]['id'];

export const VM_PLANS = [
  { id: 'nano', label: 'Nano — 0.5 vCPU · 512 MB' },
  { id: 'small', label: 'Small — 1 vCPU · 1 GB' },
  { id: 'medium', label: 'Medium — 2 vCPU · 2 GB' },
  { id: 'large', label: 'Large — 4 vCPU · 4 GB' },
] as const;
export type VmPlanId = (typeof VM_PLANS)[number]['id'];

export const SERVICE_PLANS = ['micro', 'small', 'medium', 'large'] as const;
export type ServicePlanId = (typeof SERVICE_PLANS)[number];

export const DB_PLANS = [
  { id: 'micro', label: 'Micro — 0.5 vCPU · 512 MB' },
  { id: 'small', label: 'Small — 1 vCPU · 1 GB' },
  { id: 'medium', label: 'Medium — 2 vCPU · 2 GB' },
  { id: 'large', label: 'Large — 4 vCPU · 4 GB' },
] as const;

export const CACHE_PLANS = [
  { id: 'micro', label: 'Micro — 0.25 vCPU · 256 MB' },
  { id: 'small', label: 'Small — 0.5 vCPU · 512 MB' },
  { id: 'medium', label: 'Medium — 1 vCPU · 1 GB' },
  { id: 'large', label: 'Large — 2 vCPU · 2 GB' },
] as const;

export const TASK_PLANS = [
  { id: 'micro', label: 'Micro — 0.25 vCPU · 256 MB' },
  { id: 'small', label: 'Small — 0.5 vCPU · 512 MB' },
  { id: 'medium', label: 'Medium — 1 vCPU · 1 GB' },
  { id: 'large', label: 'Large — 2 vCPU · 2 GB' },
] as const;

export const DB_ENGINES = [
  { id: 'postgres-16', label: 'PostgreSQL 16', port: 5432 },
  { id: 'mysql-8', label: 'MySQL 8', port: 3306 },
  { id: 'mariadb-11', label: 'MariaDB 11', port: 3306 },
] as const;
export type DbEngineId = (typeof DB_ENGINES)[number]['id'];

export const CACHE_ENGINES = [
  { id: 'redis-7', label: 'Redis 7' },
  { id: 'valkey-8', label: 'Valkey 8' },
] as const;
export type CacheEngineId = (typeof CACHE_ENGINES)[number]['id'];

export const DNS_TYPES = ['ALIAS', 'A', 'CNAME', 'TXT', 'MX'] as const;
export type DnsType = (typeof DNS_TYPES)[number];

// — Shapes (mirror api/src/compute.ts + devops.ts) —

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
  plan: ServicePlanId;
  planLabel: string;
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
  plan: ServicePlanId;
  planLabel: string;
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
  plan: ServicePlanId;
  planLabel: string;
  state: string;
  host: string;
  port: number;
  externalPort: number | null;
  externalHost: string | null;
  password: string;
  connectionUri: string;
  createdAt: string | null;
}

export interface GatewayRoute {
  path: string;
  target: string;
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
  type: DnsType;
  target: string;
  informational: boolean;
}

export interface ScrapeTarget {
  taskName: string;
  serviceHost: string;
  port: number;
  path: string;
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

export interface DevopsStatus {
  enabled: boolean;
  state: string;
  gitUrl: string | null;
  ciUrl: string | null;
  adminUser: string | null;
  adminPassword: string | null;
  registry: string | null;
  bootstrapped: boolean;
  message?: string;
}

export interface GitopsApp {
  name: string;
  repo: string;
  branch: string;
  path: string;
  autoSync: boolean;
  status?: 'Synced' | 'OutOfSync' | 'Error' | 'Unknown';
  revision?: string | null;
  appliedRevision?: string | null;
  lastError?: string | null;
  lastSyncAt?: string | null;
}

const base = (ws: string) => `/api/instances/${ws}/compute`;

// — Servers (VMs) —

export const listVms = (ws: string) => request<{ vms: VmInfo[] }>(`${base(ws)}/vms`);
export const createVm = (ws: string, body: { name: string; image: VmImageId; plan: VmPlanId }) =>
  request<VmInfo>(`${base(ws)}/vms`, { method: 'POST', body: JSON.stringify(body) });
export const vmAction = (ws: string, id: string, action: 'stop' | 'start' | 'reboot' | 'terminate') =>
  request<{ ok: true }>(`${base(ws)}/vms/${id}/action`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  });
export const vmLogs = (ws: string, id: string, tail = 200) =>
  request<{ logs: string }>(`${base(ws)}/vms/${id}/logs?tail=${tail}`);

// — Container tasks —

export const listTasks = (ws: string) => request<{ tasks: TaskInfo[] }>(`${base(ws)}/tasks`);
export const createTask = (
  ws: string,
  body: {
    name: string;
    image: string;
    port?: number;
    env?: Record<string, string>;
    replicas?: number;
    plan?: ServicePlanId;
    metricsPort?: number;
    metricsPath?: string;
  },
) => request<TaskInfo>(`${base(ws)}/tasks`, { method: 'POST', body: JSON.stringify(body) });
export const updateTask = (
  ws: string,
  task: string,
  body: Partial<{
    image: string;
    port: number | null;
    env: Record<string, string>;
    replicas: number;
    metricsPort: number | null;
    metricsPath: string;
  }>,
) => request<TaskInfo>(`${base(ws)}/tasks/${task}`, { method: 'PATCH', body: JSON.stringify(body) });
export const taskAction = (ws: string, task: string, action: 'restart' | 'delete') =>
  request<{ ok: true }>(`${base(ws)}/tasks/${task}/action`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  });
export const taskLogs = (ws: string, task: string, tail = 200) =>
  request<{ logs: string }>(`${base(ws)}/tasks/${task}/logs?tail=${tail}`);

// — Managed databases —

export const listDatabases = (ws: string) => request<{ databases: DbInfo[] }>(`${base(ws)}/databases`);
export const createDatabase = (
  ws: string,
  body: { name: string; engine: DbEngineId; plan?: ServicePlanId; external?: boolean },
) => request<DbInfo>(`${base(ws)}/databases`, { method: 'POST', body: JSON.stringify(body) });
export const deleteDatabase = (ws: string, db: string) =>
  request<void>(`${base(ws)}/databases/${db}`, { method: 'DELETE' });
export const databaseLogs = (ws: string, db: string, tail = 200) =>
  request<{ logs: string }>(`${base(ws)}/databases/${db}/logs?tail=${tail}`);

// — Caches —

export const listCaches = (ws: string) => request<{ caches: CacheInfo[] }>(`${base(ws)}/caches`);
export const createCache = (
  ws: string,
  body: { name: string; engine: CacheEngineId; plan?: ServicePlanId; external?: boolean },
) => request<CacheInfo>(`${base(ws)}/caches`, { method: 'POST', body: JSON.stringify(body) });
export const deleteCache = (ws: string, cache: string) =>
  request<void>(`${base(ws)}/caches/${cache}`, { method: 'DELETE' });

// — DNS —

export const listDns = (ws: string) => request<{ records: DnsRecord[] }>(`${base(ws)}/dns`);
export const createDns = (ws: string, body: { record: string; type: DnsType; target: string }) =>
  request<DnsRecord>(`${base(ws)}/dns`, { method: 'POST', body: JSON.stringify(body) });
export const deleteDns = (ws: string, record: string) =>
  request<void>(`${base(ws)}/dns/${record}`, { method: 'DELETE' });

// — API gateways —

export const listGateways = (ws: string) => request<{ gateways: GatewayInfo[] }>(`${base(ws)}/gateways`);
export const createGateway = (ws: string, body: { name: string; routes: GatewayRoute[] }) =>
  request<GatewayInfo>(`${base(ws)}/gateways`, { method: 'POST', body: JSON.stringify(body) });
export const updateGateway = (ws: string, gw: string, routes: GatewayRoute[]) =>
  request<GatewayInfo>(`${base(ws)}/gateways/${gw}`, {
    method: 'PUT',
    body: JSON.stringify({ routes }),
  });
export const deleteGateway = (ws: string, gw: string) =>
  request<void>(`${base(ws)}/gateways/${gw}`, { method: 'DELETE' });

// — CDN (Varnish) —

export const listCdns = (ws: string) => request<{ cdns: CdnInfo[] }>(`${base(ws)}/cdns`);
export const createCdn = (ws: string, body: { name: string; origin: string; ttlSeconds?: number }) =>
  request<CdnInfo>(`${base(ws)}/cdns`, { method: 'POST', body: JSON.stringify(body) });
export const purgeCdn = (ws: string, cdn: string) =>
  request<{ ok: true }>(`${base(ws)}/cdns/${cdn}/purge`, { method: 'POST', body: '{}' });
export const deleteCdn = (ws: string, cdn: string) =>
  request<void>(`${base(ws)}/cdns/${cdn}`, { method: 'DELETE' });

// — Observability (LGTM + OTel) —

export const getObservability = (ws: string) =>
  request<{ observability: ObsInfo | null }>(`${base(ws)}/observability`);
export const enableObservability = (ws: string) =>
  request<ObsInfo>(`${base(ws)}/observability`, { method: 'POST', body: '{}' });
export const disableObservability = (ws: string) =>
  request<void>(`${base(ws)}/observability`, { method: 'DELETE' });

// — DevOps (Gitea + Woodpecker + GitOps) —

export const getDevops = (ws: string) => request<DevopsStatus>(`${base(ws)}/devops`);
export const enableDevops = (ws: string) =>
  request<DevopsStatus>(`${base(ws)}/devops`, { method: 'POST', body: '{}' });
export const retryDevopsBootstrap = (ws: string) =>
  request<DevopsStatus>(`${base(ws)}/devops/retry-bootstrap`, { method: 'POST', body: '{}' });
export const disableDevops = (ws: string) =>
  request<void>(`${base(ws)}/devops`, { method: 'DELETE' });

export const listGitopsApps = (ws: string) => request<{ apps: GitopsApp[] }>(`${base(ws)}/gitops/apps`);
export const addGitopsApp = (
  ws: string,
  body: { name: string; repo: string; branch?: string; path?: string; autoSync?: boolean },
) => request<GitopsApp>(`${base(ws)}/gitops/apps`, { method: 'POST', body: JSON.stringify(body) });
export const syncGitopsApp = (ws: string, app: string) =>
  request<GitopsApp>(`${base(ws)}/gitops/apps/${app}/sync`, { method: 'POST', body: '{}' });
export const removeGitopsApp = (ws: string, app: string) =>
  request<void>(`${base(ws)}/gitops/apps/${app}`, { method: 'DELETE' });

// — Workspace summary —

export const computeSummary = (ws: string) => request<Record<string, number>>(`${base(ws)}/summary`);

export interface DiscoveredService {
  kind: string;
  name: string;
  service: string;
  state: string;
  createdAt: string | null;
}

export const computeDiscovery = (ws: string) =>
  request<{ services: DiscoveredService[] }>(`${base(ws)}/discovery`);

// — Container Registry (registry:2, docker push real) —

export interface RegistryStatus {
  enabled: boolean;
  state: string;
  host: string | null;
  url: string | null;
  user: string | null;
  password: string | null;
}

export interface RegistryRepo {
  name: string;
  tags: string[];
}

export const getRegistry = (ws: string) => request<RegistryStatus>(`${base(ws)}/registry`);
export const enableRegistry = (ws: string) =>
  request<RegistryStatus>(`${base(ws)}/registry`, { method: 'POST', body: '{}' });
export const disableRegistry = (ws: string) =>
  request<void>(`${base(ws)}/registry`, { method: 'DELETE' });
export const listRegistryRepos = (ws: string) =>
  request<{ repos: RegistryRepo[] }>(`${base(ws)}/registry/repos`);
export const deleteRegistryTag = (ws: string, repo: string, tag: string) =>
  request<void>(`${base(ws)}/registry/repos/${encodeURIComponent(repo)}/tags/${encodeURIComponent(tag)}`, {
    method: 'DELETE',
  });

// — Object Store (MinIO, real S3 API) —

export interface ObjectStoreStatus {
  enabled: boolean;
  state: string;
  host: string | null;
  url: string | null;
  accessKey: string | null;
  secretKey: string | null;
}

export interface BucketInfo {
  name: string;
  createdAt: string | null;
}

export const getObjectStore = (ws: string) =>
  request<ObjectStoreStatus>(`${base(ws)}/objectstore`);
export const enableObjectStore = (ws: string) =>
  request<ObjectStoreStatus>(`${base(ws)}/objectstore`, { method: 'POST', body: '{}' });
export const disableObjectStore = (ws: string) =>
  request<void>(`${base(ws)}/objectstore`, { method: 'DELETE' });
export const listBuckets = (ws: string) =>
  request<{ buckets: BucketInfo[] }>(`${base(ws)}/objectstore/buckets`);
export const createBucket = (ws: string, name: string) =>
  request<{ ok: boolean }>(`${base(ws)}/objectstore/buckets`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
export const deleteBucket = (ws: string, name: string) =>
  request<void>(`${base(ws)}/objectstore/buckets/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });

// — Table Store (ScyllaDB Alternator, real DynamoDB protocol) —

export interface TableStoreStatus {
  enabled: boolean;
  state: string;
  host: string | null;
  url: string | null;
  accessKey: string | null;
  secretKey: string | null;
}

export interface TableInfo {
  name: string;
  status: string | null;
  keySchema: Array<{ attribute: string; type: string; role: string }>;
  itemCount: number | null;
}

export const getTableStore = (ws: string) =>
  request<TableStoreStatus>(`${base(ws)}/tablestore`);
export const enableTableStore = (ws: string) =>
  request<TableStoreStatus>(`${base(ws)}/tablestore`, { method: 'POST', body: '{}' });
export const disableTableStore = (ws: string) =>
  request<void>(`${base(ws)}/tablestore`, { method: 'DELETE' });
export const listTables = (ws: string) =>
  request<{ tables: TableInfo[] }>(`${base(ws)}/tablestore/tables`);
export const createTable = (
  ws: string,
  input: { name: string; hashKey: string; hashType: string; rangeKey?: string; rangeType?: string },
) =>
  request<{ ok: boolean }>(`${base(ws)}/tablestore/tables`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
export const deleteTable = (ws: string, name: string) =>
  request<void>(`${base(ws)}/tablestore/tables/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });

// — Message Broker (RabbitMQ, real AMQP) —

export interface BrokerStatus {
  enabled: boolean;
  state: string;
  host: string | null;
  managementUrl: string | null;
  amqpUrl: string | null;
  user: string | null;
  password: string | null;
}

export interface QueueInfo {
  name: string;
  vhost: string;
  messages: number | null;
  consumers: number | null;
  state: string | null;
}

export const getBroker = (ws: string) => request<BrokerStatus>(`${base(ws)}/broker`);
export const enableBroker = (ws: string) =>
  request<BrokerStatus>(`${base(ws)}/broker`, { method: 'POST', body: '{}' });
export const disableBroker = (ws: string) =>
  request<void>(`${base(ws)}/broker`, { method: 'DELETE' });
export const listQueues = (ws: string) =>
  request<{ queues: QueueInfo[] }>(`${base(ws)}/broker/queues`);
export const createQueue = (ws: string, name: string) =>
  request<{ ok: boolean }>(`${base(ws)}/broker/queues`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
export const deleteQueue = (ws: string, name: string) =>
  request<void>(`${base(ws)}/broker/queues/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });

// — Functions (real FaaS — user code in its own container) —

export interface FunctionInfo {
  name: string;
  state: string;
  url: string;
  runtime: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface FunctionDetail extends FunctionInfo {
  code: string;
}

export const listFunctions = (ws: string) =>
  request<{ functions: FunctionInfo[] }>(`${base(ws)}/functions`);
export const createFunction = (ws: string, name: string, code?: string) =>
  request<FunctionInfo>(`${base(ws)}/functions`, {
    method: 'POST',
    body: JSON.stringify({ name, ...(code !== undefined ? { code } : {}) }),
  });
export const getFunction = (ws: string, fn: string) =>
  request<FunctionDetail>(`${base(ws)}/functions/${encodeURIComponent(fn)}`);
export const updateFunction = (ws: string, fn: string, code: string) =>
  request<{ ok: boolean }>(`${base(ws)}/functions/${encodeURIComponent(fn)}`, {
    method: 'PUT',
    body: JSON.stringify({ code }),
  });
export const deleteFunction = (ws: string, fn: string) =>
  request<void>(`${base(ws)}/functions/${encodeURIComponent(fn)}`, { method: 'DELETE' });
