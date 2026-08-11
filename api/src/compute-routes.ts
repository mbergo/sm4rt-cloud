// Sm4rt compute routes: real VMs, container tasks, databases, caches, DNS,
// API gateways, CDNs, observability and DevOps (Gitea + Woodpecker + GitOps).
// Mounted under /api/instances/:name/compute/* — auth comes from the global hook.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ComputeError, type ComputeManager } from './compute.ts';
import type { DevopsManager } from './devops.ts';
import type { RegistryManager } from './registry.ts';
import type { ObjectStoreManager } from './objectstore.ts';
import type { TableStoreManager } from './tablestore.ts';
import type { BrokerManager } from './broker.ts';
import type { GatewayRoute } from './compute-templates.ts';

export interface ComputeRouteDeps {
  compute: ComputeManager;
  devops: DevopsManager;
  registry: RegistryManager;
  objectstore: ObjectStoreManager;
  tablestore: TableStoreManager;
  broker: BrokerManager;
  /** resolves the workspace or null when it does not exist */
  requireInstance: (name: string) => Promise<unknown | null>;
  /** compute is swarm-only; other drivers get an honest 501 */
  enabled: boolean;
}

type Req = FastifyRequest;
type Rep = FastifyReply;

function errStatus(err: unknown): { code: number; message: string } {
  if (err instanceof ComputeError) return { code: err.status, message: err.message };
  const msg = err instanceof Error ? err.message : String(err);
  const m = /\(HTTP code (\d{3})\)/.exec(msg);
  return { code: m ? Number(m[1]) : 500, message: msg };
}

function tailFrom(req: Req): number {
  const { tail } = req.query as { tail?: string };
  return Math.min(Math.max(Number(tail ?? 200) || 200, 10), 2000);
}

export function registerComputeRoutes(app: FastifyInstance, deps: ComputeRouteDeps): void {
  const { compute, devops, registry, objectstore, tablestore, broker } = deps;
  const base = '/api/instances/:name/compute';

  /** shared preamble: 501 off-swarm, 404 unknown workspace, then run + map errors */
  function route<T>(handler: (ws: string, req: Req, reply: Rep) => Promise<T>) {
    return async (req: Req, reply: Rep) => {
      if (!deps.enabled) {
        return reply
          .code(501)
          .send({ error: 'compute requires the swarm driver — not available on this deployment' });
      }
      const { name } = req.params as { name: string };
      const instance = await deps.requireInstance(name);
      if (!instance) return reply.code(404).send({ error: 'instance not found' });
      try {
        return await handler(name, req, reply);
      } catch (err) {
        const { code, message } = errStatus(err);
        req.log.warn({ err, ws: name }, 'compute route error');
        return reply.code(code).send({ error: message });
      }
    };
  }

  // — VMs (real SSH-able servers) —
  app.get(`${base}/vms`, route(async (ws) => ({ vms: await compute.listVms(ws) })));
  app.post(
    `${base}/vms`,
    route(async (ws, req, reply) => {
      const body = req.body as { name?: string; image?: string; plan?: string };
      const vm = await compute.createVm(ws, {
        name: body?.name ?? '',
        image: body?.image ?? '',
        plan: body?.plan ?? '',
      });
      return reply.code(201).send(vm);
    }),
  );
  app.post(
    `${base}/vms/:id/action`,
    route(async (ws, req, reply) => {
      const { id } = req.params as { id: string };
      const { action } = req.body as { action?: string };
      if (!['stop', 'start', 'reboot', 'terminate'].includes(action ?? '')) {
        return reply.code(400).send({ error: 'action must be stop|start|reboot|terminate' });
      }
      await compute.vmAction(ws, id, action as 'stop' | 'start' | 'reboot' | 'terminate');
      return reply.code(202).send({ ok: true });
    }),
  );
  app.get(
    `${base}/vms/:id/logs`,
    route(async (ws, req) => {
      const { id } = req.params as { id: string };
      return { logs: await compute.vmLogs(ws, id, tailFrom(req)) };
    }),
  );

  // — Container tasks (ECS-style, public URL via caddy) —
  app.get(`${base}/tasks`, route(async (ws) => ({ tasks: await compute.listTasks(ws) })));
  app.post(
    `${base}/tasks`,
    route(async (ws, req, reply) => {
      const b = req.body as Record<string, unknown>;
      const task = await compute.createTask(ws, {
        name: String(b?.name ?? ''),
        image: String(b?.image ?? ''),
        port: b?.port == null ? null : Number(b.port),
        env: (b?.env as Record<string, string>) ?? undefined,
        replicas: b?.replicas == null ? undefined : Number(b.replicas),
        plan: typeof b?.plan === 'string' ? b.plan : undefined,
        cpus: b?.cpus == null ? undefined : Number(b.cpus),
        memoryMb: b?.memoryMb == null ? undefined : Number(b.memoryMb),
        metricsPort: b?.metricsPort == null ? null : Number(b.metricsPort),
        metricsPath: typeof b?.metricsPath === 'string' ? b.metricsPath : undefined,
      });
      return reply.code(201).send(task);
    }),
  );
  app.patch(
    `${base}/tasks/:task`,
    route(async (ws, req) => {
      const { task } = req.params as { task: string };
      const b = req.body as Record<string, unknown>;
      return compute.updateTask(ws, task, {
        ...(b?.image !== undefined ? { image: String(b.image) } : {}),
        ...(b?.port !== undefined ? { port: b.port == null ? null : Number(b.port) } : {}),
        ...(b?.env !== undefined ? { env: b.env as Record<string, string> } : {}),
        ...(b?.replicas !== undefined ? { replicas: Number(b.replicas) } : {}),
        ...(typeof b?.plan === 'string' ? { plan: b.plan } : {}),
        ...(b?.metricsPort !== undefined
          ? { metricsPort: b.metricsPort == null ? null : Number(b.metricsPort) }
          : {}),
        ...(b?.metricsPath !== undefined ? { metricsPath: String(b.metricsPath) } : {}),
      });
    }),
  );
  app.post(
    `${base}/tasks/:task/action`,
    route(async (ws, req, reply) => {
      const { task } = req.params as { task: string };
      const { action } = req.body as { action?: string };
      if (!['restart', 'delete'].includes(action ?? '')) {
        return reply.code(400).send({ error: 'action must be restart|delete' });
      }
      await compute.taskAction(ws, task, action as 'restart' | 'delete');
      return reply.code(202).send({ ok: true });
    }),
  );
  app.get(
    `${base}/tasks/:task/logs`,
    route(async (ws, req) => {
      const { task } = req.params as { task: string };
      return { logs: await compute.taskLogs(ws, task, tailFrom(req)) };
    }),
  );

  // — Managed databases —
  app.get(`${base}/databases`, route(async (ws) => ({ databases: await compute.listDatabases(ws) })));
  app.post(
    `${base}/databases`,
    route(async (ws, req, reply) => {
      const b = req.body as { name?: string; engine?: string; plan?: string; external?: boolean };
      const db = await compute.createDatabase(ws, {
        name: b?.name ?? '',
        engine: b?.engine ?? '',
        plan: typeof b?.plan === 'string' ? b.plan : undefined,
        external: Boolean(b?.external),
      });
      return reply.code(201).send(db);
    }),
  );
  app.delete(
    `${base}/databases/:db`,
    route(async (ws, req, reply) => {
      const { db } = req.params as { db: string };
      await compute.deleteDatabase(ws, db);
      return reply.code(204).send();
    }),
  );
  app.get(
    `${base}/databases/:db/logs`,
    route(async (ws, req) => {
      const { db } = req.params as { db: string };
      return { logs: await compute.databaseLogs(ws, db, tailFrom(req)) };
    }),
  );

  // — Managed caches —
  app.get(`${base}/caches`, route(async (ws) => ({ caches: await compute.listCaches(ws) })));
  app.post(
    `${base}/caches`,
    route(async (ws, req, reply) => {
      const b = req.body as { name?: string; engine?: string; plan?: string; external?: boolean };
      const cache = await compute.createCache(ws, {
        name: b?.name ?? '',
        engine: b?.engine ?? '',
        plan: typeof b?.plan === 'string' ? b.plan : undefined,
        external: Boolean(b?.external),
      });
      return reply.code(201).send(cache);
    }),
  );
  app.delete(
    `${base}/caches/:cache`,
    route(async (ws, req, reply) => {
      const { cache } = req.params as { cache: string };
      await compute.deleteCache(ws, cache);
      return reply.code(204).send();
    }),
  );

  // — DNS (per-workspace zone) —
  app.get(`${base}/dns`, route(async (ws) => ({ records: await compute.listDns(ws) })));
  app.post(
    `${base}/dns`,
    route(async (ws, req, reply) => {
      const b = req.body as { record?: string; type?: string; target?: string };
      const rec = await compute.createDns(ws, {
        record: b?.record ?? '',
        type: b?.type ?? '',
        target: b?.target ?? '',
      });
      return reply.code(201).send(rec);
    }),
  );
  app.delete(
    `${base}/dns/:record`,
    route(async (ws, req, reply) => {
      const { record } = req.params as { record: string };
      await compute.deleteDns(ws, record);
      return reply.code(204).send();
    }),
  );

  // — API gateways —
  app.get(`${base}/gateways`, route(async (ws) => ({ gateways: await compute.listGateways(ws) })));
  app.post(
    `${base}/gateways`,
    route(async (ws, req, reply) => {
      const b = req.body as { name?: string; routes?: GatewayRoute[] };
      const gw = await compute.createGateway(ws, {
        name: b?.name ?? '',
        routes: Array.isArray(b?.routes) ? b.routes : [],
      });
      return reply.code(201).send(gw);
    }),
  );
  app.put(
    `${base}/gateways/:gw`,
    route(async (ws, req) => {
      const { gw } = req.params as { gw: string };
      const b = req.body as { routes?: GatewayRoute[] };
      return compute.updateGateway(ws, gw, Array.isArray(b?.routes) ? b.routes : []);
    }),
  );
  app.delete(
    `${base}/gateways/:gw`,
    route(async (ws, req, reply) => {
      const { gw } = req.params as { gw: string };
      await compute.deleteGateway(ws, gw);
      return reply.code(204).send();
    }),
  );

  // — CDN (Varnish) —
  app.get(`${base}/cdns`, route(async (ws) => ({ cdns: await compute.listCdns(ws) })));
  app.post(
    `${base}/cdns`,
    route(async (ws, req, reply) => {
      const b = req.body as { name?: string; origin?: string; ttlSeconds?: number };
      const cdn = await compute.createCdn(ws, {
        name: b?.name ?? '',
        origin: b?.origin ?? '',
        ttlSeconds: b?.ttlSeconds == null ? undefined : Number(b.ttlSeconds),
      });
      return reply.code(201).send(cdn);
    }),
  );
  app.post(
    `${base}/cdns/:cdn/purge`,
    route(async (ws, req, reply) => {
      const { cdn } = req.params as { cdn: string };
      await compute.purgeCdn(ws, cdn);
      return reply.code(202).send({ ok: true });
    }),
  );
  app.delete(
    `${base}/cdns/:cdn`,
    route(async (ws, req, reply) => {
      const { cdn } = req.params as { cdn: string };
      await compute.deleteCdn(ws, cdn);
      return reply.code(204).send();
    }),
  );

  // — Observability (LGTM + OTel + discovery) —
  app.get(
    `${base}/observability`,
    route(async (ws) => ({ observability: await compute.getObservability(ws) })),
  );
  app.post(
    `${base}/observability`,
    route(async (ws, _req, reply) => reply.code(201).send(await compute.enableObservability(ws))),
  );
  app.delete(
    `${base}/observability`,
    route(async (ws, _req, reply) => {
      await compute.disableObservability(ws);
      return reply.code(204).send();
    }),
  );

  // — DevOps: Gitea + Woodpecker + GitOps —
  app.get(`${base}/devops`, route(async (ws) => devops.status(ws)));
  app.post(`${base}/devops`, route(async (ws, _req, reply) => reply.code(201).send(await devops.enable(ws))));
  app.post(`${base}/devops/retry-bootstrap`, route(async (ws) => devops.retryBootstrap(ws)));
  app.delete(
    `${base}/devops`,
    route(async (ws, _req, reply) => {
      await devops.disable(ws);
      return reply.code(204).send();
    }),
  );
  app.get(`${base}/gitops/apps`, route(async (ws) => ({ apps: await devops.listApps(ws) })));
  app.post(
    `${base}/gitops/apps`,
    route(async (ws, req, reply) => {
      const b = req.body as {
        name?: string;
        repo?: string;
        branch?: string;
        path?: string;
        autoSync?: boolean;
      };
      const created = await devops.addApp(ws, {
        name: b?.name ?? '',
        repo: b?.repo ?? '',
        ...(b?.branch ? { branch: b.branch } : {}),
        ...(b?.path ? { path: b.path } : {}),
        ...(b?.autoSync !== undefined ? { autoSync: Boolean(b.autoSync) } : {}),
      });
      return reply.code(201).send(created);
    }),
  );
  app.post(
    `${base}/gitops/apps/:appName/sync`,
    route(async (ws, req) => {
      const { appName } = req.params as { appName: string };
      return devops.syncApp(ws, appName);
    }),
  );
  app.delete(
    `${base}/gitops/apps/:appName`,
    route(async (ws, req, reply) => {
      const { appName } = req.params as { appName: string };
      await devops.removeApp(ws, appName);
      return reply.code(204).send();
    }),
  );

  // — Container Registry: real registry:2 per workspace (docker login/push/pull) —
  app.get(`${base}/registry`, route(async (ws) => registry.status(ws)));
  app.post(
    `${base}/registry`,
    route(async (ws, _req, reply) => reply.code(201).send(await registry.enable(ws))),
  );
  app.delete(
    `${base}/registry`,
    route(async (ws, _req, reply) => {
      await registry.disable(ws);
      return reply.code(204).send();
    }),
  );
  app.get(`${base}/registry/repos`, route(async (ws) => ({ repos: await registry.listRepos(ws) })));
  app.delete(
    `${base}/registry/repos/:repo/tags/:tag`,
    route(async (ws, req, reply) => {
      const { repo, tag } = req.params as { repo: string; tag: string };
      await registry.deleteTag(ws, decodeURIComponent(repo), tag);
      return reply.code(204).send();
    }),
  );

  // — Object Store: real MinIO per workspace (aws s3 / SDKs, path-style) —
  app.get(`${base}/objectstore`, route(async (ws) => objectstore.status(ws)));
  app.post(
    `${base}/objectstore`,
    route(async (ws, _req, reply) => reply.code(201).send(await objectstore.enable(ws))),
  );
  app.delete(
    `${base}/objectstore`,
    route(async (ws, _req, reply) => {
      await objectstore.disable(ws);
      return reply.code(204).send();
    }),
  );
  app.get(
    `${base}/objectstore/buckets`,
    route(async (ws) => ({ buckets: await objectstore.listBuckets(ws) })),
  );
  app.post(
    `${base}/objectstore/buckets`,
    route(async (ws, req, reply) => {
      const { name } = (req.body ?? {}) as { name?: string };
      await objectstore.createBucket(ws, name ?? '');
      return reply.code(201).send({ ok: true });
    }),
  );
  app.delete(
    `${base}/objectstore/buckets/:bucket`,
    route(async (ws, req, reply) => {
      const { bucket } = req.params as { bucket: string };
      await objectstore.deleteBucket(ws, bucket);
      return reply.code(204).send();
    }),
  );

  // — Table Store: real ScyllaDB Alternator per workspace (DynamoDB protocol) —
  app.get(`${base}/tablestore`, route(async (ws) => tablestore.status(ws)));
  app.post(
    `${base}/tablestore`,
    route(async (ws, _req, reply) => reply.code(201).send(await tablestore.enable(ws))),
  );
  app.delete(
    `${base}/tablestore`,
    route(async (ws, _req, reply) => {
      await tablestore.disable(ws);
      return reply.code(204).send();
    }),
  );
  app.get(
    `${base}/tablestore/tables`,
    route(async (ws) => ({ tables: await tablestore.listTables(ws) })),
  );
  app.post(
    `${base}/tablestore/tables`,
    route(async (ws, req, reply) => {
      const body = (req.body ?? {}) as {
        name?: string;
        hashKey?: string;
        hashType?: 'S' | 'N' | 'B';
        rangeKey?: string;
        rangeType?: 'S' | 'N' | 'B';
      };
      await tablestore.createTable(ws, {
        name: body.name ?? '',
        hashKey: body.hashKey ?? 'id',
        hashType: body.hashType ?? 'S',
        ...(body.rangeKey ? { rangeKey: body.rangeKey, rangeType: body.rangeType ?? 'S' } : {}),
      });
      return reply.code(201).send({ ok: true });
    }),
  );
  app.delete(
    `${base}/tablestore/tables/:table`,
    route(async (ws, req, reply) => {
      const { table } = req.params as { table: string };
      await tablestore.deleteTable(ws, table);
      return reply.code(204).send();
    }),
  );

  // — Message Broker: real RabbitMQ per workspace (AMQP + management UI) —
  app.get(`${base}/broker`, route(async (ws) => broker.status(ws)));
  app.post(
    `${base}/broker`,
    route(async (ws, _req, reply) => reply.code(201).send(await broker.enable(ws))),
  );
  app.delete(
    `${base}/broker`,
    route(async (ws, _req, reply) => {
      await broker.disable(ws);
      return reply.code(204).send();
    }),
  );
  app.get(`${base}/broker/queues`, route(async (ws) => ({ queues: await broker.listQueues(ws) })));
  app.post(
    `${base}/broker/queues`,
    route(async (ws, req, reply) => {
      const { name } = (req.body ?? {}) as { name?: string };
      await broker.createQueue(ws, name ?? '');
      return reply.code(201).send({ ok: true });
    }),
  );
  app.delete(
    `${base}/broker/queues/:queue`,
    route(async (ws, req, reply) => {
      const { queue } = req.params as { queue: string };
      await broker.deleteQueue(ws, decodeURIComponent(queue));
      return reply.code(204).send();
    }),
  );

  // — Summary for the workspace overview page —
  app.get(`${base}/summary`, route(async (ws) => compute.summary(ws)));
}
