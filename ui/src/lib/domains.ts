import { request } from './api';

export interface DnsInstruction {
  type: 'TXT' | 'A' | 'CNAME';
  name: string;
  value: string;
  purpose: string;
}

export interface DomainInfo {
  domain: string;
  workspace: string;
  status: 'pending' | 'verified';
  createdAt: string;
  verifiedAt: string | null;
  records: DnsInstruction[];
}

export interface VerifyResponse {
  ok: boolean;
  txt: boolean;
  routing: boolean;
  detail: string;
  domain: DomainInfo;
}

export interface WorkspaceDomain {
  workspace: string;
  defaultDomain: string | null;
  platformDomain: string;
}

export const listDomains = (ws: string) =>
  request<{ domains: DomainInfo[] }>(`/api/domains?workspace=${encodeURIComponent(ws)}`);

export const registerDomain = (ws: string, domain: string) =>
  request<DomainInfo>('/api/domains', {
    method: 'POST',
    body: JSON.stringify({ domain, workspace: ws }),
  });

export const verifyDomain = (domain: string) =>
  request<VerifyResponse>(`/api/domains/${encodeURIComponent(domain)}/verify`, {
    method: 'POST',
  });

export const deleteDomain = (domain: string) =>
  request<{ deleted: string; workspacesReset: string[] }>(
    `/api/domains/${encodeURIComponent(domain)}`,
    { method: 'DELETE' },
  );

export const getWorkspaceDomain = (ws: string) =>
  request<WorkspaceDomain>(`/api/instances/${encodeURIComponent(ws)}/domain`);

export const setWorkspaceDomain = (ws: string, domain: string | null) =>
  request<{
    workspace: string;
    defaultDomain: string | null;
    relabeled: string[];
    hosts: Record<string, string>;
  }>(`/api/instances/${encodeURIComponent(ws)}/domain`, {
    method: 'PUT',
    body: JSON.stringify({ domain }),
  });
