import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Provisioner, isConflict, type InstanceInfo } from './k8s.ts';
import { isValidName, randomName } from './names.ts';
import { ResourceGateway, isServiceId } from './resources.ts';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const TOKEN = process.env.FLOCI_CLOUD_TOKEN ?? '';
const INSTANCE_DOMAIN = process.env.INSTANCE_DOMAIN ?? 'floci.172.170.57.92.nip.io';
const FLOCI_IMAGE = process.env.FLOCI_IMAGE ?? 'floci/floci:latest';
const INGRESS_CLASS = process.env.INGRESS_CLASS ?? 'nginx';
const INSTANCE_TLS = (process.env.INSTANCE_TLS ?? 'false') === 'true';
const CLUSTER_ISSUER = process.env.CLUSTER_ISSUER ?? 'letsencrypt';
const PUBLIC_DIR = process.env.PUBLIC_DIR ?? path.resolve(import.meta.dirname, '../public');
const MAX_TTL_HOURS = 7 * 24;
const MAX_INSTANCES = Number(process.env.MAX_INSTANCES ?? 20);

const app = Fastify({ logger: true });
const provisioner = new Provisioner({
  instanceDomain: INSTANCE_DOMAIN,
  flociImage: FLOCI_IMAGE,
  ingressClass: INGRESS_CLASS,
  tls: INSTANCE_TLS,
  clusterIssuer: CLUSTER_ISSUER,
});

if (!TOKEN) {
  app.log.warn('FLOCI_CLOUD_TOKEN is not set — the API is running without authentication');
}

app.addHook('onRequest', (request, reply, done) => {
  if (!request.url.startsWith('/api/') || !TOKEN) {
    done();
    return;
  }
  if (request.headers.authorization === `Bearer ${TOKEN}`) {
    done();
    return;
  }
  reply.code(401).send({ error: 'unauthorized' });
});

app.get('/healthz', async () => ({ status: 'ok' }));

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
    return reply.code(201).send(instance);
  } catch (err) {
    if (isConflict(err)) {
      return reply.code(409).send({ error: `instance "${name}" already exists` });
    }
    throw err;
  }
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
  if (process.env.KUBERNETES_SERVICE_HOST) {
    return `http://floci.floci-i-${name}.svc.cluster.local:4566`;
  }
  return `${provisioner.scheme()}://${name}.${INSTANCE_DOMAIN}`;
}

async function requireRunningInstance(name: string): Promise<InstanceInfo | null> {
  if (!isValidName(name)) {
    return null;
  }
  return provisioner.get(name);
}

app.get('/api/instances/:name/resources/:service', async (request, reply) => {
  const { name, service } = request.params as { name: string; service: string };
  if (!isServiceId(service)) {
    return reply.code(400).send({ error: 'unknown service' });
  }
  const instance = await requireRunningInstance(name);
  if (!instance) {
    return reply.code(404).send({ error: 'instance not found' });
  }
  const gateway = new ResourceGateway(instanceAwsEndpoint(name));
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
  const body = (request.body ?? {}) as { name?: string; value?: string };
  const resourceName = (body.name ?? '').trim();
  if (!resourceName) {
    return reply.code(400).send({ error: 'resource name is required' });
  }
  const gateway = new ResourceGateway(instanceAwsEndpoint(name));
  try {
    const resource = await gateway.create(service, resourceName, body.value);
    return reply.code(201).send(resource);
  } catch (err) {
    request.log.warn({ err, service }, 'resource create failed');
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
  const gateway = new ResourceGateway(instanceAwsEndpoint(name));
  try {
    await gateway.remove(service, decodeURIComponent(id));
    return reply.code(204).send();
  } catch (err) {
    request.log.warn({ err, service }, 'resource delete failed');
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

app.listen({ port: PORT, host: HOST }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
