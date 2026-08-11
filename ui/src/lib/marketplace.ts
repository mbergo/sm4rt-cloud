import { request } from './api';

export interface MarketplaceApp {
  uuid: string;
  name: string;
  type: string | null;
  status: string;
  domains: string[];
  createdAt: string | null;
}

export const listTemplates = (ws: string) =>
  request<{ templates: string[] }>(`/api/instances/${ws}/marketplace/templates`);

export const listApps = (ws: string) =>
  request<{ apps: MarketplaceApp[] }>(`/api/instances/${ws}/marketplace/apps`);

export const createApp = (ws: string, type: string, name?: string) =>
  request<{ uuid: string; domains: string[] }>(`/api/instances/${ws}/marketplace/apps`, {
    method: 'POST',
    body: JSON.stringify({ type, ...(name ? { name } : {}) }),
  });

export const appAction = (ws: string, uuid: string, action: 'start' | 'stop' | 'restart') =>
  request<{ ok: boolean }>(`/api/instances/${ws}/marketplace/apps/${uuid}/${action}`, {
    method: 'POST',
  });

export const deleteApp = (ws: string, uuid: string) =>
  request<{ ok: boolean }>(`/api/instances/${ws}/marketplace/apps/${uuid}`, {
    method: 'DELETE',
  });
