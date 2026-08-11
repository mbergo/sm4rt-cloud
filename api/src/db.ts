// Persistence layer — Postgres when DATABASE_URL is set, JSON file otherwise.
//
// Scope is deliberately small: users (synced from Clerk), tenant domains and
// per-workspace settings (default domain). Swarm labels remain the source of
// truth for compute resources; this store only holds what the cluster cannot.
//
// All reads used on hot paths (tls-ask, endpoint host generation) are served
// synchronously from an in-memory cache loaded at init() and updated on every
// write. The API runs as a single replica, so the cache is always coherent.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface DomainRow {
  domain: string;
  workspace: string;
  verifyToken: string;
  status: 'pending' | 'verified';
  createdAt: string;
  verifiedAt: string | null;
}

export interface UserRow {
  clerkId: string;
  email: string | null;
  createdAt: string;
}

export interface CoolifyServerRow {
  id: string;
  label: string;
  url: string;
  token: string;
  createdAt: string;
}

interface Snapshot {
  users: UserRow[];
  domains: DomainRow[];
  workspaceSettings: Record<string, { defaultDomain: string | null }>;
  coolifyServers: CoolifyServerRow[];
}

const EMPTY: Snapshot = { users: [], domains: [], workspaceSettings: {}, coolifyServers: [] };

export class Store {
  readonly backend: 'postgres' | 'file';
  private pool: import('pg').Pool | null = null;
  private file: string;
  private cache: Snapshot = structuredClone(EMPTY);

  constructor(opts: { databaseUrl?: string; dataFile?: string } = {}) {
    this.backend = opts.databaseUrl ? 'postgres' : 'file';
    this.file =
      opts.dataFile ??
      process.env.DATA_FILE ??
      path.resolve(import.meta.dirname, '../.data/store.json');
    if (opts.databaseUrl) {
      this.pool = null; // created in init() so constructing a Store stays side-effect free
      this.databaseUrl = opts.databaseUrl;
    }
  }
  private databaseUrl = '';

  async init(): Promise<void> {
    if (this.backend === 'postgres') {
      const { default: pg } = await import('pg');
      this.pool = new pg.Pool({ connectionString: this.databaseUrl, max: 5 });
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          clerk_id text PRIMARY KEY,
          email text,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS domains (
          domain text PRIMARY KEY,
          workspace text NOT NULL,
          verify_token text NOT NULL,
          status text NOT NULL DEFAULT 'pending',
          created_at timestamptz NOT NULL DEFAULT now(),
          verified_at timestamptz
        );
        CREATE TABLE IF NOT EXISTS workspace_settings (
          workspace text PRIMARY KEY,
          default_domain text,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS coolify_servers (
          id text PRIMARY KEY,
          label text NOT NULL,
          url text NOT NULL,
          token text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
      `);
      await this.reloadFromPg();
      return;
    }
    try {
      this.cache = { ...structuredClone(EMPTY), ...JSON.parse(readFileSync(this.file, 'utf8')) };
    } catch {
      this.cache = structuredClone(EMPTY);
    }
  }

  async close(): Promise<void> {
    await this.pool?.end();
  }

  private async reloadFromPg(): Promise<void> {
    if (!this.pool) return;
    const [users, domains, settings, coolify] = await Promise.all([
      this.pool.query('SELECT clerk_id, email, created_at FROM users'),
      this.pool.query(
        'SELECT domain, workspace, verify_token, status, created_at, verified_at FROM domains',
      ),
      this.pool.query('SELECT workspace, default_domain FROM workspace_settings'),
      this.pool.query('SELECT id, label, url, token, created_at FROM coolify_servers'),
    ]);
    this.cache = {
      users: users.rows.map((r) => ({
        clerkId: r.clerk_id,
        email: r.email,
        createdAt: new Date(r.created_at).toISOString(),
      })),
      domains: domains.rows.map((r) => ({
        domain: r.domain,
        workspace: r.workspace,
        verifyToken: r.verify_token,
        status: r.status,
        createdAt: new Date(r.created_at).toISOString(),
        verifiedAt: r.verified_at ? new Date(r.verified_at).toISOString() : null,
      })),
      workspaceSettings: Object.fromEntries(
        settings.rows.map((r) => [r.workspace, { defaultDomain: r.default_domain }]),
      ),
      coolifyServers: coolify.rows.map((r) => ({
        id: r.id,
        label: r.label,
        url: r.url,
        token: r.token,
        createdAt: new Date(r.created_at).toISOString(),
      })),
    };
  }

  private persistFile(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.cache, null, 2));
    renameSync(tmp, this.file);
  }

  // — users —

  async upsertUser(clerkId: string, email: string | null): Promise<void> {
    const existing = this.cache.users.find((u) => u.clerkId === clerkId);
    if (existing) {
      if (email && existing.email !== email) {
        existing.email = email;
        if (this.pool) {
          await this.pool.query('UPDATE users SET email = $2 WHERE clerk_id = $1', [
            clerkId,
            email,
          ]);
        } else {
          this.persistFile();
        }
      }
      return;
    }
    const row: UserRow = { clerkId, email, createdAt: new Date().toISOString() };
    this.cache.users.push(row);
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO users (clerk_id, email) VALUES ($1, $2)
         ON CONFLICT (clerk_id) DO UPDATE SET email = COALESCE(EXCLUDED.email, users.email)`,
        [clerkId, email],
      );
    } else {
      this.persistFile();
    }
  }

  countUsers(): number {
    return this.cache.users.length;
  }

  // — domains —

  listDomains(workspace?: string): DomainRow[] {
    const rows = workspace
      ? this.cache.domains.filter((d) => d.workspace === workspace)
      : this.cache.domains;
    return rows.map((d) => ({ ...d }));
  }

  getDomain(domain: string): DomainRow | null {
    const row = this.cache.domains.find((d) => d.domain === domain.toLowerCase());
    return row ? { ...row } : null;
  }

  async createDomain(domain: string, workspace: string): Promise<DomainRow> {
    const row: DomainRow = {
      domain: domain.toLowerCase(),
      workspace,
      verifyToken: `sm4rt-verify-${randomBytes(16).toString('hex')}`,
      status: 'pending',
      createdAt: new Date().toISOString(),
      verifiedAt: null,
    };
    this.cache.domains.push(row);
    if (this.pool) {
      await this.pool.query(
        'INSERT INTO domains (domain, workspace, verify_token, status) VALUES ($1, $2, $3, $4)',
        [row.domain, row.workspace, row.verifyToken, row.status],
      );
    } else {
      this.persistFile();
    }
    return { ...row };
  }

  async markVerified(domain: string): Promise<DomainRow | null> {
    const row = this.cache.domains.find((d) => d.domain === domain.toLowerCase());
    if (!row) return null;
    row.status = 'verified';
    row.verifiedAt = new Date().toISOString();
    if (this.pool) {
      await this.pool.query(
        "UPDATE domains SET status = 'verified', verified_at = now() WHERE domain = $1",
        [row.domain],
      );
    } else {
      this.persistFile();
    }
    return { ...row };
  }

  async deleteDomain(domain: string): Promise<boolean> {
    const lower = domain.toLowerCase();
    const idx = this.cache.domains.findIndex((d) => d.domain === lower);
    if (idx < 0) return false;
    this.cache.domains.splice(idx, 1);
    // A deleted domain can no longer be any workspace's default.
    for (const [ws, s] of Object.entries(this.cache.workspaceSettings)) {
      if (s.defaultDomain === lower) {
        s.defaultDomain = null;
        if (this.pool) {
          await this.pool.query(
            'UPDATE workspace_settings SET default_domain = NULL, updated_at = now() WHERE workspace = $1',
            [ws],
          );
        }
      }
    }
    if (this.pool) {
      await this.pool.query('DELETE FROM domains WHERE domain = $1', [lower]);
    } else {
      this.persistFile();
    }
    return true;
  }

  /** Verified domain owning `host` (exact match or parent of), if any. */
  domainForHost(host: string): DomainRow | null {
    const lower = host.toLowerCase();
    for (const d of this.cache.domains) {
      if (d.status !== 'verified') continue;
      if (lower === d.domain || lower.endsWith(`.${d.domain}`)) return { ...d };
    }
    return null;
  }

  // — workspace settings —

  getDefaultDomain(workspace: string): string | null {
    return this.cache.workspaceSettings[workspace]?.defaultDomain ?? null;
  }

  workspacesUsingDomain(domain: string): string[] {
    return Object.entries(this.cache.workspaceSettings)
      .filter(([, v]) => v.defaultDomain === domain)
      .map(([ws]) => ws);
  }

  async setDefaultDomain(workspace: string, domain: string | null): Promise<void> {
    this.cache.workspaceSettings[workspace] = { defaultDomain: domain };
    if (this.pool) {
      await this.pool.query(
        `INSERT INTO workspace_settings (workspace, default_domain) VALUES ($1, $2)
         ON CONFLICT (workspace) DO UPDATE SET default_domain = EXCLUDED.default_domain, updated_at = now()`,
        [workspace, domain],
      );
    } else {
      this.persistFile();
    }
  }

  // — coolify servers (admin-registered; the env-configured one lives outside the store) —

  listCoolifyServers(): CoolifyServerRow[] {
    return this.cache.coolifyServers.map((s) => ({ ...s }));
  }

  async addCoolifyServer(input: { label: string; url: string; token: string }): Promise<CoolifyServerRow> {
    const row: CoolifyServerRow = {
      id: `coolify-${randomBytes(6).toString('hex')}`,
      label: input.label,
      url: input.url.replace(/\/+$/, ''),
      token: input.token,
      createdAt: new Date().toISOString(),
    };
    this.cache.coolifyServers.push(row);
    if (this.pool) {
      await this.pool.query(
        'INSERT INTO coolify_servers (id, label, url, token) VALUES ($1, $2, $3, $4)',
        [row.id, row.label, row.url, row.token],
      );
    } else {
      this.persistFile();
    }
    return { ...row };
  }

  async removeCoolifyServer(id: string): Promise<boolean> {
    const idx = this.cache.coolifyServers.findIndex((s) => s.id === id);
    if (idx < 0) return false;
    this.cache.coolifyServers.splice(idx, 1);
    if (this.pool) {
      await this.pool.query('DELETE FROM coolify_servers WHERE id = $1', [id]);
    } else {
      this.persistFile();
    }
    return true;
  }
}
