// DevopsManager — Sm4rt DevOps: per-workspace Gitea (git + registry),
// Woodpecker CI (server + docker agent) and a GitOps reconciler that keeps
// swarm tasks in sync with a deploy spec committed to git (Argo-style,
// implemented natively for Swarm).
import type Docker from 'dockerode';
import { parse as parseYaml } from 'yaml';
import {
  SM4RT_KIND_LABEL,
  SM4RT_NAME_LABEL,
  SM4RT_WS_LABEL,
  isValidResourceName,
  randomSecret,
  validateGitopsSpec,
} from './compute-templates.ts';
import { ComputeError, type ComputeManager } from './compute.ts';

const NETWORK_NAME = process.env.SWARM_NETWORK ?? 'floci-net';

interface DevopsSecrets {
  adminUser: string;
  adminPass: string;
  token: string;
  clientId?: string;
  clientSecret?: string;
  agentSecret: string;
}

export interface DevopsStatus {
  enabled: boolean;
  state: string;
  gitUrl: string | null;
  ciUrl: string | null;
  adminUser: string | null;
  adminPassword: string | null;
  registry: string | null;
  bootstrapped: boolean;
  message?: string;
}

export interface GitopsApp {
  name: string;
  repo: string;
  branch: string;
  path: string;
  autoSync: boolean;
  status?: 'Synced' | 'OutOfSync' | 'Error' | 'Unknown';
  revision?: string | null;
  appliedRevision?: string | null;
  lastError?: string | null;
  lastSyncAt?: string | null;
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

export class DevopsManager {
  private docker: Docker;
  private compute: ComputeManager;
  private tls: boolean;
  private syncTimer: NodeJS.Timeout | null = null;
  private syncing = false;
  private appState = new Map<string, { lastError: string | null; lastSyncAt: string | null }>();

  constructor(compute: ComputeManager) {
    this.compute = compute;
    this.docker = compute.dockerClient;
    this.tls = compute.options.tls;
  }

  private scheme(): string {
    return this.tls ? 'https' : 'http';
  }
  private gitService(ws: string) {
    return `sm4rt-devops-${ws}-git`;
  }
  private ciService(ws: string) {
    return `sm4rt-devops-${ws}-ci`;
  }
  private ciAgentService(ws: string) {
    return `sm4rt-devops-${ws}-ci-agent`;
  }
  private secretsConfig(ws: string) {
    return `sm4rt-devops-${ws}-secrets`;
  }
  private gitopsConfig(ws: string) {
    return `sm4rt-gitops-${ws}`;
  }
  private gitHost(ws: string) {
    return this.compute.hostFor(ws, 'git');
  }
  private ciHost(ws: string) {
    return this.compute.hostFor(ws, 'ci');
  }

  // — docker config as tiny KV store (config not attached to services can be rotated) —
  private async readConfig<T>(name: string): Promise<T | null> {
    try {
      const configs = (await this.docker.listConfigs({
        filters: JSON.stringify({ name: [name] }),
      })) as Array<{ ID: string; Spec?: { Name?: string; Data?: string } }>;
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

  private async writeConfig(name: string, value: unknown): Promise<void> {
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
      Labels: { [SM4RT_KIND_LABEL]: 'devops-state' },
    });
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

  async status(ws: string): Promise<DevopsStatus> {
    const git = await this.getServiceRaw(this.gitService(ws));
    if (!git) {
      return {
        enabled: false,
        state: 'disabled',
        gitUrl: null,
        ciUrl: null,
        adminUser: null,
        adminPassword: null,
        registry: null,
        bootstrapped: false,
      };
    }
    const secrets = await this.readConfig<DevopsSecrets>(this.secretsConfig(ws));
    const gitUp = await this.serviceRunning(this.gitService(ws));
    const ciUp = await this.serviceRunning(this.ciService(ws));
    const state = gitUp && ciUp ? 'running' : gitUp || ciUp ? 'starting' : 'starting';
    return {
      enabled: true,
      state,
      gitUrl: `${this.scheme()}://${this.gitHost(ws)}`,
      ciUrl: `${this.scheme()}://${this.ciHost(ws)}`,
      adminUser: secrets?.adminUser ?? null,
      adminPassword: secrets?.adminPass ?? null,
      registry: this.gitHost(ws),
      bootstrapped: Boolean(secrets?.token),
    };
  }

  async enable(ws: string): Promise<DevopsStatus> {
    await this.compute.ensureNet();
    if (await this.getServiceRaw(this.gitService(ws))) {
      throw new ComputeError(409, 'DevOps stack already enabled');
    }
    const secrets: DevopsSecrets = {
      adminUser: 'sm4rt',
      adminPass: randomSecret(16),
      token: '',
      agentSecret: randomSecret(32),
    };
    await this.writeConfig(this.secretsConfig(ws), secrets);
    await this.createGitea(ws);
    // bootstrap runs in background: wait for gitea, create admin+token+oauth, start CI
    void this.bootstrap(ws).catch((err) => {
      console.error(`[devops:${ws}] bootstrap failed:`, (err as Error).message);
    });
    return this.status(ws);
  }

  private async createGitea(ws: string): Promise<void> {
    const name = this.gitService(ws);
    const rootUrl = `${this.scheme()}://${this.gitHost(ws)}/`;
    await this.docker.createService({
      Name: name,
      Labels: {
        [SM4RT_KIND_LABEL]: 'devops',
        [SM4RT_WS_LABEL]: ws,
        [SM4RT_NAME_LABEL]: 'git',
        ...this.compute.caddyLabelsFor(this.gitHost(ws), 3000),
      },
      TaskTemplate: {
        ContainerSpec: {
          Image: 'gitea/gitea:1.22',
          Env: [
            `GITEA__server__ROOT_URL=${rootUrl}`,
            `GITEA__server__DOMAIN=${this.gitHost(ws)}`,
            'GITEA__server__HTTP_PORT=3000',
            'GITEA__security__INSTALL_LOCK=true',
            'GITEA__service__DISABLE_REGISTRATION=true',
            'GITEA__database__DB_TYPE=sqlite3',
            'GITEA__packages__ENABLED=true',
            'GITEA__webhook__ALLOWED_HOST_LIST=*',
            'GITEA__actions__ENABLED=false',
          ],
          Labels: { [SM4RT_WS_LABEL]: ws, [SM4RT_KIND_LABEL]: 'devops', [SM4RT_NAME_LABEL]: 'git' },
          Mounts: [
            {
              Type: 'volume',
              Source: `${name}-data`,
              Target: '/data',
              VolumeOptions: { Labels: { [SM4RT_WS_LABEL]: ws } },
            } as unknown as Docker.MountSettings,
          ],
        },
        Resources: { Limits: { NanoCPUs: cpusToNano(1), MemoryBytes: mbToBytes(1024) } },
        RestartPolicy: { Condition: 'any', Delay: 5_000_000_000 },
        // manager node: the API only has the manager's docker socket, and
        // bootstrap uses container.exec which must reach the container locally
        Placement: { Constraints: ['node.role == manager'] },
        Networks: [{ Target: NETWORK_NAME, Aliases: [name] }],
      },
      Mode: { Replicated: { Replicas: 1 } },
      EndpointSpec: { Mode: 'dnsrr' },
    } as Docker.CreateServiceOptions);
  }

  private async giteaContainerId(ws: string): Promise<string | null> {
    const tasks = (await this.docker.listTasks({
      filters: JSON.stringify({ service: [this.gitService(ws)] }),
    })) as Array<Record<string, any>>;
    const running = tasks.find(
      (t) => t.Status?.State === 'running' && t.Status?.ContainerStatus?.ContainerID,
    );
    return running ? String(running.Status.ContainerStatus.ContainerID) : null;
  }

  private async execInGitea(ws: string, cmd: string): Promise<{ out: string; code: number }> {
    return this.execRawInGitea(ws, ['su', 'git', '-c', cmd]);
  }

  /**
   * HTTP call to gitea executed inside its own container (curl via docker exec).
   * Works both in prod (API inside the swarm) and local dev (API on the host,
   * where overlay DNS like http://<service>:3000 does not resolve).
   */
  private async giteaHttp(
    ws: string,
    method: string,
    path: string,
    opts: { token?: string; body?: unknown } = {},
  ): Promise<Response> {
    const args = ['curl', '-s', '--max-time', '8', '-w', '\n%{http_code}', '-X', method];
    if (opts.token) args.push('-H', `Authorization: token ${opts.token}`);
    if (opts.body !== undefined) {
      args.push('-H', 'Content-Type: application/json', '-d', JSON.stringify(opts.body));
    }
    args.push(`http://localhost:3000${path}`);
    const res = await this.execRawInGitea(ws, args);
    if (res.code !== 0) throw new Error(`gitea curl exited ${res.code}`);
    const nl = res.out.lastIndexOf('\n');
    const status = Number.parseInt(res.out.slice(nl + 1).trim(), 10);
    if (!Number.isFinite(status) || status < 100) {
      throw new Error(`gitea curl: unparsable status from output tail`);
    }
    const text = nl >= 0 ? res.out.slice(0, nl) : '';
    return new Response(text.length > 0 ? text : null, { status });
  }

  private async execRawInGitea(ws: string, cmd: string[]): Promise<{ out: string; code: number }> {
    const cid = await this.giteaContainerId(ws);
    if (!cid) throw new ComputeError(503, 'gitea container not running yet');
    const container = this.docker.getContainer(cid);
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = (await exec.start({})) as NodeJS.ReadableStream;
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => resolve());
      stream.on('error', reject);
    });
    const inspect = await exec.inspect();
    const buf = Buffer.concat(chunks);
    // exec output is multiplexed like service logs
    let out = '';
    if (buf.length && (buf[0] ?? 255) <= 2 && buf[1] === 0 && buf[2] === 0 && buf[3] === 0) {
      let offset = 0;
      const parts: string[] = [];
      while (offset + 8 <= buf.length) {
        const size = buf.readUInt32BE(offset + 4);
        const end = Math.min(offset + 8 + size, buf.length);
        parts.push(buf.subarray(offset + 8, end).toString('utf8'));
        offset = end;
      }
      out = parts.join('');
    } else {
      out = buf.toString('utf8');
    }
    return { out, code: inspect.ExitCode ?? -1 };
  }

  /** Wait for gitea, create admin user + API token + OAuth app, launch CI. */
  private async bootstrap(ws: string): Promise<void> {
    const secrets = (await this.readConfig<DevopsSecrets>(this.secretsConfig(ws)))!;
    // wait for gitea HTTP (up to ~3min: image pull + init); probed from inside
    // the container so it works with the API running on the host too
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        const res = await this.giteaHttp(ws, 'GET', '/api/v1/version');
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {
        // keep waiting — container may not be running yet
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (!ready) throw new Error('gitea did not become ready in time');
    // create admin (idempotent: ignore "already exists")
    const create = await this.execInGitea(
      ws,
      `gitea admin user create --admin --username ${secrets.adminUser} --password '${secrets.adminPass}' --email admin@${ws}.local --must-change-password=false`,
    );
    if (create.code !== 0 && !/already exists/i.test(create.out)) {
      throw new Error(`gitea admin create failed: ${create.out.slice(0, 300)}`);
    }
    // API token (idempotent: delete then create)
    await this.execInGitea(
      ws,
      `gitea admin user generate-access-token --username ${secrets.adminUser} --token-name sm4rt-api --scopes all --raw`,
    ).then(async (tok) => {
      if (tok.code === 0 && tok.out.trim()) {
        secrets.token = tok.out.trim().split('\n').pop()!.trim();
        return;
      }
      throw new Error(`gitea token failed: ${tok.out.slice(0, 300)}`);
    });
    // OAuth2 app for Woodpecker
    const oauthRes = await this.giteaHttp(ws, 'POST', '/api/v1/user/applications/oauth2', {
      token: secrets.token,
      body: {
        name: 'sm4rt-ci',
        redirect_uris: [`${this.scheme()}://${this.ciHost(ws)}/authorize`],
        confidential_client: true,
      },
    });
    if (!oauthRes.ok) {
      throw new Error(`gitea oauth app failed: HTTP ${oauthRes.status}`);
    }
    const oauth = (await oauthRes.json()) as { client_id: string; client_secret: string };
    secrets.clientId = oauth.client_id;
    secrets.clientSecret = oauth.client_secret;
    await this.writeConfig(this.secretsConfig(ws), secrets);
    await this.createWoodpecker(ws, secrets);
  }

  private async createWoodpecker(ws: string, secrets: DevopsSecrets): Promise<void> {
    const ciName = this.ciService(ws);
    if (!(await this.getServiceRaw(ciName))) {
      await this.docker.createService({
        Name: ciName,
        Labels: {
          [SM4RT_KIND_LABEL]: 'devops',
          [SM4RT_WS_LABEL]: ws,
          [SM4RT_NAME_LABEL]: 'ci',
          ...this.compute.caddyLabelsFor(this.ciHost(ws), 8000),
        },
        TaskTemplate: {
          ContainerSpec: {
            Image: 'woodpeckerci/woodpecker-server:v3',
            Env: [
              'WOODPECKER_OPEN=true',
              `WOODPECKER_HOST=${this.scheme()}://${this.ciHost(ws)}`,
              'WOODPECKER_GITEA=true',
              // public URL: the OAuth flow happens in the user's browser
              `WOODPECKER_GITEA_URL=${this.scheme()}://${this.gitHost(ws)}`,
              `WOODPECKER_GITEA_CLIENT=${secrets.clientId}`,
              `WOODPECKER_GITEA_SECRET=${secrets.clientSecret}`,
              `WOODPECKER_AGENT_SECRET=${secrets.agentSecret}`,
              `WOODPECKER_ADMIN=${secrets.adminUser}`,
            ],
            Labels: { [SM4RT_WS_LABEL]: ws, [SM4RT_KIND_LABEL]: 'devops', [SM4RT_NAME_LABEL]: 'ci' },
            Mounts: [
              {
                Type: 'volume',
                Source: `${ciName}-data`,
                Target: '/var/lib/woodpecker',
                VolumeOptions: { Labels: { [SM4RT_WS_LABEL]: ws } },
              } as unknown as Docker.MountSettings,
            ],
          },
          Resources: { Limits: { NanoCPUs: cpusToNano(1), MemoryBytes: mbToBytes(512) } },
          RestartPolicy: { Condition: 'any', Delay: 5_000_000_000 },
          Networks: [{ Target: NETWORK_NAME, Aliases: [ciName] }],
        },
        Mode: { Replicated: { Replicas: 1 } },
        EndpointSpec: { Mode: 'dnsrr' },
      } as Docker.CreateServiceOptions);
    }
    const agentName = this.ciAgentService(ws);
    if (!(await this.getServiceRaw(agentName))) {
      await this.docker.createService({
        Name: agentName,
        Labels: {
          [SM4RT_KIND_LABEL]: 'devops',
          [SM4RT_WS_LABEL]: ws,
          [SM4RT_NAME_LABEL]: 'ci-agent',
        },
        TaskTemplate: {
          ContainerSpec: {
            Image: 'woodpeckerci/woodpecker-agent:v3',
            Env: [
              `WOODPECKER_SERVER=${ciName}:9000`,
              `WOODPECKER_AGENT_SECRET=${secrets.agentSecret}`,
              'WOODPECKER_BACKEND=docker',
              'WOODPECKER_MAX_WORKFLOWS=2',
            ],
            Labels: {
              [SM4RT_WS_LABEL]: ws,
              [SM4RT_KIND_LABEL]: 'devops',
              [SM4RT_NAME_LABEL]: 'ci-agent',
            },
            Mounts: [
              {
                Type: 'bind',
                Source: '/var/run/docker.sock',
                Target: '/var/run/docker.sock',
              } as unknown as Docker.MountSettings,
            ],
          },
          Resources: { Limits: { NanoCPUs: cpusToNano(1), MemoryBytes: mbToBytes(512) } },
          RestartPolicy: { Condition: 'any', Delay: 5_000_000_000 },
          Networks: [{ Target: NETWORK_NAME, Aliases: [agentName] }],
        },
        Mode: { Replicated: { Replicas: 1 } },
        EndpointSpec: { Mode: 'dnsrr' },
      } as Docker.CreateServiceOptions);
    }
  }

  /** Retry bootstrap when enable succeeded but bootstrap failed. */
  async retryBootstrap(ws: string): Promise<DevopsStatus> {
    const st = await this.status(ws);
    if (!st.enabled) throw new ComputeError(400, 'DevOps stack is not enabled');
    if (!st.bootstrapped) {
      await this.bootstrap(ws);
    } else {
      const secrets = (await this.readConfig<DevopsSecrets>(this.secretsConfig(ws)))!;
      await this.createWoodpecker(ws, secrets);
    }
    return this.status(ws);
  }

  async disable(ws: string): Promise<void> {
    let removed = false;
    for (const name of [this.gitService(ws), this.ciService(ws), this.ciAgentService(ws)]) {
      try {
        await this.docker.getService(name).remove();
        removed = true;
      } catch (err) {
        if (!isNotFoundErr(err)) throw err;
      }
    }
    for (const cfg of [this.secretsConfig(ws), this.gitopsConfig(ws)]) {
      try {
        const configs = (await this.docker.listConfigs({
          filters: JSON.stringify({ name: [cfg] }),
        })) as Array<{ ID: string; Spec?: { Name?: string } }>;
        for (const c of configs) {
          if (c.Spec?.Name === cfg) await this.docker.getConfig(c.ID).remove();
        }
      } catch {
        // ignore
      }
    }
    if (!removed) throw new ComputeError(404, 'DevOps stack is not enabled');
  }

  // ————————————————— GitOps —————————————————

  async listApps(ws: string): Promise<GitopsApp[]> {
    const apps = (await this.readConfig<GitopsApp[]>(this.gitopsConfig(ws))) ?? [];
    const out: GitopsApp[] = [];
    for (const app of apps) {
      const enriched: GitopsApp = { ...app };
      const key = `${ws}/${app.name}`;
      const st = this.appState.get(key);
      enriched.lastError = st?.lastError ?? null;
      enriched.lastSyncAt = st?.lastSyncAt ?? null;
      try {
        const head = await this.fetchHeadRev(ws, app);
        enriched.revision = head;
        const applied = await this.appliedRevision(ws, app.name);
        enriched.appliedRevision = applied;
        enriched.status = st?.lastError
          ? 'Error'
          : applied && head && applied === head
            ? 'Synced'
            : 'OutOfSync';
      } catch (err) {
        enriched.status = 'Unknown';
        enriched.lastError = (err as Error).message;
      }
      out.push(enriched);
    }
    return out;
  }

  async addApp(
    ws: string,
    input: { name: string; repo: string; branch?: string; path?: string; autoSync?: boolean },
  ): Promise<GitopsApp> {
    if (!isValidResourceName(input.name)) throw new ComputeError(400, 'invalid app name');
    if (!/^[a-zA-Z0-9._-]+$/.test(input.repo)) {
      throw new ComputeError(400, 'repo must be a repository name in the workspace Gitea');
    }
    const st = await this.status(ws);
    if (!st.enabled || !st.bootstrapped) {
      throw new ComputeError(400, 'enable the DevOps stack first (git server required)');
    }
    const apps = (await this.readConfig<GitopsApp[]>(this.gitopsConfig(ws))) ?? [];
    if (apps.some((a) => a.name === input.name)) {
      throw new ComputeError(409, `app "${input.name}" already exists`);
    }
    const app: GitopsApp = {
      name: input.name,
      repo: input.repo,
      branch: input.branch || 'main',
      path: input.path || 'sm4rt.yaml',
      autoSync: input.autoSync !== false,
    };
    apps.push(app);
    await this.writeConfig(this.gitopsConfig(ws), apps);
    return app;
  }

  async removeApp(ws: string, name: string): Promise<void> {
    const apps = (await this.readConfig<GitopsApp[]>(this.gitopsConfig(ws))) ?? [];
    const next = apps.filter((a) => a.name !== name);
    if (next.length === apps.length) throw new ComputeError(404, `app "${name}" not found`);
    await this.writeConfig(this.gitopsConfig(ws), next);
    this.appState.delete(`${ws}/${name}`);
  }

  private async giteaApi(ws: string, path: string): Promise<Response> {
    const secrets = await this.readConfig<DevopsSecrets>(this.secretsConfig(ws));
    if (!secrets?.token) throw new ComputeError(503, 'git server not bootstrapped yet');
    return this.giteaHttp(ws, 'GET', path, { token: secrets.token });
  }

  private async fetchHeadRev(ws: string, app: GitopsApp): Promise<string | null> {
    const res = await this.giteaApi(
      ws,
      `/api/v1/repos/${encodeURIComponent('sm4rt')}/${encodeURIComponent(app.repo)}/branches/${encodeURIComponent(app.branch)}`,
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`gitea branches API: HTTP ${res.status}`);
    const body = (await res.json()) as { commit?: { id?: string } };
    return body.commit?.id ?? null;
  }

  private async fetchSpec(
    ws: string,
    app: GitopsApp,
  ): Promise<{ rev: string; spec: ReturnType<typeof validateGitopsSpec> }> {
    const rev = await this.fetchHeadRev(ws, app);
    if (!rev) throw new Error(`branch "${app.branch}" not found in repo "${app.repo}"`);
    const res = await this.giteaApi(
      ws,
      `/api/v1/repos/sm4rt/${encodeURIComponent(app.repo)}/contents/${app.path
        .split('/')
        .map(encodeURIComponent)
        .join('/')}?ref=${encodeURIComponent(app.branch)}`,
    );
    if (!res.ok) throw new Error(`could not read ${app.path} from ${app.repo}: HTTP ${res.status}`);
    const body = (await res.json()) as { content?: string; encoding?: string };
    if (!body.content) throw new Error(`${app.path} is empty or not a file`);
    const raw = Buffer.from(body.content, 'base64').toString('utf8');
    const doc = parseYaml(raw) as unknown;
    return { rev, spec: validateGitopsSpec(doc) };
  }

  private async appliedRevision(ws: string, appName: string): Promise<string | null> {
    const svcs = (await this.docker.listServices({
      filters: JSON.stringify({
        label: [`${SM4RT_WS_LABEL}=${ws}`, `sm4rt.gitops.app=${appName}`],
      }),
    })) as Array<Record<string, any>>;
    if (svcs.length === 0) return null;
    const revs = new Set(svcs.map((s) => String(s.Spec?.Labels?.['sm4rt.gitops.rev'] ?? '')));
    return revs.size === 1 ? [...revs][0]! : null;
  }

  /** Apply an app's spec: create/update tasks, remove tasks that left the spec. */
  async syncApp(ws: string, appName: string): Promise<GitopsApp> {
    const apps = (await this.readConfig<GitopsApp[]>(this.gitopsConfig(ws))) ?? [];
    const app = apps.find((a) => a.name === appName);
    if (!app) throw new ComputeError(404, `app "${appName}" not found`);
    const key = `${ws}/${appName}`;
    try {
      const { rev, spec } = await this.fetchSpec(ws, app);
      const existing = (await this.docker.listServices({
        filters: JSON.stringify({
          label: [`${SM4RT_WS_LABEL}=${ws}`, `sm4rt.gitops.app=${appName}`],
        }),
      })) as Array<Record<string, any>>;
      const specNames = new Set(spec.tasks.map((t) => t.name));
      // remove tasks no longer in the spec
      for (const s of existing) {
        const taskName = String(s.Spec?.Labels?.[SM4RT_NAME_LABEL] ?? '');
        if (taskName && !specNames.has(taskName)) {
          try {
            await this.docker.getService(String(s.ID)).remove();
          } catch (err) {
            if (!isNotFoundErr(err)) throw err;
          }
        }
      }
      // create/update tasks
      const current = await this.compute.listTasks(ws);
      const byName = new Map(current.map((t) => [t.name, t]));
      for (const t of spec.tasks) {
        if (byName.has(t.name)) {
          await this.compute.updateTask(ws, t.name, {
            image: t.image,
            port: t.port ?? null,
            env: t.env ?? {},
            replicas: t.replicas ?? 1,
            gitopsRev: rev,
          });
        } else {
          await this.compute.createTask(ws, {
            name: t.name,
            image: t.image,
            port: t.port ?? null,
            env: t.env ?? {},
            replicas: t.replicas ?? 1,
            gitopsApp: appName,
            gitopsRev: rev,
          });
        }
      }
      await this.compute.syncObsScrape(ws).catch(() => {});
      this.appState.set(key, { lastError: null, lastSyncAt: new Date().toISOString() });
      const enriched = (await this.listApps(ws)).find((a) => a.name === appName);
      return enriched ?? app;
    } catch (err) {
      this.appState.set(key, {
        lastError: (err as Error).message,
        lastSyncAt: new Date().toISOString(),
      });
      throw err instanceof ComputeError
        ? err
        : new ComputeError(502, `sync failed: ${(err as Error).message}`);
    }
  }

  /** Background reconciler: sync all autoSync apps of all workspaces every 30s. */
  startReconciler(listWorkspaces: () => Promise<string[]>): void {
    if (this.syncTimer) return;
    this.syncTimer = setInterval(() => {
      if (this.syncing) return;
      this.syncing = true;
      void (async () => {
        try {
          const wss = await listWorkspaces();
          for (const ws of wss) {
            const apps = (await this.readConfig<GitopsApp[]>(this.gitopsConfig(ws))) ?? [];
            for (const app of apps) {
              if (!app.autoSync) continue;
              try {
                const head = await this.fetchHeadRev(ws, app);
                const applied = await this.appliedRevision(ws, app.name);
                if (head && head !== applied) {
                  await this.syncApp(ws, app.name);
                  console.log(`[gitops:${ws}] synced ${app.name} to ${head.slice(0, 8)}`);
                }
              } catch (err) {
                this.appState.set(`${ws}/${app.name}`, {
                  lastError: (err as Error).message,
                  lastSyncAt: new Date().toISOString(),
                });
              }
            }
          }
        } catch {
          // workspace listing failed — next tick
        } finally {
          this.syncing = false;
        }
      })();
    }, 30_000);
    this.syncTimer.unref?.();
  }

  stopReconciler(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }
}
