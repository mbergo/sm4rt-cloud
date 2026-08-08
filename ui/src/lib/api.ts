export interface Instance {
  name: string;
  status: 'provisioning' | 'running' | 'error' | 'deleting';
  statusDetail: string | null;
  host: string;
  endpoint: string;
  createdAt: string | null;
  expiresAt: string | null;
  image: string;
  readyReplicas: number;
}

export interface InstanceDetail extends Instance {
  health: Record<string, unknown> | null;
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const TOKEN_KEY = 'floci-cloud-token';

type TokenProvider = () => Promise<string | null>;

let tokenProvider: TokenProvider | null = null;

export function setTokenProvider(provider: TokenProvider | null): void {
  tokenProvider = provider;
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
  const bearer = token ?? (tokenProvider ? await tokenProvider() : null) ?? getToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${bearer}`,
      ...init?.headers,
    },
  });
  if (response.status === 204) {
    return undefined as T;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}) as { error?: string });
    throw new ApiError(response.status, body.error ?? response.statusText);
  }
  return response.json();
}

export function listInstances(): Promise<{ instances: Instance[] }> {
  return request('/api/instances');
}

export function createInstance(payload: {
  name?: string;
  ttlHours: number | null;
}): Promise<Instance> {
  return request('/api/instances', { method: 'POST', body: JSON.stringify(payload) });
}

export function getInstance(name: string): Promise<InstanceDetail> {
  return request(`/api/instances/${name}`);
}

export function deleteInstance(name: string): Promise<void> {
  return request(`/api/instances/${name}`, { method: 'DELETE' });
}

export function getLogs(name: string, tail = 300): Promise<{ logs: string }> {
  return request(`/api/instances/${name}/logs?tail=${tail}`);
}

export interface ProvisionEvent {
  ts: string;
  kind: 'info' | 'ok' | 'err' | 'done';
  line: string;
}

/** Live provisioning terminal — SSE with token via query (EventSource can't set headers). */
export async function openProvisionEvents(name: string): Promise<EventSource> {
  const bearer = (tokenProvider ? await tokenProvider() : null) ?? getToken();
  const qs = bearer ? `?access_token=${encodeURIComponent(bearer)}` : '';
  return new EventSource(`/api/instances/${name}/events${qs}`);
}

export type ServiceId =
  | 's3'
  | 'sqs'
  | 'sns'
  | 'dynamodb'
  | 'ec2'
  | 'lambda'
  | 'secrets'
  | 'iam'
  | 'ssm'
  | 'logs'
  | 'kms'
  | 'events'
  | 'states'
  | 'kinesis'
  | 'apigw'
  | 'cognito'
  | 'route53'
  | 'cloudformation'
  | 'ecr'
  | 'ses'
  | 'scheduler'
  | 'rds'
  | 'ecs'
  | 'athena'
  | 'glue'
  | 'elasticache'
  | 'firehose';

export const REAL_SERVICES = [
  'kafka',
  'pulsar',
  'activemq',
  'zookeeper',
  'cassandra',
  'couchdb',
  'ozone',
  'flink',
  'solr',
  'nifi',
  'tomcat',
  'httpd',
  'ollama',
  'jupyter',
  'mlflow',
  'iceberg',
  'trino',
  'airflow',
  'lgtm',
] as const;
export type RealServiceId = (typeof REAL_SERVICES)[number];
export type RealServiceStatus = 'stopped' | 'starting' | 'running' | 'error';

export const SERVICE_CATEGORIES = [
  'messaging',
  'data',
  'analytics',
  'pipelines',
  'web',
  'ai',
  'observability',
] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export interface RealServiceInfo {
  id: RealServiceId;
  label: string;
  description: string;
  image: string;
  category: ServiceCategory;
  status: RealServiceStatus;
  statusDetail: string | null;
  endpoints: { label: string; value: string }[];
}

export function isRealServiceId(value: string): value is RealServiceId {
  return (REAL_SERVICES as readonly string[]).includes(value);
}

export function listServices(instance: string): Promise<{ services: RealServiceInfo[] }> {
  return request(`/api/instances/${instance}/services`);
}

export interface ServiceMetrics {
  service: string;
  cpuMilli: number;
  memoryBytes: number;
  pods: number;
}

export interface InstanceMetrics {
  instance: string;
  sampledAt: string;
  services: ServiceMetrics[];
}

export interface ExplorerService {
  id: string;
  proto: 'JSON' | 'QUERY' | 'REST_JSON' | 'REST_XML' | 'CBOR';
  target: string | null;
  scope: string;
  sampleOp: string;
  sampleBody: string;
}

export interface ExploreResult {
  status: number;
  contentType: string;
  body: string;
}

export function listExplorerServices(instance: string): Promise<{ services: ExplorerService[] }> {
  return request(`/api/instances/${instance}/explorer/services`);
}

export function exploreCall(
  instance: string,
  payload: { service: string; operation: string; body?: string; region?: string },
): Promise<ExploreResult> {
  const region = payload.region ? `?region=${payload.region}` : '';
  return request(`/api/instances/${instance}/explorer${region}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getInstanceMetrics(instance: string): Promise<InstanceMetrics> {
  return request(`/api/instances/${instance}/metrics`);
}

export function startService(instance: string, service: RealServiceId): Promise<RealServiceInfo> {
  return request(`/api/instances/${instance}/services/${service}/start`, {
    method: 'POST',
    body: '{}',
  });
}

export function stopService(instance: string, service: RealServiceId): Promise<RealServiceInfo> {
  return request(`/api/instances/${instance}/services/${service}/stop`, {
    method: 'POST',
    body: '{}',
  });
}

export function getServiceLogs(
  instance: string,
  service: RealServiceId,
  tail = 200,
): Promise<{ logs: string }> {
  return request(`/api/instances/${instance}/services/${service}/logs?tail=${tail}`);
}

export type AgentRunStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface AgentRun {
  id: string;
  status: AgentRunStatus;
  repoUrl: string;
  model: string;
  startedAt: string | null;
  completedAt: string | null;
}

export function startOtelAgent(
  instance: string,
  payload: { repoUrl: string; githubToken: string; model?: string; baseBranch?: string; maxFiles?: number },
): Promise<AgentRun> {
  return request(`/api/instances/${instance}/agents/otel-pr`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function listOtelAgentRuns(instance: string): Promise<{ runs: AgentRun[] }> {
  return request(`/api/instances/${instance}/agents/otel-pr`);
}

export function getOtelAgentLogs(instance: string, run: string, tail = 500): Promise<{ logs: string }> {
  return request(`/api/instances/${instance}/agents/otel-pr/${run}/logs?tail=${tail}`);
}

export interface ResourceItem {
  id: string;
  name: string;
  detail?: string;
  createdAt?: string;
}

export const REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'eu-west-1',
  'eu-central-1',
  'sa-east-1',
] as const;
export type Region = (typeof REGIONS)[number];

const regionQs = (region: Region) => `?region=${region}`;

export function listResources(
  instance: string,
  service: ServiceId,
  region: Region,
): Promise<{ resources: ResourceItem[] }> {
  return request(`/api/instances/${instance}/resources/${service}${regionQs(region)}`);
}

export function createResource(
  instance: string,
  service: ServiceId,
  region: Region,
  payload: { name: string; value?: string; runtime?: string; handler?: string; code?: string },
): Promise<ResourceItem> {
  return request(`/api/instances/${instance}/resources/${service}${regionQs(region)}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function actOnResource<T = unknown>(
  instance: string,
  service: ServiceId,
  region: Region,
  id: string,
  action: string,
  body: Record<string, unknown> = {},
): Promise<{ result: T }> {
  return request(
    `/api/instances/${instance}/resources/${service}/${encodeURIComponent(id)}/actions/${action}${regionQs(region)}`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export function deleteResource(
  instance: string,
  service: ServiceId,
  region: Region,
  id: string,
): Promise<void> {
  return request(
    `/api/instances/${instance}/resources/${service}/${encodeURIComponent(id)}${regionQs(region)}`,
    { method: 'DELETE' },
  );
}
