import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { verifyToken } from '@clerk/backend';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Provisioner } from './k8s.ts';
import { isConflict, type CloudDriver, type InstanceInfo } from './driver.ts';
import { isValidName, randomName } from './names.ts';
import { ResourceGateway, isServiceId } from './resources.ts';
import { EXPLORER_SERVICES, explore } from './explorer.ts';
import { isRealServiceId } from './services.ts';
import { buildCaddyConfig, parseTlsAsk, pushCaddyConfig } from './caddy.ts';
import { emit, subscribe } from './events.ts';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const TOKEN = process.env.FLOCI_CLOUD_TOKEN ?? '';
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? '';
const INSTANCE_DOMAIN = process.env.INSTANCE_DOMAIN ?? 'floci.sm4rt.works';
const FLOCI_IMAGE = process.env.FLOCI_IMAGE ?? 'floci/floci:latest';
const INGRESS_CLASS = process.env.INGRESS_CLASS ?? 'nginx';
const INSTANCE_TLS = (process.env.INSTANCE_TLS ?? 'false') === 'true';
const CLUSTER_ISSUER = process.env.CLUSTER_ISSUER ?? 'letsencrypt';
const GATEWAY_NAME = process.env.GATEWAY_NAME ?? '';
const GATEWAY_NAMESPACE = process.env.GATEWAY_NAMESPACE ?? '';
const DRIVER = process.env.DRIVER ?? 'kubernetes';
const ADMIN_USER = process.env.ADMIN_USER ?? 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS ?? 'floci-admin';
const CLERK_PUBLISHABLE_KEY = process.env.CLERK_PUBLISHABLE_KEY ?? '';
const CADDY_ADMIN_URL = process.env.CADDY_ADMIN_URL ?? '';
const CONSOLE_HOST = process.env.CONSOLE_HOST ?? `cloud.${INSTANCE_DOMAIN}`;
const SELF_UPSTREAM = process.env.SELF_UPSTREAM ?? 'floci-cloud:8080';
const ACME_EMAIL = process.env.ACME_EMAIL ?? '';
const PUBLIC_DIR = process.env.PUBLIC_DIR ?? path.resolve(import.meta.dirname, '../public');
const MAX_TTL_HOURS = 7 * 24;
const MAX_INSTANCES = Number(process.env.MAX_INSTANCES ?? 20);

const app = Fastify({ logger: true });

async function createDriver(): Promise<CloudDriver> {
  if (DRIVER === 'swarm') {
    const { SwarmDriver } = await import('./swarm.ts');
    return new SwarmDriver({
      instanceDomain: INSTANCE_DOMAIN,
      flociImage: FLOCI_IMAGE,
      tls: INSTANCE_TLS,
    });
  }
  return new Provisioner({
    instanceDomain: INSTANCE_DOMAIN,
    flociImage: FLOCI_IMAGE,
    ingressClass: INGRESS_CLASS,
    tls: INSTANCE_TLS,
    clusterIssuer: CLUSTER_ISSUER,
    ...(GATEWAY_NAME && GATEWAY_NAMESPACE
      ? { gatewayName: GATEWAY_NAME, gatewayNamespace: GATEWAY_NAMESPACE }
      : {}),
  });
}

const provisioner = await createDriver();
app.log.info({ driver: provisioner.kind }, 'cloud driver initialized');

if (!TOKEN && !CLERK_SECRET_KEY) {
  app.log.warn(
    'FLOCI_CLOUD_TOKEN and CLERK_SECRET_KEY are not set — the API is running without authentication',
  );
}

function isAdminAuthorized(header: string): boolean {
  if (!header.startsWith('Basic ')) {
    return false;
  }
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const idx = decoded.indexOf(':');
  if (idx < 0) {
    return false;
  }
  return decoded.slice(0, idx) === ADMIN_USER && decoded.slice(idx + 1) === ADMIN_PASS;
}

app.addHook('onRequest', async (request, reply) => {
  if (request.url.startsWith('/api/admin/')) {
    if (!isAdminAuthorized(request.headers.authorization ?? '')) {
      reply.code(401).send({ error: 'admin unauthorized' });
    }
    return;
  }
  if (
    !request.url.startsWith('/api/') ||
    request.url.startsWith('/api/public/') ||
    (!TOKEN && !CLERK_SECRET_KEY)
  ) {
    return;
  }
  const header = request.headers.authorization ?? '';
  let bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!bearer) {
    // EventSource cannot send headers — allow ?access_token= on GET streams
    const q = request.query as Record<string, unknown> | undefined;
    if (request.method === 'GET' && typeof q?.access_token === 'string') {
      bearer = q.access_token;
    }
  }
  if (TOKEN && bearer === TOKEN) {
    return;
  }
  if (CLERK_SECRET_KEY && bearer) {
    try {
      await verifyToken(bearer, { secretKey: CLERK_SECRET_KEY });
      return;
    } catch (err) {
      request.log.debug({ err }, 'clerk token verification failed');
    }
  }
  reply.code(401).send({ error: 'unauthorized' });
});

app.get('/healthz', async () => ({ status: 'ok' }));

// Runtime config for the UI — no build-time baking of keys/domain.
app.get('/api/public/config', async () => ({
  driver: provisioner.kind,
  instanceDomain: INSTANCE_DOMAIN,
  scheme: provisioner.scheme(),
  authMode: CLERK_SECRET_KEY ? 'clerk' : TOKEN ? 'token' : 'open',
  clerkPublishableKey: CLERK_PUBLISHABLE_KEY || null,
  maxInstances: MAX_INSTANCES,
  maxTtlHours: MAX_TTL_HOURS,
}));

// sm4rt CLI — `curl -fsSL https://cloud.<domain>/cli | sh` installs the
// wrapper pre-configured with this installation's endpoint scheme+domain.
const CLI_DIR =
  process.env.CLI_DIR ??
  [path.resolve(import.meta.dirname, '../cli'), path.resolve(import.meta.dirname, '../../cli')].find(existsSync) ??
  path.resolve(import.meta.dirname, '../cli');
function cliFile(name: string): string | null {
  const file = path.join(CLI_DIR, name);
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

app.get('/cli', async (request, reply) => {
  const script = cliFile('install-cli.sh');
  if (!script) return reply.code(404).send('cli installer not bundled\n');
  const origin = `${provisioner.scheme()}://${CONSOLE_HOST}`;
  // ?ws=<name> bakes that workspace's endpoint as the initial config
  const { ws } = request.query as { ws?: string };
  const endpoint = ws && isValidName(ws) ? `${provisioner.scheme()}://${ws}.${INSTANCE_DOMAIN}` : '';
  const body = script
    .replace(/@ENDPOINT@/g, endpoint)
    .replace(
      /^RAW_BASE=.*$/m,
      `RAW_BASE="\${SM4RT_CLI_BASE:-${origin}/cli/raw}"`,
    );
  return reply.type('text/x-shellscript').send(body);
});

app.get('/cli/raw/sm4rt', async (_request, reply) => {
  const script = cliFile('sm4rt');
  if (!script) return reply.code(404).send('not found\n');
  return reply.type('text/x-shellscript').send(script);
});

app.get('/cli/raw/install-cli.sh', async (_request, reply) => {
  const script = cliFile('install-cli.sh');
  if (!script) return reply.code(404).send('not found\n');
  return reply.type('text/x-shellscript').send(script);
});

// Caddy on-demand TLS "ask" — only issue certificates for the console host
// or subdomains of instances that actually exist.
app.get('/api/public/tls-ask', async (request, reply) => {
  const { domain } = request.query as { domain?: string };
  if (!domain) {
    return reply.code(400).send({ error: 'missing domain' });
  }
  const decision = parseTlsAsk(domain, INSTANCE_DOMAIN, CONSOLE_HOST);
  if (decision.allowed) {
    return { allowed: true };
  }
  if (decision.instance && isValidName(decision.instance)) {
    const instance = await provisioner.get(decision.instance);
    if (instance) {
      return { allowed: true };
    }
  }
  return reply.code(404).send({ error: `no instance for ${domain}` });
});

// — admin area (Basic auth, hardcoded credentials for the PoC) —

app.get('/api/admin/overview', async () => {
  const [nodes, instances] = await Promise.all([provisioner.nodes(), provisioner.list()]);
  return {
    driver: provisioner.kind,
    instanceDomain: INSTANCE_DOMAIN,
    flociImage: FLOCI_IMAGE,
    nodes,
    instances,
    capacity: {
      cpuTotalMilli: nodes.reduce((acc, n) => acc + n.cpuTotalMilli, 0),
      memTotalBytes: nodes.reduce((acc, n) => acc + n.memTotalBytes, 0),
      cpuUsedMilli: nodes.some((n) => n.cpuUsedMilli !== null)
        ? nodes.reduce((acc, n) => acc + (n.cpuUsedMilli ?? 0), 0)
        : null,
      memUsedBytes: nodes.some((n) => n.memUsedBytes !== null)
        ? nodes.reduce((acc, n) => acc + (n.memUsedBytes ?? 0), 0)
        : null,
    },
  };
});

app.get('/api/admin/nodes', async () => ({ nodes: await provisioner.nodes() }));

app.get('/api/admin/join-command', async () => ({
  joinCommand: await provisioner.joinCommand(),
}));

app.get('/api/instances', async () => ({ instances: await provisioner.list() }));

interface CreateBody {
  name?: unknown;
  ttlHours?: unknown;
}

app.post('/api/instances', async (request, reply) => {
  const body = (request.body ?? {}) as CreateBody;

  const existing = await provisioner.list();
  if (existing.length >= MAX_INSTANCES) {
    return reply.code(429).send({
      error: `instance limit reached (${MAX_INSTANCES}) — delete an instance first`,
    });
  }

  let name: string;
  if (body.name === undefined || body.name === null || body.name === '') {
    name = randomName(new Set(existing.map((instance) => instance.name)));
  } else if (typeof body.name === 'string' && isValidName(body.name)) {
    name = body.name;
  } else {
    return reply.code(400).send({
      error:
        'invalid name — use 1-28 lowercase letters, digits or single hyphens, starting with a letter',
    });
  }

  let ttlHours: number | null = null;
  if (body.ttlHours !== undefined && body.ttlHours !== null) {
    const parsed = Number(body.ttlHours);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_TTL_HOURS) {
      return reply.code(400).send({
        error: `invalid ttlHours — expected a number between 1 and ${MAX_TTL_HOURS}`,
      });
    }
    ttlHours = parsed;
  }

  try {
    const instance = await provisioner.create(name, ttlHours);
    void monitorProvision(name);
    return reply.code(201).send(instance);
  } catch (err) {
    if (isConflict(err)) {
      return reply.code(409).send({ error: `instance "${name}" already exists` });
    }
    emit(name, 'err', `provisioning failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
});

// Polls the real instance status after create() returns and streams progress
// to the provisioning terminal until the emulator answers its health check.
async function monitorProvision(name: string): Promise<void> {
  const deadline = Date.now() + 10 * 60_000;
  let lastStatus = '';
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    let instance: InstanceInfo | null;
    try {
      instance = await provisioner.get(name);
    } catch {
      continue;
    }
    if (!instance) {
      emit(name, 'err', 'instance disappeared during provisioning');
      return;
    }
    if (instance.status !== lastStatus) {
      lastStatus = instance.status;
      emit(name, 'info', `status: ${instance.status}`);
    }
    if (instance.status === 'running') {
      const health = await probeHealth(instance);
      if (health && typeof health === 'object') {
        emit(name, 'ok', 'emulator healthy — all AWS APIs answering');
        emit(name, 'ok', `endpoint: ${instance.endpoint}`);
        emit(name, 'done', 'ready');
        return;
      }
    }
  }
  emit(name, 'err', 'timed out waiting for the emulator (check instance logs)');
}

app.get('/api/instances/:name/events', async (request, reply) => {
  const { name } = request.params as { name: string };
  if (!isValidName(name)) {
    return reply.code(400).send({ error: 'invalid instance name' });
  }
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  reply.raw.write(': connected\n\n');
  const unsubscribe = subscribe(name, (event) => {
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  const keepalive = setInterval(() => {
    reply.raw.write(': keepalive\n\n');
  }, 15_000);
  request.raw.on('close', () => {
    clearInterval(keepalive);
    unsubscribe();
  });
  return reply;
});

app.get('/api/instances/:name', async (request, reply) => {
  const { name } = request.params as { name: string };
  if (!isValidName(name)) {
    return reply.code(400).send({ error: 'invalid instance name' });
  }
  const instance = await provisioner.get(name);
  if (!instance) {
    return reply.code(404).send({ error: 'instance not found' });
  }
  const health = await probeHealth(instance);
  return { ...instance, health };
});

app.delete('/api/instances/:name', async (request, reply) => {
  const { name } = request.params as { name: string };
  if (!isValidName(name)) {
    return reply.code(400).send({ error: 'invalid instance name' });
  }
  const deleted = await provisioner.delete(name);
  if (!deleted) {
    return reply.code(404).send({ error: 'instance not found' });
  }
  return reply.code(204).send();
});

app.get('/api/instances/:name/logs', async (request, reply) => {
  const { name } = request.params as { name: string };
  if (!isValidName(name)) {
    return reply.code(400).send({ error: 'invalid instance name' });
  }
  const instance = await provisioner.get(name);
  if (!instance) {
    return reply.code(404).send({ error: 'instance not found' });
  }
  const { tail } = request.query as { tail?: string };
  const tailLines = Math.min(Math.max(Number(tail ?? 200) || 200, 10), 2000);
  const logs = await provisioner.logs(name, tailLines);
  return { logs };
});

function instanceAwsEndpoint(name: string): string {
  return provisioner.awsEndpointFor(name);
}

async function requireRunningInstance(name: string): Promise<InstanceInfo | null> {
  if (!isValidName(name)) {
    return null;
  }
  return provisioner.get(name);
}

const VALID_REGION = /^[a-z]{2}(-[a-z]+)+-\d$/;

function requestRegion(request: { query: unknown }): string {
  const q = request.query as Record<string, string | undefined>;
  const region = q?.region ?? 'us-east-1';
  return VALID_REGION.test(region) ? region : 'us-east-1';
}

app.get('/api/instances/:name/services', async (request, reply) => {
  const { name } = request.params as { name: string };
  const instance = await requireRunningInstance(name);
  if (!instance) {
    return reply.code(404).send({ error: 'instance not found' });
  }
  return { services: await provisioner.listServices(name) };
});

app.get('/api/instances/:name/metrics', async (request, reply) => {
  const { name } = request.params as { name: string };
  const instance = await requireRunningInstance(name);
  if (!instance) {
    return reply.code(404).send({ error: 'instance not found' });
  }
  return provisioner.instanceMetrics(name);
});

app.post('/api/instances/:name/services/:service/start', async (request, reply) => {
  const { name, service } = request.params as { name: string; service: string };
  if (!isRealServiceId(service)) {
    return reply.code(400).send({ error: 'unknown service' });
  }
  const instance = await requireRunningInstance(name);
  if (!instance) {
    return reply.code(404).send({ error: 'instance not found' });
  }
  await provisioner.startService(name, service);
  return reply.code(202).send(await provisioner.getService(name, service));
});

app.post('/api/instances/:name/services/:service/stop', async (request, reply) => {
  const { name, service } = request.params as { name: string; service: string };
  if (!isRealServiceId(service)) {
    return reply.code(400).send({ error: 'unknown service' });
  }
  const instance = await requireRunningInstance(name);
  if (!instance) {
    return reply.code(404).send({ error: 'instance not found' });
  }
  await provisioner.stopService(name, service);
  return reply.code(202).send(await provisioner.getService(name, service));
});

app.get('/api/instances/:name/services/:service/logs', async (request, reply) => {
  const { name, service } = request.params as { name: string; service: string };
  if (!isRealServiceId(service)) {
    return reply.code(400).send({ error: 'unknown service' });
  }
  const instance = await requireRunningInstance(name);
  if (!instance) {
    return reply.code(404).send({ error: 'instance not found' });
  }
  const { tail } = request.query as { tail?: string };
  const tailLines = Math.min(Math.max(Number(tail ?? 200) || 200, 10), 2000);
  const logs = await provisioner.serviceLogs(name, service, tailLines);
  return { logs };
});

const AGENT_REPO_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?$/;

app.post('/api/instances/:name/agents/otel-pr', async (request, reply) => {
  const { name } = request.params as { name: string };
  const instance = await requireRunningInstance(name);
  if (!instance) {
    return reply.code(404).send({ error: 'instance not found' });
  }
  const body = (request.body ?? {}) as {
    repoUrl?: string;
    githubToken?: string;
    model?: string;
    baseBranch?: string;
    maxFiles?: number;
  };
  const repoUrl = (body.repoUrl ?? '').trim();
  const githubToken = (body.githubToken ?? '').trim();
  if (!AGENT_REPO_RE.test(repoUrl)) {
    return reply.code(400).send({ error: 'repoUrl must look like https://github.com/owner/repo' });
  }
  if (!githubToken) {
    return reply.code(400).send({ error: 'githubToken is required to push the branch and open the PR' });
  }
  const services = await provisioner.listServices(name);
  const ollama = services.find((service) => service.id === 'ollama');
  if (ollama?.status !== 'running') {
    return reply.code(409).send({ error: 'the Ollama service must be running on this instance first' });
  }
  const run = await provisioner.runOtelAgent(name, {
    repoUrl: repoUrl.replace(/\.git$/, ''),
    githubToken,
    model: body.model?.trim() || undefined,
    baseBranch: body.baseBranch?.trim() || undefined,
    maxFiles: body.maxFiles,
  });
  return reply.code(202).send(run);
});

app.get('/api/instances/:name/agents/otel-pr', async (request, reply) => {
  const { name } = request.params as { name: string };
  const instance = await requireRunningInstance(name);
  if (!instance) {
    return reply.code(404).send({ error: 'instance not found' });
  }
  return { runs: await provisioner.listOtelAgentRuns(name) };
});

app.get('/api/instances/:name/agents/otel-pr/:run/logs', async (request, reply) => {
  const { name, run } = request.params as { name: string; run: string };
  if (!/^otel-pr-[a-z0-9]+$/.test(run)) {
    return reply.code(400).send({ error: 'unknown run' });
  }
  const instance = await requireRunningInstance(name);
  if (!instance) {
    return reply.code(404).send({ error: 'instance not found' });
  }
  const { tail } = request.query as { tail?: string };
  const tailLines = Math.min(Math.max(Number(tail ?? 500) || 500, 10), 5000);
  const logs = await provisioner.otelAgentLogs(name, run, tailLines);
  return { logs };
});

app.get('/api/instances/:name/resources/:service', async (request, reply) => {
  const { name, service } = request.params as { name: string; service: string };
  if (!isServiceId(service)) {
    return reply.code(400).send({ error: 'unknown service' });
  }
  const instance = await requireRunningInstance(name);
  if (!instance) {
    return reply.code(404).send({ error: 'instance not found' });
  }
  const gateway = new ResourceGateway(instanceAwsEndpoint(name), requestRegion(request));
  try {
    return { resources: await gateway.list(service) };
  } catch (err) {
    request.log.warn({ err, service }, 'resource list failed');
    return reply.code(502).send({ error: describeAwsError(err) });
  }
});

app.post('/api/instances/:name/resources/:service', async (request, reply) => {
  const { name, service } = request.params as { name: string; service: string };
  if (!isServiceId(service)) {
    return reply.code(400).send({ error: 'unknown service' });
  }
  const instance = await requireRunningInstance(name);
  if (!instance) {
    return reply.code(404).send({ error: 'instance not found' });
  }
  const body = (request.body ?? {}) as {
    name?: string;
    value?: string;
    runtime?: string;
    handler?: string;
    code?: string;
  };
  const resourceName = (body.name ?? '').trim();
  if (!resourceName) {
    return reply.code(400).send({ error: 'resource name is required' });
  }
  const gateway = new ResourceGateway(instanceAwsEndpoint(name), requestRegion(request));
  try {
    const resource = await gateway.create(service, {
      name: resourceName,
      value: body.value,
      runtime: body.runtime,
      handler: body.handler,
      code: body.code,
    });
    return reply.code(201).send(resource);
  } catch (err) {
    request.log.warn({ err, service }, 'resource create failed');
    return reply.code(502).send({ error: describeAwsError(err) });
  }
});

app.post('/api/instances/:name/resources/:service/:id/actions/:action', async (request, reply) => {
  const { name, service, id, action } = request.params as {
    name: string;
    service: string;
    id: string;
    action: string;
  };
  if (!isServiceId(service)) {
    return reply.code(400).send({ error: 'unknown service' });
  }
  const instance = await requireRunningInstance(name);
  if (!instance) {
    return reply.code(404).send({ error: 'instance not found' });
  }
  const gateway = new ResourceGateway(instanceAwsEndpoint(name), requestRegion(request));
  try {
    const result = await gateway.act(
      service,
      decodeURIComponent(id),
      action,
      (request.body ?? {}) as Record<string, unknown>,
    );
    return reply.send({ result });
  } catch (err) {
    request.log.warn({ err, service, action }, 'resource action failed');
    return reply.code(502).send({ error: describeAwsError(err) });
  }
});

app.delete('/api/instances/:name/resources/:service/:id', async (request, reply) => {
  const { name, service, id } = request.params as { name: string; service: string; id: string };
  if (!isServiceId(service)) {
    return reply.code(400).send({ error: 'unknown service' });
  }
  const instance = await requireRunningInstance(name);
  if (!instance) {
    return reply.code(404).send({ error: 'instance not found' });
  }
  const gateway = new ResourceGateway(instanceAwsEndpoint(name), requestRegion(request));
  try {
    await gateway.remove(service, decodeURIComponent(id));
    return reply.code(204).send();
  } catch (err) {
    request.log.warn({ err, service }, 'resource delete failed');
    return reply.code(502).send({ error: describeAwsError(err) });
  }
});

app.get('/api/instances/:name/explorer/services', async () => ({ services: EXPLORER_SERVICES }));

app.post('/api/instances/:name/explorer', async (request, reply) => {
  const { name } = request.params as { name: string };
  const instance = await requireRunningInstance(name);
  if (!instance) {
    return reply.code(404).send({ error: 'instance not found' });
  }
  const body = (request.body ?? {}) as { service?: string; operation?: string; body?: string };
  const service = (body.service ?? '').trim();
  const operation = (body.operation ?? '').trim();
  if (!service || !operation) {
    return reply.code(400).send({ error: 'service and operation are required' });
  }
  try {
    const result = await explore(instanceAwsEndpoint(name), {
      service,
      operation,
      body: body.body,
      region: requestRegion(request),
    });
    return reply.send(result);
  } catch (err) {
    request.log.warn({ err, service, operation }, 'explorer call failed');
    return reply.code(502).send({ error: describeAwsError(err) });
  }
});

function describeAwsError(err: unknown): string {
  if (err && typeof err === 'object') {
    const name = 'name' in err ? String((err as { name?: unknown }).name ?? '') : '';
    const message = 'message' in err ? String((err as { message?: unknown }).message ?? '') : '';
    if (name || message) {
      return [name, message].filter(Boolean).join(': ');
    }
  }
  return 'request to instance failed';
}

async function probeHealth(instance: InstanceInfo): Promise<unknown> {
  if (instance.status !== 'running') {
    return null;
  }
  try {
    const response = await fetch(`${instanceAwsEndpoint(instance.name)}/_floci/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

if (existsSync(PUBLIC_DIR)) {
  app.register(fastifyStatic, { root: PUBLIC_DIR });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      reply.code(404).send({ error: 'not found' });
      return;
    }
    reply.sendFile('index.html');
  });
} else {
  app.log.warn(`public dir ${PUBLIC_DIR} not found — serving API only`);
}

setInterval(() => {
  provisioner
    .reapExpired()
    .then((reaped) => {
      if (reaped.length > 0) {
        app.log.info({ reaped }, 'reaped expired instances');
      }
    })
    .catch((err) => app.log.error(err, 'instance reaper failed'));
}, 60_000);

if (CADDY_ADMIN_URL) {
  const caddyConfig = buildCaddyConfig({
    instanceDomain: INSTANCE_DOMAIN,
    consoleHost: CONSOLE_HOST,
    selfUpstream: SELF_UPSTREAM,
    ...(ACME_EMAIL ? { acmeEmail: ACME_EMAIL } : {}),
    ...(process.env.ACME_STAGING === 'true' ? { acmeStaging: true } : {}),
  });
  // fire and forget — retries internally while Caddy boots
  void pushCaddyConfig(CADDY_ADMIN_URL, caddyConfig, app.log);
}

app.listen({ port: PORT, host: HOST }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
