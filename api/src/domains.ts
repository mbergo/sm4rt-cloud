// Custom tenant domains: registration, DNS verification, default-domain selection.
//
// The tenant owns the DNS setup (external-only): they create a TXT record
// `_sm4rt-verify.<domain>` containing the verify token, plus a wildcard
// (`*.<domain>`) and optionally apex A/ALIAS record pointing at the platform
// edge. Verification does public lookups via node:dns — the resolver is
// injectable so tests never touch the network.

import type { FastifyInstance } from 'fastify';
import type { Store, DomainRow } from './db.ts';
import type { ComputeManager } from './compute.ts';

export interface DnsResolver {
  resolveTxt(host: string): Promise<string[][]>;
  resolve4(host: string): Promise<string[]>;
  resolveCname(host: string): Promise<string[]>;
}

export async function defaultResolver(): Promise<DnsResolver> {
  const dns = await import('node:dns/promises');
  return {
    resolveTxt: (h) => dns.resolveTxt(h),
    resolve4: (h) => dns.resolve4(h),
    resolveCname: (h) => dns.resolveCname(h),
  };
}

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export function validDomain(d: string): boolean {
  return DOMAIN_RE.test(d);
}

export function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/\.$/, '');
}

export interface DnsInstruction {
  type: 'TXT' | 'A' | 'CNAME';
  name: string;
  value: string;
  purpose: string;
}

/** Records the tenant must create at their DNS provider. */
export function dnsInstructions(row: DomainRow, edge: { ip?: string; cname?: string }): DnsInstruction[] {
  const out: DnsInstruction[] = [
    {
      type: 'TXT',
      name: `_sm4rt-verify.${row.domain}`,
      value: row.verifyToken,
      purpose: 'ownership verification',
    },
  ];
  if (edge.cname) {
    out.push({
      type: 'CNAME',
      name: `*.${row.domain}`,
      value: edge.cname,
      purpose: 'route endpoints to the platform edge',
    });
  } else if (edge.ip) {
    out.push({
      type: 'A',
      name: `*.${row.domain}`,
      value: edge.ip,
      purpose: 'route endpoints to the platform edge',
    });
  }
  return out;
}

export interface VerifyResult {
  ok: boolean;
  txt: boolean;
  routing: boolean;
  detail: string;
}

/**
 * Checks ownership (TXT contains the token) and routing (a probe subdomain
 * resolves to the platform edge). resolve4 follows CNAME chains, so tenants
 * may use either a wildcard A record or a wildcard CNAME.
 */
export async function verifyDomain(
  row: DomainRow,
  edge: { ip?: string; cname?: string },
  resolver: DnsResolver,
): Promise<VerifyResult> {
  let txtOk = false;
  try {
    const records = await resolver.resolveTxt(`_sm4rt-verify.${row.domain}`);
    txtOk = records.some((chunks) => chunks.join('') === row.verifyToken);
  } catch {
    txtOk = false;
  }
  if (!txtOk) {
    return {
      ok: false,
      txt: false,
      routing: false,
      detail: `TXT _sm4rt-verify.${row.domain} not found or token mismatch (DNS may still be propagating)`,
    };
  }

  let expected: string[] = [];
  if (edge.ip) {
    expected = [edge.ip];
  } else if (edge.cname) {
    try {
      expected = await resolver.resolve4(edge.cname);
    } catch {
      /* edge unresolvable — fall through to CNAME name match */
    }
  }

  const probe = `sm4rt-probe.${row.domain}`;
  const target = edge.ip ?? edge.cname ?? '';
  let routingOk = false;
  let routeDetail = '';
  try {
    const ips = await resolver.resolve4(probe);
    routingOk = ips.some((ip) => expected.includes(ip));
    if (!routingOk) routeDetail = `wildcard resolves to ${ips.join(', ')} instead of the platform edge (${target})`;
  } catch {
    routeDetail = `*.${row.domain} does not resolve (add a wildcard record → ${target})`;
  }
  if (!routingOk && edge.cname) {
    try {
      const names = await resolver.resolveCname(probe);
      routingOk = names.some((n) => normalizeDomain(n) === normalizeDomain(edge.cname!));
    } catch {
      /* keep routeDetail from the A attempt */
    }
  }

  if (!routingOk) {
    return { ok: false, txt: true, routing: false, detail: routeDetail || 'wildcard record missing' };
  }
  return { ok: true, txt: true, routing: true, detail: 'verified' };
}

export interface DomainsDeps {
  store: Store;
  compute: ComputeManager;
  edge: { ip?: string; cname?: string };
  resolver?: DnsResolver;
  /** returns true when the instance/workspace exists */
  hasWorkspace: (ws: string) => Promise<boolean>;
}

export function registerDomainRoutes(app: FastifyInstance, deps: DomainsDeps): void {
  const { store, compute, edge } = deps;

  const publicRow = (r: DomainRow) => ({
    domain: r.domain,
    workspace: r.workspace,
    status: r.status,
    createdAt: r.createdAt,
    verifiedAt: r.verifiedAt,
    records: dnsInstructions(r, edge),
  });

  app.get('/api/domains', async (req) => {
    const ws = (req.query as { workspace?: string }).workspace;
    return { domains: store.listDomains(ws).map(publicRow) };
  });

  app.post('/api/domains', async (req, reply) => {
    const body = (req.body ?? {}) as { domain?: string; workspace?: string };
    const domain = normalizeDomain(body.domain ?? '');
    const ws = (body.workspace ?? '').trim();
    if (!validDomain(domain)) {
      return reply.code(400).send({ error: 'invalid domain (use e.g. example.com, lowercase, no scheme)' });
    }
    if (!ws || !(await deps.hasWorkspace(ws))) {
      return reply.code(400).send({ error: 'workspace not found' });
    }
    if (store.getDomain(domain)) {
      return reply.code(409).send({ error: 'domain already registered' });
    }
    const row = await store.createDomain(domain, ws);
    return reply.code(201).send(publicRow(row));
  });

  app.post('/api/domains/:domain/verify', async (req, reply) => {
    const domain = normalizeDomain((req.params as { domain: string }).domain);
    const row = store.getDomain(domain);
    if (!row) return reply.code(404).send({ error: 'domain not registered' });
    const resolver = deps.resolver ?? (await defaultResolver());
    const result = await verifyDomain(row, edge, resolver);
    if (result.ok && row.status !== 'verified') await store.markVerified(domain);
    const fresh = store.getDomain(domain)!;
    return { ...result, domain: publicRow(fresh) };
  });

  app.delete('/api/domains/:domain', async (req, reply) => {
    const domain = normalizeDomain((req.params as { domain: string }).domain);
    const row = store.getDomain(domain);
    if (!row) return reply.code(404).send({ error: 'domain not registered' });
    const affected: string[] = [];
    for (const ws of store.workspacesUsingDomain(domain)) {
      await store.setDefaultDomain(ws, null);
      const res = await compute.applyDomain(ws).catch(() => null);
      if (res) affected.push(ws);
    }
    await store.deleteDomain(domain);
    return { deleted: domain, workspacesReset: affected };
  });

  app.get('/api/instances/:name/domain', async (req, reply) => {
    const ws = (req.params as { name: string }).name;
    if (!(await deps.hasWorkspace(ws))) return reply.code(404).send({ error: 'instance not found' });
    return {
      workspace: ws,
      defaultDomain: store.getDefaultDomain(ws),
      platformDomain: compute.options.instanceDomain,
    };
  });

  app.put('/api/instances/:name/domain', async (req, reply) => {
    const ws = (req.params as { name: string }).name;
    if (!(await deps.hasWorkspace(ws))) return reply.code(404).send({ error: 'instance not found' });
    const body = (req.body ?? {}) as { domain?: string | null };
    const domain = body.domain == null ? null : normalizeDomain(body.domain);
    if (domain != null) {
      const row = store.getDomain(domain);
      if (!row) return reply.code(400).send({ error: 'domain not registered' });
      if (row.workspace !== ws) return reply.code(403).send({ error: 'domain belongs to another workspace' });
      if (row.status !== 'verified') return reply.code(400).send({ error: 'domain not verified yet' });
    }
    await store.setDefaultDomain(ws, domain);
    const applied = await compute.applyDomain(ws);
    return {
      workspace: ws,
      defaultDomain: store.getDefaultDomain(ws),
      relabeled: applied.services,
      hosts: applied.hosts,
    };
  });
}
