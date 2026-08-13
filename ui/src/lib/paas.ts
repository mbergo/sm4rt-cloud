import { request } from './api';

export interface PaasApp {
  uuid: string;
  name: string;
  repository: string | null;
  branch: string | null;
  buildPack: string | null;
  status: string;
  fqdn: string | null;
  createdAt: string | null;
}

export interface PaasDatabase {
  uuid: string;
  name: string;
  engine: string;
  status: string;
  internalUrl: string | null;
  createdAt: string | null;
}

export const PAAS_DB_ENGINES = [
  'postgresql',
  'mysql',
  'mariadb',
  'mongodb',
  'redis',
  'keydb',
  'dragonfly',
  'clickhouse',
] as const;

const base = (ws: string) => `/api/instances/${ws}/paas`;

export const listPaasApps = (ws: string) => request<{ apps: PaasApp[] }>(`${base(ws)}/apps`);
export const createPaasApp = (
  ws: string,
  input: { name: string; repository: string; branch?: string; buildPack?: string; port?: number },
) =>
  request<{ uuid: string; fqdn: string | null }>(`${base(ws)}/apps`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
export const paasAppAction = (
  ws: string,
  uuid: string,
  action: 'start' | 'stop' | 'restart' | 'deploy',
) => request<{ ok: boolean }>(`${base(ws)}/apps/${uuid}/${action}`, { method: 'POST' });
export const deletePaasApp = (ws: string, uuid: string) =>
  request<{ ok: boolean }>(`${base(ws)}/apps/${uuid}`, { method: 'DELETE' });

export const listPaasDatabases = (ws: string) =>
  request<{ databases: PaasDatabase[] }>(`${base(ws)}/databases`);
export const createPaasDatabase = (ws: string, engine: string, name?: string) =>
  request<{ uuid: string }>(`${base(ws)}/databases`, {
    method: 'POST',
    body: JSON.stringify({ engine, ...(name ? { name } : {}) }),
  });
export const paasDatabaseAction = (
  ws: string,
  uuid: string,
  action: 'start' | 'stop' | 'restart',
) => request<{ ok: boolean }>(`${base(ws)}/databases/${uuid}/${action}`, { method: 'POST' });
export const deletePaasDatabase = (ws: string, uuid: string) =>
  request<{ ok: boolean }>(`${base(ws)}/databases/${uuid}`, { method: 'DELETE' });
