// PaaS layer — Render-style deploys on the embedded Coolify engine.
// Two capabilities, both scoped to the workspace's ws-<name> project:
//   apps:      deploy a public git repo (nixpacks/dockerfile/static) to a
//              public URL on the platform domain
//   databases: managed engines (postgresql, mysql, mariadb, mongodb, redis,
//              keydb, dragonfly, clickhouse) with generated credentials
// The tenant never sees Coolify — this is our UI end to end.
// fetch is injectable so unit tests never touch the network.

export interface PaasConfig {
  url: string;
  token: string;
  fetchImpl?: typeof fetch;
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
export type PaasDbEngine = (typeof PAAS_DB_ENGINES)[number];

export const PAAS_BUILD_PACKS = ['nixpacks', 'dockerfile', 'static', 'dockercompose'] as const;
export type PaasBuildPack = (typeof PAAS_BUILD_PACKS)[number];

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

export class PaasError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

const PROJECT_PREFIX = 'ws-';
const APPS_DOMAIN = (process.env.COOLIFY_APPS_DOMAIN ?? '').trim();

export function isValidRepoUrl(url: string): boolean {
  return /^https:\/\/(github\.com|gitlab\.com|codeberg\.org|bitbucket\.org)\/[\w.-]+\/[\w.-]+?(\.git)?$/.test(
    url.trim(),
  );
}

export function isValidAppName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/.test(name) || /^[a-z0-9]$/.test(name);
}

/** engine → coolify db type path + how to read the connection url back */
function dbPath(engine: string): string {
  return `/databases/${engine}`;
}

export class PaasManager {
  readonly enabled: boolean;
  private url: string;
  private token: string;
  private fetchImpl: typeof fetch;
  private serverUuid: string | null = null;
  private projectCache = new Map<string, string>();

  constructor(config: Partial<PaasConfig>) {
    this.url = (config.url ?? '').replace(/\/+$/, '');
    this.token = config.token ?? '';
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.enabled = Boolean(this.url && this.token);
  }

  private async api(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = 60000,
  ): Promise<{ status: number; json: unknown }> {
    if (!this.enabled) {
      throw new PaasError(503, 'paas is not configured (COOLIFY_URL/COOLIFY_TOKEN)');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.url}/api/v1${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text };
      }
      return { status: res.status, json };
    } catch (err) {
      if (err instanceof PaasError) throw err;
      throw new PaasError(502, `paas engine unreachable: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async ensureServerUuid(): Promise<string> {
    if (this.serverUuid) return this.serverUuid;
    const { status, json } = await this.api('GET', '/servers');
    if (status !== 200 || !Array.isArray(json) || json.length === 0) {
      throw new PaasError(502, 'no paas servers available');
    }
    this.serverUuid = (json[0] as { uuid: string }).uuid;
    return this.serverUuid;
  }

  private async ensureProject(workspace: string): Promise<string> {
    const cached = this.projectCache.get(workspace);
    if (cached) return cached;
    const name = `${PROJECT_PREFIX}${workspace}`;
    const { status, json } = await this.api('GET', '/projects');
    if (status === 200 && Array.isArray(json)) {
      const found = json.find((p) => (p as { name: string }).name === name);
      if (found) {
        const uuid = (found as { uuid: string }).uuid;
        this.projectCache.set(workspace, uuid);
        return uuid;
      }
    }
    const created = await this.api('POST', '/projects', {
      name,
      description: `sm4rt-cloud workspace ${workspace}`,
    });
    const uuid = (created.json as { uuid?: string })?.uuid;
    if (created.status >= 300 || !uuid) {
      throw new PaasError(502, `could not create paas project for ${workspace}`);
    }
    this.projectCache.set(workspace, uuid);
    return uuid;
  }

  /** every uuid (apps+dbs) living in this workspace's project environment */
  private async projectResourceUuids(
    workspace: string,
  ): Promise<{ apps: Set<string>; dbs: Set<string> }> {
    const project = await this.ensureProject(workspace);
    const { json } = await this.api('GET', `/projects/${project}/production`);
    const env = (json ?? {}) as Record<string, unknown>;
    const apps = new Set<string>();
    for (const a of (env.applications as Array<{ uuid: string }> | undefined) ?? []) {
      apps.add(a.uuid);
    }
    const dbs = new Set<string>();
    for (const key of ['postgresqls', 'mysqls', 'mariadbs', 'mongodbs', 'redis', 'keydbs', 'dragonflies', 'clickhouses']) {
      for (const d of (env[key] as Array<{ uuid: string }> | undefined) ?? []) {
        dbs.add(d.uuid);
      }
    }
    return { apps, dbs };
  }

  // ————————————————— apps (deploy from git) —————————————————

  async listApps(workspace: string): Promise<PaasApp[]> {
    const { apps } = await this.projectResourceUuids(workspace);
    if (apps.size === 0) return [];
    const { status, json } = await this.api('GET', '/applications');
    if (status !== 200 || !Array.isArray(json)) return [];
    return (json as Array<Record<string, unknown>>)
      .filter((a) => apps.has(String(a.uuid)))
      .map((a) => ({
        uuid: String(a.uuid),
        name: String(a.name ?? a.uuid),
        repository: typeof a.git_repository === 'string' ? a.git_repository : null,
        branch: typeof a.git_branch === 'string' ? a.git_branch : null,
        buildPack: typeof a.build_pack === 'string' ? a.build_pack : null,
        status: String(a.status ?? 'unknown'),
        fqdn: typeof a.fqdn === 'string' && a.fqdn ? a.fqdn.split(',')[0].trim() : null,
        createdAt: typeof a.created_at === 'string' ? a.created_at : null,
      }));
  }

  async createApp(
    workspace: string,
    input: { name: string; repository: string; branch?: string; buildPack?: string; port?: number },
  ): Promise<{ uuid: string; fqdn: string | null }> {
    const name = (input.name ?? '').trim();
    if (!isValidAppName(name)) {
      throw new PaasError(400, 'invalid app name (lowercase, digits, dashes, ≤40 chars)');
    }
    if (!isValidRepoUrl(input.repository ?? '')) {
      throw new PaasError(400, 'repository must be a public https git URL (github/gitlab/codeberg/bitbucket)');
    }
    const buildPack = (input.buildPack ?? 'nixpacks') as PaasBuildPack;
    if (!PAAS_BUILD_PACKS.includes(buildPack)) {
      throw new PaasError(400, `unknown build pack: ${input.buildPack}`);
    }
    const [server, project] = await Promise.all([
      this.ensureServerUuid(),
      this.ensureProject(workspace),
    ]);
    const fqdn = APPS_DOMAIN ? `https://${name}-${workspace}.${APPS_DOMAIN}` : undefined;
    const { status, json } = await this.api('POST', '/applications/public', {
      name: `${workspace}-${name}`,
      project_uuid: project,
      server_uuid: server,
      environment_name: 'production',
      git_repository: input.repository.trim(),
      git_branch: input.branch?.trim() || 'main',
      build_pack: buildPack,
      ports_exposes: String(input.port ?? 3000),
      ...(fqdn ? { domains: fqdn } : {}),
      instant_deploy: true,
    });
    const body = (json ?? {}) as { uuid?: string; domains?: string[]; message?: string };
    if (status >= 300 || !body.uuid) {
      throw new PaasError(
        status >= 400 && status < 500 ? status : 502,
        body.message ?? 'paas engine rejected the app',
      );
    }
    return { uuid: body.uuid, fqdn: fqdn ?? body.domains?.[0] ?? null };
  }

  async appAction(
    workspace: string,
    uuid: string,
    action: 'start' | 'stop' | 'restart' | 'deploy',
  ): Promise<void> {
    const { apps } = await this.projectResourceUuids(workspace);
    if (!apps.has(uuid)) throw new PaasError(404, `no app ${uuid} in ${workspace}`);
    const path =
      action === 'deploy' ? `/deploy?uuid=${uuid}&force=false` : `/applications/${uuid}/${action}`;
    const { status } = await this.api('GET', path);
    if (status >= 300) throw new PaasError(502, `paas ${action} failed (HTTP ${status})`);
  }

  async deleteApp(workspace: string, uuid: string): Promise<void> {
    const { apps } = await this.projectResourceUuids(workspace);
    if (!apps.has(uuid)) throw new PaasError(404, `no app ${uuid} in ${workspace}`);
    const { status } = await this.api(
      'DELETE',
      `/applications/${uuid}?delete_volumes=true&delete_configurations=true&docker_cleanup=true`,
    );
    if (status >= 300) throw new PaasError(502, `paas delete failed (HTTP ${status})`);
  }

  // ————————————————— managed databases —————————————————

  async listDatabases(workspace: string): Promise<PaasDatabase[]> {
    const { dbs } = await this.projectResourceUuids(workspace);
    if (dbs.size === 0) return [];
    const { status, json } = await this.api('GET', '/databases');
    if (status !== 200 || !Array.isArray(json)) return [];
    return (json as Array<Record<string, unknown>>)
      .filter((d) => dbs.has(String(d.uuid)))
      .map((d) => ({
        uuid: String(d.uuid),
        name: String(d.name ?? d.uuid),
        engine: String((d.database_type as string | undefined)?.replace(/^standalone-/, '') ?? 'unknown'),
        status: String(d.status ?? 'unknown'),
        internalUrl: typeof d.internal_db_url === 'string' ? d.internal_db_url : null,
        createdAt: typeof d.created_at === 'string' ? d.created_at : null,
      }));
  }

  async createDatabase(
    workspace: string,
    input: { engine: string; name?: string },
  ): Promise<{ uuid: string }> {
    const engine = (input.engine ?? '').trim() as PaasDbEngine;
    if (!PAAS_DB_ENGINES.includes(engine)) {
      throw new PaasError(400, `unknown engine: ${input.engine} (valid: ${PAAS_DB_ENGINES.join(', ')})`);
    }
    const [server, project] = await Promise.all([
      this.ensureServerUuid(),
      this.ensureProject(workspace),
    ]);
    const { status, json } = await this.api('POST', dbPath(engine), {
      ...(input.name ? { name: `${workspace}-${input.name.trim()}` } : {}),
      project_uuid: project,
      server_uuid: server,
      environment_name: 'production',
      instant_deploy: true,
    });
    const body = (json ?? {}) as { uuid?: string; message?: string };
    if (status >= 300 || !body.uuid) {
      throw new PaasError(
        status >= 400 && status < 500 ? status : 502,
        body.message ?? 'paas engine rejected the database',
      );
    }
    return { uuid: body.uuid };
  }

  async databaseAction(
    workspace: string,
    uuid: string,
    action: 'start' | 'stop' | 'restart',
  ): Promise<void> {
    const { dbs } = await this.projectResourceUuids(workspace);
    if (!dbs.has(uuid)) throw new PaasError(404, `no database ${uuid} in ${workspace}`);
    const { status } = await this.api('GET', `/databases/${uuid}/${action}`);
    if (status >= 300) throw new PaasError(502, `paas db ${action} failed (HTTP ${status})`);
  }

  async deleteDatabase(workspace: string, uuid: string): Promise<void> {
    const { dbs } = await this.projectResourceUuids(workspace);
    if (!dbs.has(uuid)) throw new PaasError(404, `no database ${uuid} in ${workspace}`);
    const { status } = await this.api(
      'DELETE',
      `/databases/${uuid}?delete_volumes=true&delete_configurations=true&docker_cleanup=true`,
    );
    if (status >= 300) throw new PaasError(502, `paas db delete failed (HTTP ${status})`);
  }
}
