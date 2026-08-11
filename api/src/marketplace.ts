// Coolify-backed marketplace — one-click apps (~330 templates) provisioned on
// a shared Coolify server, mapped 1:1 workspace ↔ Coolify project.
//
// The Coolify REST API has no catalog endpoint; the list of valid one-click
// types is only surfaced in the validation error of POST /services. We probe
// that once (a POST with an invalid type creates nothing server-side) and
// cache the result. Everything else uses documented endpoints.
//
// fetch is injectable so unit tests never touch the network.

export interface MarketplaceConfig {
  url: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export interface MarketplaceApp {
  uuid: string;
  name: string;
  type: string | null;
  status: string;
  domains: string[];
  createdAt: string | null;
}

export class MarketplaceError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

const PROJECT_PREFIX = 'ws-';
const TEMPLATE_CACHE_MS = 60 * 60 * 1000;

export function projectNameFor(workspace: string): string {
  return `${PROJECT_PREFIX}${workspace}`;
}

// Best-effort domain extraction from a compose fqdn env or the service JSON.
export function domainsOf(service: Record<string, unknown>): string[] {
  const apps = service.applications;
  if (!Array.isArray(apps)) return [];
  const out: string[] = [];
  for (const a of apps) {
    const fqdn = (a as Record<string, unknown>).fqdn;
    if (typeof fqdn === 'string' && fqdn) {
      out.push(...fqdn.split(',').map((d) => d.trim()).filter(Boolean));
    }
  }
  return out;
}

export class MarketplaceManager {
  readonly enabled: boolean;
  private url: string;
  private token: string;
  private fetchImpl: typeof fetch;
  private serverUuid: string | null = null;
  private projectCache = new Map<string, string>();
  private templates: string[] | null = null;
  private templatesAt = 0;

  constructor(config: Partial<MarketplaceConfig>) {
    this.url = (config.url ?? '').replace(/\/+$/, '');
    this.token = config.token ?? '';
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.enabled = Boolean(this.url && this.token);
  }

  private async api(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = 30000,
  ): Promise<{ status: number; json: unknown }> {
    if (!this.enabled) {
      throw new MarketplaceError(503, 'marketplace is not configured (COOLIFY_URL/COOLIFY_TOKEN)');
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
      if (err instanceof MarketplaceError) throw err;
      throw new MarketplaceError(502, `coolify unreachable: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async ensureServerUuid(): Promise<string> {
    if (this.serverUuid) return this.serverUuid;
    const { status, json } = await this.api('GET', '/servers');
    if (status !== 200 || !Array.isArray(json) || json.length === 0) {
      throw new MarketplaceError(502, 'no coolify servers available');
    }
    this.serverUuid = (json[0] as { uuid: string }).uuid;
    return this.serverUuid;
  }

  /** Coolify project for a workspace, created on first use. */
  private async ensureProject(workspace: string): Promise<string> {
    const cached = this.projectCache.get(workspace);
    if (cached) return cached;
    const name = projectNameFor(workspace);
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
      throw new MarketplaceError(502, `could not create coolify project for ${workspace}`);
    }
    this.projectCache.set(workspace, uuid);
    return uuid;
  }

  /** Any real project uuid — needed because Coolify validates the project before the type. */
  private async anyProjectUuid(): Promise<string> {
    const { status, json } = await this.api('GET', '/projects');
    if (status === 200 && Array.isArray(json) && json.length > 0) {
      return (json[0] as { uuid: string }).uuid;
    }
    const created = await this.api('POST', '/projects', {
      name: 'sm4rt-catalog',
      description: 'sm4rt-cloud catalog probe project',
    });
    const uuid = (created.json as { uuid?: string })?.uuid;
    if (!uuid) throw new MarketplaceError(502, 'could not resolve a coolify project for the catalog probe');
    return uuid;
  }

  /** Valid one-click types, probed from the create-service validation error. */
  async listTemplates(): Promise<string[]> {
    if (this.templates && Date.now() - this.templatesAt < TEMPLATE_CACHE_MS) {
      return this.templates;
    }
    const [server, project] = await Promise.all([
      this.ensureServerUuid(),
      this.anyProjectUuid(),
    ]);
    const { json } = await this.api('POST', '/services', {
      type: 'sm4rt-catalog-probe',
      server_uuid: server,
      project_uuid: project,
      environment_name: 'production',
    });
    const types = (json as { valid_service_types?: string[] })?.valid_service_types;
    if (!Array.isArray(types) || types.length === 0) {
      throw new MarketplaceError(502, 'could not fetch template catalog from coolify');
    }
    this.templates = types;
    this.templatesAt = Date.now();
    return types;
  }

  async listApps(workspace: string): Promise<MarketplaceApp[]> {
    const project = await this.ensureProject(workspace);
    const { status, json } = await this.api('GET', `/projects/${project}/production`);
    if (status === 404) return [];
    const services = (json as { services?: Array<Record<string, unknown>> })?.services;
    if (!Array.isArray(services)) return [];
    // The environment listing omits status/domains; fetch per-service detail.
    return Promise.all(
      services.map(async (s) => {
        const uuid = String(s.uuid);
        const detail = await this.api('GET', `/services/${uuid}`);
        const d = (detail.json ?? {}) as Record<string, unknown>;
        return {
          uuid,
          name: String(d.name ?? s.name ?? uuid),
          type: typeof d.service_type === 'string' ? d.service_type : null,
          status: String(d.status ?? 'unknown'),
          domains: domainsOf(d),
          createdAt: typeof s.created_at === 'string' ? s.created_at : null,
        };
      }),
    );
  }

  async createApp(
    workspace: string,
    input: { type: string; name?: string },
  ): Promise<{ uuid: string; domains: string[] }> {
    const type = (input.type ?? '').trim();
    if (!type) throw new MarketplaceError(400, 'type is required');
    const templates = await this.listTemplates();
    if (!templates.includes(type)) {
      throw new MarketplaceError(400, `unknown template: ${type}`);
    }
    const [server, project] = await Promise.all([
      this.ensureServerUuid(),
      this.ensureProject(workspace),
    ]);
    const { status, json } = await this.api('POST', '/services', {
      type,
      ...(input.name ? { name: input.name } : {}),
      server_uuid: server,
      project_uuid: project,
      environment_name: 'production',
      instant_deploy: true,
    });
    const body = (json ?? {}) as { uuid?: string; domains?: string[]; message?: string };
    if (status >= 300 || !body.uuid) {
      throw new MarketplaceError(status >= 400 && status < 500 ? status : 502,
        body.message ?? 'coolify rejected the service');
    }
    return { uuid: body.uuid, domains: body.domains ?? [] };
  }

  /** Ownership check: the service must live in this workspace's project. */
  private async assertOwned(workspace: string, uuid: string): Promise<void> {
    const project = await this.ensureProject(workspace);
    const { json } = await this.api('GET', `/projects/${project}/production`);
    const services = (json as { services?: Array<{ uuid: string }> })?.services ?? [];
    if (!services.some((s) => s.uuid === uuid)) {
      throw new MarketplaceError(404, `no marketplace app ${uuid} in ${workspace}`);
    }
  }

  async appAction(
    workspace: string,
    uuid: string,
    action: 'start' | 'stop' | 'restart',
  ): Promise<void> {
    await this.assertOwned(workspace, uuid);
    const { status } = await this.api('GET', `/services/${uuid}/${action}`);
    if (status >= 300) {
      throw new MarketplaceError(502, `coolify ${action} failed (HTTP ${status})`);
    }
  }

  async deleteApp(workspace: string, uuid: string): Promise<void> {
    await this.assertOwned(workspace, uuid);
    const { status } = await this.api(
      'DELETE',
      `/services/${uuid}?delete_volumes=true&delete_configurations=true&docker_cleanup=true`,
    );
    if (status >= 300) {
      throw new MarketplaceError(502, `coolify delete failed (HTTP ${status})`);
    }
  }
}
