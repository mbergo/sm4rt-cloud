// FunctionsManager — Sm4rt Functions: a real FaaS. Each function is the
// user's JavaScript handler running in its own container (node:22-alpine),
// reachable at fn-<name>.<ws>.<domain>. No emulation: the code the user
// types is the code that serves the HTTP request.
//
// Mechanics: source → docker config mounted at /fn/handler.js → a tiny
// embedded HTTP runner loads it and serves port 8080 → caddy publishes it.
// Updating a function creates a fresh config and rolls the service.
import type Docker from 'dockerode';
import {
  SM4RT_KIND_LABEL,
  SM4RT_META_LABEL,
  SM4RT_NAME_LABEL,
  SM4RT_WS_LABEL,
} from './compute-templates.ts';
import { ComputeError, type ComputeManager } from './compute.ts';

const NETWORK_NAME = process.env.SWARM_NETWORK ?? 'floci-net';

export interface FunctionInfo {
  name: string;
  state: string;
  url: string;
  runtime: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface FunctionDetail extends FunctionInfo {
  code: string;
}

export function isValidFunctionName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/.test(name) || /^[a-z0-9]$/.test(name);
}

const MAX_CODE_BYTES = 200 * 1024; // docker configs cap at ~500KB; stay well under

export const DEFAULT_FUNCTION_CODE = `// Your function. Export a handler that receives the request and
// returns { status?, headers?, body }.
module.exports = async function handler(req) {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'hello world', path: req.path, method: req.method }),
  };
};
`;

/** The runner every function container executes — plain Node, no deps. */
export function runnerScript(): string {
  return `
const http = require('http');
const handler = require('/fn/handler.js');
const fn = typeof handler === 'function' ? handler : handler.default;
if (typeof fn !== 'function') {
  console.error('handler.js must export a function');
  process.exit(1);
}
const server = http.createServer(async (req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    try {
      const out = (await fn({
        method: req.method,
        path: req.url,
        headers: req.headers,
        body,
      })) ?? {};
      res.writeHead(out.status ?? 200, out.headers ?? { 'content-type': 'text/plain' });
      res.end(typeof out.body === 'string' ? out.body : JSON.stringify(out.body ?? ''));
    } catch (err) {
      console.error('handler error:', err);
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(err && err.message || err) }));
    }
  });
});
server.listen(8080, () => console.log('sm4rt-fn listening on 8080'));
`.trim();
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

interface FnMeta {
  name: string;
  configName: string;
  createdAt: string;
  updatedAt: string;
}

export class FunctionsManager {
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
  private serviceName(ws: string, fn: string) {
    return `sm4rt-fn-${ws}-${fn}`;
  }
  private host(ws: string, fn: string) {
    return this.compute.hostFor(ws, `fn-${fn}`);
  }
  private urlFor(ws: string, fn: string) {
    return `${this.scheme()}://${this.host(ws, fn)}`;
  }

  private async createCodeConfig(ws: string, fn: string, code: string): Promise<{ name: string; id: string }> {
    const name = `sm4rt-fn-${ws}-${fn}-code-${Date.now().toString(36)}`;
    await this.docker.createConfig({
      Name: name,
      Data: Buffer.from(code, 'utf8').toString('base64'),
      Labels: { [SM4RT_KIND_LABEL]: 'function-code', [SM4RT_WS_LABEL]: ws },
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
        if (n.startsWith(prefix)) {
          try {
            await this.docker.getConfig(c.ID).remove();
          } catch {
            // in use (old rolling task) or gone — best effort
          }
        }
      }
    } catch {
      // ignore
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

  private specFor(
    ws: string,
    fn: string,
    config: { name: string; id: string },
    meta: FnMeta,
  ): Docker.CreateServiceOptions {
    const host = this.host(ws, fn);
    return {
      Name: this.serviceName(ws, fn),
      Labels: {
        [SM4RT_KIND_LABEL]: 'function',
        [SM4RT_WS_LABEL]: ws,
        [SM4RT_NAME_LABEL]: fn,
        [SM4RT_META_LABEL]: JSON.stringify(meta),
        ...this.compute.caddyLabelsFor(host, 8080),
      },
      TaskTemplate: {
        ContainerSpec: {
          Image: 'node:22-alpine',
          Command: ['node', '-e', runnerScript()],
          Labels: { [SM4RT_WS_LABEL]: ws, [SM4RT_KIND_LABEL]: 'function', [SM4RT_NAME_LABEL]: fn },
          Configs: [
            {
              ConfigID: config.id,
              ConfigName: config.name,
              File: { Name: '/fn/handler.js', UID: '0', GID: '0', Mode: 0o444 },
            },
          ],
        },
        Resources: { Limits: { NanoCPUs: cpusToNano(0.5), MemoryBytes: mbToBytes(256) } },
        RestartPolicy: { Condition: 'any', Delay: 5_000_000_000 },
        Networks: [{ Target: NETWORK_NAME, Aliases: [this.serviceName(ws, fn)] }],
      },
      Mode: { Replicated: { Replicas: 1 } },
      EndpointSpec: { Mode: 'dnsrr' },
    } as Docker.CreateServiceOptions;
  }

  // ————————————————— CRUD —————————————————

  async list(ws: string): Promise<FunctionInfo[]> {
    const services = (await this.docker.listServices({
      filters: JSON.stringify({
        label: [`${SM4RT_KIND_LABEL}=function`, `${SM4RT_WS_LABEL}=${ws}`],
      }),
    })) as Array<Record<string, any>>;
    return Promise.all(
      services.map(async (s) => {
        const fn = s.Spec?.Labels?.[SM4RT_NAME_LABEL] ?? '';
        const meta = this.parseMeta(s);
        const up = await this.serviceRunning(s.Spec?.Name ?? '');
        return {
          name: fn,
          state: up ? 'running' : 'starting',
          url: this.urlFor(ws, fn),
          runtime: 'nodejs22',
          createdAt: meta?.createdAt ?? s.CreatedAt ?? null,
          updatedAt: meta?.updatedAt ?? s.UpdatedAt ?? null,
        };
      }),
    );
  }

  private parseMeta(svc: Record<string, any>): FnMeta | null {
    try {
      return JSON.parse(svc.Spec?.Labels?.[SM4RT_META_LABEL] ?? '') as FnMeta;
    } catch {
      return null;
    }
  }

  async get(ws: string, fn: string): Promise<FunctionDetail> {
    if (!isValidFunctionName(fn)) throw new ComputeError(400, 'invalid function name');
    const svc = await this.getServiceRaw(this.serviceName(ws, fn));
    if (!svc) throw new ComputeError(404, `function ${fn} not found`);
    const meta = this.parseMeta(svc);
    let code = '';
    if (meta?.configName) {
      try {
        const configs = (await this.docker.listConfigs({
          filters: JSON.stringify({ name: [meta.configName] }),
        })) as Array<{ ID: string; Spec?: { Name?: string } }>;
        const found = configs.find((c) => c.Spec?.Name === meta.configName);
        if (found) {
          const inspected = (await this.docker.getConfig(found.ID).inspect()) as {
            Spec?: { Data?: string };
          };
          code = Buffer.from(inspected.Spec?.Data ?? '', 'base64').toString('utf8');
        }
      } catch {
        // config gone — code unavailable
      }
    }
    const up = await this.serviceRunning(this.serviceName(ws, fn));
    return {
      name: fn,
      state: up ? 'running' : 'starting',
      url: this.urlFor(ws, fn),
      runtime: 'nodejs22',
      createdAt: meta?.createdAt ?? null,
      updatedAt: meta?.updatedAt ?? null,
      code,
    };
  }

  async create(ws: string, input: { name: string; code?: string }): Promise<FunctionInfo> {
    const fn = (input.name ?? '').trim();
    if (!isValidFunctionName(fn)) {
      throw new ComputeError(400, 'invalid function name (lowercase, digits, dashes, ≤40 chars)');
    }
    const code = input.code ?? DEFAULT_FUNCTION_CODE;
    if (Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) {
      throw new ComputeError(400, 'code too large (200 KB max)');
    }
    await this.compute.ensureNet();
    if (await this.getServiceRaw(this.serviceName(ws, fn))) {
      throw new ComputeError(409, `function ${fn} already exists`);
    }
    const config = await this.createCodeConfig(ws, fn, code);
    const now = new Date().toISOString();
    const meta: FnMeta = { name: fn, configName: config.name, createdAt: now, updatedAt: now };
    await this.docker.createService(this.specFor(ws, fn, config, meta));
    return {
      name: fn,
      state: 'starting',
      url: this.urlFor(ws, fn),
      runtime: 'nodejs22',
      createdAt: now,
      updatedAt: now,
    };
  }

  async updateCode(ws: string, fn: string, code: string): Promise<void> {
    if (!isValidFunctionName(fn)) throw new ComputeError(400, 'invalid function name');
    if (Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) {
      throw new ComputeError(400, 'code too large (200 KB max)');
    }
    const name = this.serviceName(ws, fn);
    const svc = await this.getServiceRaw(name);
    if (!svc) throw new ComputeError(404, `function ${fn} not found`);
    const oldMeta = this.parseMeta(svc);
    const config = await this.createCodeConfig(ws, fn, code);
    const meta: FnMeta = {
      name: fn,
      configName: config.name,
      createdAt: oldMeta?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const version = Number(svc.Version?.Index ?? 0);
    const spec = this.specFor(ws, fn, config, meta);
    await this.docker.getService(name).update({
      version,
      ...spec,
    } as unknown as Record<string, unknown>);
  }

  async remove(ws: string, fn: string): Promise<void> {
    if (!isValidFunctionName(fn)) throw new ComputeError(400, 'invalid function name');
    const name = this.serviceName(ws, fn);
    const svc = await this.getServiceRaw(name);
    if (!svc) throw new ComputeError(404, `function ${fn} not found`);
    await this.docker.getService(name).remove();
    await this.removeConfigsByPrefix(`sm4rt-fn-${ws}-${fn}-code-`);
  }
}
