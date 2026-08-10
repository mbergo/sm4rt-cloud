// RegistryManager — Sm4rt Container Registry: one real Docker registry:2 per
// workspace, published over HTTPS via caddy-docker-proxy with htpasswd auth,
// so `docker login/push/pull` work exactly like any other cloud registry.
// Repos/tags are read straight from the registry HTTP API v2 (catalog, tags,
// manifests) executed inside the registry container (curl via docker exec),
// which works both in prod (API inside the swarm) and local dev.
import bcrypt from 'bcryptjs';
import type Docker from 'dockerode';
import {
  SM4RT_KIND_LABEL,
  SM4RT_NAME_LABEL,
  SM4RT_WS_LABEL,
  randomSecret,
} from './compute-templates.ts';
import { ComputeError, type ComputeManager } from './compute.ts';

const NETWORK_NAME = process.env.SWARM_NETWORK ?? 'floci-net';

interface RegistrySecrets {
  user: string;
  pass: string;
}

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

function cpusToNano(c: number): number {
  return Math.round(c * 1e9);
}
function mbToBytes(mb: number): number {
  return Math.round(mb * 1024 ** 2);
}
function isNotFoundErr(err: unknown): boolean {
  return (err as { statusCode?: number })?.statusCode === 404;
}

/** htpasswd line in the bcrypt format the registry expects */
export function htpasswdLine(user: string, pass: string): string {
  return `${user}:${bcrypt.hashSync(pass, 10)}`;
}

/** repo names per distribution spec: lowercase path segments (a/b/c) */
export function isValidRepoName(repo: string): boolean {
  if (!repo || repo.length > 255) return false;
  return repo
    .split('/')
    .every((seg) => /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*$/.test(seg));
}

export class RegistryManager {
  private docker: Docker;
  private compute: ComputeManager;
  private tls: boolean;

  constructor(compute: ComputeManager) {
    this.compute = compute;
    this.docker = compute.dockerClient;
    this.tls = compute.options.tls;
  }

  private scheme(): string {
    return this.tls ? 'https' : 'http';
  }
  private serviceName(ws: string) {
    return `sm4rt-registry-${ws}`;
  }
  private secretsConfig(ws: string) {
    return `sm4rt-registry-${ws}-secrets`;
  }
  private host(ws: string) {
    return this.compute.hostFor(ws, 'registry');
  }

  // — docker config as tiny KV store (same pattern as DevopsManager) —
  private async readConfig<T>(name: string): Promise<T | null> {
    try {
      const configs = (await this.docker.listConfigs({
        filters: JSON.stringify({ name: [name] }),
      })) as Array<{ ID: string; Spec?: { Name?: string } }>;
      const found = configs.find((c) => c.Spec?.Name === name);
      if (!found) return null;
      const inspected = (await this.docker.getConfig(found.ID).inspect()) as {
        Spec?: { Data?: string };
      };
      const data = inspected.Spec?.Data;
      if (!data) return null;
      return JSON.parse(Buffer.from(data, 'base64').toString('utf8')) as T;
    } catch (err) {
      if (isNotFoundErr(err)) return null;
      throw err;
    }
  }

  private async writeConfig(name: string, value: unknown, kind: string): Promise<void> {
    try {
      const configs = (await this.docker.listConfigs({
        filters: JSON.stringify({ name: [name] }),
      })) as Array<{ ID: string; Spec?: { Name?: string } }>;
      const found = configs.find((c) => c.Spec?.Name === name);
      if (found) await this.docker.getConfig(found.ID).remove();
    } catch {
      // ignore
    }
    await this.docker.createConfig({
      Name: name,
      Data: Buffer.from(JSON.stringify(value), 'utf8').toString('base64'),
      Labels: { [SM4RT_KIND_LABEL]: kind },
    });
  }

  private async createConfigRaw(baseName: string, data: string): Promise<{ name: string; id: string }> {
    const name = `${baseName}-${Date.now().toString(36)}`;
    await this.docker.createConfig({
      Name: name,
      Data: Buffer.from(data, 'utf8').toString('base64'),
      Labels: { [SM4RT_KIND_LABEL]: 'registry-htpasswd' },
    });
    const configs = (await this.docker.listConfigs({
      filters: JSON.stringify({ name: [name] }),
    })) as Array<{ ID: string; Spec?: { Name?: string } }>;
    const found = configs.find((c) => c.Spec?.Name === name);
    if (!found) throw new ComputeError(500, `config ${name} not found after create`);
    return { name, id: found.ID };
  }

  private async removeConfigsByPrefix(prefix: string): Promise<void> {
    try {
      const configs = (await this.docker.listConfigs({})) as Array<{
        ID: string;
        Spec?: { Name?: string };
      }>;
      for (const c of configs) {
        const n = c.Spec?.Name ?? '';
        if (n === prefix || n.startsWith(`${prefix}-`)) {
          try {
            await this.docker.getConfig(c.ID).remove();
          } catch {
            // in use or already gone — best effort
          }
        }
      }
    } catch {
      // listConfigs unsupported — ignore
    }
  }

  private async getServiceRaw(name: string): Promise<Record<string, any> | null> {
    try {
      return (await this.docker.getService(name).inspect()) as Record<string, any>;
    } catch (err) {
      if (isNotFoundErr(err)) return null;
      throw err;
    }
  }

  private async serviceRunning(name: string): Promise<boolean> {
    try {
      const tasks = (await this.docker.listTasks({
        filters: JSON.stringify({ service: [name] }),
      })) as Array<Record<string, any>>;
      return tasks.some((t) => t.Status?.State === 'running' && t.DesiredState === 'running');
    } catch {
      return false;
    }
  }

  // ————————————————— enable / status / disable —————————————————

  async status(ws: string): Promise<RegistryStatus> {
    const svc = await this.getServiceRaw(this.serviceName(ws));
    if (!svc) {
      return { enabled: false, state: 'disabled', host: null, url: null, user: null, password: null };
    }
    const secrets = await this.readConfig<RegistrySecrets>(this.secretsConfig(ws));
    const up = await this.serviceRunning(this.serviceName(ws));
    const host = this.host(ws);
    return {
      enabled: true,
      state: up ? 'running' : 'starting',
      host,
      url: `${this.scheme()}://${host}`,
      user: secrets?.user ?? null,
      password: secrets?.pass ?? null,
    };
  }

  async enable(ws: string): Promise<RegistryStatus> {
    await this.compute.ensureNet();
    if (await this.getServiceRaw(this.serviceName(ws))) {
      throw new ComputeError(409, 'registry already enabled');
    }
    const secrets: RegistrySecrets = { user: ws, pass: randomSecret(16) };
    await this.writeConfig(this.secretsConfig(ws), secrets, 'registry-state');
    const htpasswd = await this.createConfigRaw(
      `sm4rt-registry-${ws}-htpasswd`,
      `${htpasswdLine(secrets.user, secrets.pass)}\n`,
    );
    const name = this.serviceName(ws);
    const host = this.host(ws);
    await this.docker.createService({
      Name: name,
      Labels: {
        [SM4RT_KIND_LABEL]: 'registry',
        [SM4RT_WS_LABEL]: ws,
        [SM4RT_NAME_LABEL]: 'registry',
        ...this.compute.caddyLabelsFor(host, 5000),
      },
      TaskTemplate: {
        ContainerSpec: {
          Image: 'registry:2',
          Env: [
            'REGISTRY_AUTH=htpasswd',
            'REGISTRY_AUTH_HTPASSWD_REALM=sm4rt-registry',
            'REGISTRY_AUTH_HTPASSWD_PATH=/auth/htpasswd',
            'REGISTRY_STORAGE_DELETE_ENABLED=true',
            `REGISTRY_HTTP_SECRET=${randomSecret(24)}`,
          ],
          Labels: { [SM4RT_WS_LABEL]: ws, [SM4RT_KIND_LABEL]: 'registry', [SM4RT_NAME_LABEL]: 'registry' },
          Mounts: [
            {
              Type: 'volume',
              Source: `${name}-data`,
              Target: '/var/lib/registry',
              VolumeOptions: { Labels: { [SM4RT_WS_LABEL]: ws } },
            } as unknown as Docker.MountSettings,
          ],
          Configs: [
            {
              ConfigID: htpasswd.id,
              ConfigName: htpasswd.name,
              File: { Name: '/auth/htpasswd', UID: '0', GID: '0', Mode: 0o444 },
            },
          ],
        },
        Resources: { Limits: { NanoCPUs: cpusToNano(1), MemoryBytes: mbToBytes(512) } },
        RestartPolicy: { Condition: 'any', Delay: 5_000_000_000 },
        // manager node: repo listing uses container.exec via the manager socket
        Placement: { Constraints: ['node.role == manager'] },
        Networks: [{ Target: NETWORK_NAME, Aliases: [name] }],
      },
      Mode: { Replicated: { Replicas: 1 } },
      EndpointSpec: { Mode: 'dnsrr' },
    } as Docker.CreateServiceOptions);
    return this.status(ws);
  }

  async disable(ws: string): Promise<void> {
    const name = this.serviceName(ws);
    const svc = await this.getServiceRaw(name);
    if (svc) {
      await this.docker.getService(name).remove();
    }
    await this.removeConfigsByPrefix(this.secretsConfig(ws));
    await this.removeConfigsByPrefix(`sm4rt-registry-${ws}-htpasswd`);
    try {
      await this.docker.getVolume(`${name}-data`).remove();
    } catch {
      // still in use or already gone — best effort
    }
    if (!svc) throw new ComputeError(404, 'registry not enabled');
  }

  // ————————————————— registry HTTP API v2 —————————————————
  // In prod the API task runs on the same overlay network as the registry, so
  // the swarm DNS alias resolves and we talk plain HTTP. In local dev (API on
  // the host) we fall back to the public host through caddy.

  private async http(
    ws: string,
    method: string,
    path: string,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    const secrets = await this.readConfig<RegistrySecrets>(this.secretsConfig(ws));
    if (!secrets) throw new ComputeError(503, 'registry secrets not found');
    const auth = `Basic ${Buffer.from(`${secrets.user}:${secrets.pass}`).toString('base64')}`;
    const init: RequestInit = {
      method,
      headers: { Authorization: auth, ...headers },
      signal: AbortSignal.timeout(10_000),
    };
    try {
      return await fetch(`http://${this.serviceName(ws)}:5000${path}`, init);
    } catch {
      // overlay DNS not reachable (local dev) — go through the public edge
      try {
        return await fetch(`${this.scheme()}://${this.host(ws)}${path}`, init);
      } catch (err) {
        throw new ComputeError(502, `registry unreachable: ${(err as Error).message}`);
      }
    }
  }

  async listRepos(ws: string): Promise<RegistryRepo[]> {
    const cat = await this.http(ws, 'GET', '/v2/_catalog?n=200');
    if (cat.status !== 200) throw new ComputeError(502, `registry catalog returned ${cat.status}`);
    const parsed = (await cat.json()) as { repositories?: string[] };
    const repos = parsed.repositories ?? [];
    const out: RegistryRepo[] = [];
    for (const repo of repos) {
      const tagsRes = await this.http(ws, 'GET', `/v2/${repo}/tags/list?n=100`);
      let tags: string[] = [];
      if (tagsRes.status === 200) {
        const t = (await tagsRes.json()) as { tags?: string[] | null };
        tags = t.tags ?? [];
      }
      out.push({ name: repo, tags: tags.sort() });
    }
    return out;
  }

  async deleteTag(ws: string, repo: string, tag: string): Promise<void> {
    if (!isValidRepoName(repo)) throw new ComputeError(400, 'invalid repository name');
    if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(tag)) {
      throw new ComputeError(400, 'invalid tag');
    }
    const head = await this.http(ws, 'HEAD', `/v2/${repo}/manifests/${tag}`, {
      Accept: [
        'application/vnd.docker.distribution.manifest.v2+json',
        'application/vnd.oci.image.manifest.v1+json',
        'application/vnd.docker.distribution.manifest.list.v2+json',
        'application/vnd.oci.image.index.v1+json',
      ].join(', '),
    });
    if (head.status === 404) throw new ComputeError(404, 'tag not found');
    if (head.status !== 200) throw new ComputeError(502, `manifest lookup returned ${head.status}`);
    const digest = head.headers.get('docker-content-digest');
    if (!digest) throw new ComputeError(502, 'registry did not return a digest');
    const del = await this.http(ws, 'DELETE', `/v2/${repo}/manifests/${digest}`);
    if (del.status !== 202 && del.status !== 404) {
      throw new ComputeError(502, `manifest delete returned ${del.status}`);
    }
  }
}
