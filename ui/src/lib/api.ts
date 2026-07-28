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

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token ?? getToken()}`,
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

export function validateToken(token: string): Promise<{ instances: Instance[] }> {
  return request('/api/instances', undefined, token);
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

export type ServiceId = 's3' | 'sqs' | 'sns' | 'dynamodb' | 'ec2' | 'secrets';

export interface ResourceItem {
  id: string;
  name: string;
  detail?: string;
  createdAt?: string;
}

export function listResources(
  instance: string,
  service: ServiceId,
): Promise<{ resources: ResourceItem[] }> {
  return request(`/api/instances/${instance}/resources/${service}`);
}

export function createResource(
  instance: string,
  service: ServiceId,
  payload: { name: string; value?: string },
): Promise<ResourceItem> {
  return request(`/api/instances/${instance}/resources/${service}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function deleteResource(
  instance: string,
  service: ServiceId,
  id: string,
): Promise<void> {
  return request(`/api/instances/${instance}/resources/${service}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
