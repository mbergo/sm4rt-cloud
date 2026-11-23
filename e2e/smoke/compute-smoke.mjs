#!/usr/bin/env node
// Compute smoke test: exercises every non-catalog console feature that
// provisions something real - caches, databases, containers, servers, API
// gateway, DNS, CDN, object store, table store, message broker, registry,
// functions, observability and the DevOps stack. Each one is created through
// the control-plane API, checked for a real answer, then deleted again.
//
//   node e2e/smoke/compute-smoke.mjs --api https://cloud.example.com \
//        --token "$FLOCI_CLOUD_TOKEN" --workspace smoke
//
// Local swarm without DNS: add --edge http://127.0.0.1 (public hostnames go in
// the Host header). Exit code 0 only when every selected feature passes.

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

// Accepts both `--key value` and `--key=value`.
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (!a.startsWith('--')) {
      return acc;
    }
    const eq = a.indexOf('=');
    if (eq > 2) {
      acc.push([a.slice(2, eq), a.slice(eq + 1)]);
      return acc;
    }
    const next = all[i + 1];
    acc.push([a.slice(2), next && !next.startsWith('--') ? next : 'true']);
    return acc;
  }, []),
);

const API = (args.api ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const TOKEN = args.token ?? process.env.FLOCI_CLOUD_TOKEN ?? '';
const WS = args.workspace ?? 'smoke';
const EDGE = args.edge ? args.edge.replace(/\/$/, '') : null;
// an explicit --only, even an empty one, is a filter: an empty one selects
// nothing and is rejected below instead of meaning "everything"
const ONLY = args.only !== undefined ? args.only.split(',').filter(Boolean) : null;
const SKIP = args.skip !== undefined ? args.skip.split(',').filter(Boolean) : [];
const WAIT = Number(args['wait-seconds'] ?? 600) * 1000;
const BASE = `/api/instances/${WS}/compute`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(300_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not json
  }
  return { status: res.status, text, json };
}

function edgeRequest(publicUrl, path = '/', opts = {}) {
  const target = new URL(path, publicUrl);
  const via = EDGE ? new URL(EDGE) : target;
  const lib = via.protocol === 'https:' ? https : http;
  const headers = { host: target.host, ...(opts.headers ?? {}) };
  if (opts.body !== undefined) {
    headers['content-length'] = Buffer.byteLength(opts.body);
  }
  return new Promise((resolve) => {
    const req = lib.request(
      {
        hostname: via.hostname,
        port: via.port || (via.protocol === 'https:' ? 443 : 80),
        path: target.pathname + target.search,
        method: opts.method ?? 'GET',
        headers,
        servername: target.hostname,
        timeout: 20_000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => resolve({ status: 0, headers: {}, body: '', error: err.message }));
    if (opts.body !== undefined) {
      req.write(opts.body);
    }
    req.end();
  });
}

/** True when something accepts TCP connections on host:port. */
function tcpOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 5000 });
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => resolve(false));
  });
}

class Failed extends Error {}
const must = (cond, why) => {
  if (!cond) {
    throw new Failed(why);
  }
};

/** Poll until `fn` returns a truthy value or the wait budget runs out. */
async function until(what, fn) {
  const deadline = Date.now() + WAIT;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) {
        return value;
      }
    } catch (err) {
      last = err.message;
    }
    await sleep(4000);
  }
  throw new Failed(`${what} did not happen within ${WAIT / 1000}s${last ? ` (${last})` : ''}`);
}

// Short random suffix so two runs against one workspace never share a name.
const RUN = Math.random().toString(36).slice(2, 6);
const named = (base) => `${base}-${RUN}`;

async function create(path, body) {
  const res = await api('POST', `${BASE}/${path}`, body ?? {});
  must(res.status === 201, `POST ${path} -> HTTP ${res.status} ${res.text.slice(0, 200)}`);
  return res.json;
}

/**
 * Runs one feature with its own cleanup list. Every resource a feature
 * creates registers its removal right after creation, and the removals run
 * newest first however the feature ends. A removal that fails fails the
 * feature, so a passing run never leaves anything behind.
 */
async function withCleanup(body) {
  const cleanups = [];
  const own = (label, fn) => cleanups.push({ label, fn });
  let detail;
  let error = null;
  try {
    detail = await body(own);
  } catch (err) {
    error = err;
  }
  const leaks = [];
  for (const { label, fn } of cleanups.reverse()) {
    try {
      await fn();
    } catch (err) {
      leaks.push(`${label}: ${err.message}`);
    }
  }
  if (error) {
    throw new Failed(leaks.length ? `${error.message}; cleanup also failed - ${leaks.join('; ')}` : error.message);
  }
  if (leaks.length) {
    throw new Failed(`cleanup failed - ${leaks.join('; ')}`);
  }
  return detail;
}

const removing = (path, ok = [204]) => async () => {
  const res = await api('DELETE', `${BASE}/${path}`);
  must(ok.includes(res.status), `DELETE ${path} -> HTTP ${res.status} ${res.text.slice(0, 160)}`);
};

/** Workspace-wide add-ons (one per workspace): never take over one that exists. */
async function enableAddon(path, own) {
  const before = await api('GET', `${BASE}/${path}`);
  must(before.status === 200, `GET ${path} -> HTTP ${before.status}`);
  // Most add-ons answer with their status object; observability wraps it as
  // { observability: <status|null> }.
  const status = before.json && 'observability' in before.json ? before.json.observability : before.json;
  must(
    !status?.enabled && !['running', 'starting'].includes(status?.state),
    `${path} is already enabled in workspace "${WS}" - disable it or use another workspace`,
  );
  const made = await create(path);
  own(path, removing(path));
  return made;
}

/** Wait for an item in a list endpoint to report state "running". */
const runningIn = (path, key, name) =>
  until(`${path} "${name}" running`, async () => {
    const res = await api('GET', `${BASE}/${path}`);
    const item = (res.json?.[key] ?? []).find((x) => x.name === name);
    must(item?.state !== 'error', `${path} "${name}" is in error: ${JSON.stringify(item).slice(0, 200)}`);
    return item?.state === 'running' ? item : null;
  });

/** Run a command inside a workspace service through the console's exec API. */
const execIn = (target, script) =>
  until(`command in ${target}`, async () => {
    const res = await api('POST', `/api/instances/${WS}/exec`, { service: target, cmd: ['sh', '-c', script] });
    return res.status === 200 && res.json?.exitCode === 0 ? String(res.json.output ?? '') : null;
  });

// The edge answers 200 with an empty body for a hostname it has no route for
// yet, so a status code alone cannot tell "served" from "not routed". Every
// check therefore also names something the real backend puts in its answer.
const edgeOk = (what, url, path, { want = 200, contains = null, header = null } = {}) =>
  until(`${what} answering ${want} at ${url}${path}`, async () => {
    const res = await edgeRequest(url, path);
    if (res.status !== want) {
      return null;
    }
    if (contains && !res.body.includes(contains)) {
      return null;
    }
    if (header && !res.headers[header]) {
      return null;
    }
    return res;
  });

/** A web container of this run's own: the gateway, DNS alias and CDN need an upstream. */
async function webTask(own) {
  const name = named('web');
  await create('tasks', { name, image: 'httpd:2.4.68', port: 80, plan: 'micro' });
  own(`task ${name}`, async () => {
    const res = await api('POST', `${BASE}/tasks/${name}/action`, { action: 'delete' });
    must(res.status === 202, `delete task ${name} -> HTTP ${res.status} ${res.text.slice(0, 160)}`);
  });
  const task = await runningIn('tasks', 'tasks', name);
  await edgeOk('container', task.url, '/', { contains: 'It works' });
  return task;
}

const shq = (v) => `'${String(v).replaceAll("'", `'\\''`)}'`;

const FEATURES = {
  container: () =>
    withCleanup(async (own) => {
      const task = await webTask(own);
      const logs = await api('GET', `${BASE}/tasks/${task.name}/logs`);
      must(logs.status === 200, `task logs -> HTTP ${logs.status}`);
      return 'httpd container served through its public URL; logs readable';
    }),

  cache: () =>
    withCleanup(async (own) => {
      const out = [];
      for (const engine of ['redis-7', 'valkey-8']) {
        const name = named(`sc-${engine.split('-')[0]}`);
        const made = await create('caches', { name, engine, plan: 'micro' });
        own(`cache ${name}`, removing(`caches/${name}`));
        must(made.connectionUri?.startsWith('redis://'), 'cache has no connection URI');
        await runningIn('caches', 'caches', name);
        // a real command over the protocol, not just the reported state
        const cli = engine.startsWith('valkey') ? 'valkey-cli' : 'redis-cli';
        const out1 = await execIn(
          `sm4rt-cache-${WS}-${name}`,
          `${cli} -a ${shq(made.password)} --no-auth-warning SET smoke ok >/dev/null && ${cli} -a ${shq(made.password)} --no-auth-warning GET smoke`,
        );
        must(out1.includes('ok'), `${engine} SET/GET returned ${out1.trim().slice(0, 80)}`);
        out.push(engine);
      }
      return `${out.join(', ')} answered SET/GET`;
    }),

  database: () =>
    withCleanup(async (own) => {
      const out = [];
      for (const engine of ['postgres-16', 'mysql-8', 'mariadb-11']) {
        const name = named(`sd-${engine.split('-')[0]}`);
        const made = await create('databases', { name, engine, plan: 'micro' });
        own(`database ${name}`, removing(`databases/${name}`));
        must(Boolean(made.connectionUri), 'database has no connection URI');
        await runningIn('databases', 'databases', name);
        const target = `sm4rt-db-${WS}-${name}`;
        const query =
          engine === 'postgres-16'
            ? `PGPASSWORD=${shq(made.password)} psql -h 127.0.0.1 -U ${shq(made.user)} -d ${shq(made.database)} -tAc 'select 41+1'`
            : `${engine === 'mysql-8' ? 'mysql' : 'mariadb'} -h 127.0.0.1 -u${shq(made.user)} -p${shq(made.password)} ${shq(made.database)} -Nse 'select 41+1'`;
        const answer = await execIn(target, query);
        must(answer.trim().endsWith('42'), `${engine} query returned ${answer.trim().slice(0, 80)}`);
        const logs = await api('GET', `${BASE}/databases/${name}/logs`);
        must(logs.status === 200 && String(logs.json?.logs ?? '').length > 0, 'database logs are empty');
        out.push(engine);
      }
      return `${out.join(', ')} answered a query over the network port`;
    }),

  server: () =>
    withCleanup(async (own) => {
      const made = await create('vms', { name: named('vm'), image: 'alpine-3', plan: 'nano' });
      own(`server ${made.id}`, async () => {
        const res = await api('POST', `${BASE}/vms/${made.id}/action`, { action: 'terminate' });
        must(res.status === 202, `terminate server -> HTTP ${res.status} ${res.text.slice(0, 160)}`);
      });
      await until('server running', async () => {
        const res = await api('GET', `${BASE}/vms`);
        const vm = (res.json?.vms ?? []).find((v) => v.id === made.id);
        return vm?.state === 'running' ? vm : null;
      });
      const host = EDGE ? new URL(EDGE).hostname : made.sshHost;
      await until(`SSH port ${made.sshPort} open`, () => tcpOpen(host, made.sshPort));
      return `alpine server running, SSH port ${made.sshPort} accepting connections`;
    }),

  gateway: () =>
    withCleanup(async (own) => {
      const task = await webTask(own);
      const name = named('gw');
      const made = await create('gateways', { name, routes: [{ path: '/web', target: `task:${task.name}` }] });
      own(`gateway ${name}`, removing(`gateways/${name}`));
      await edgeOk('gateway route', made.url, '/web', { contains: 'It works' });
      return 'route /web proxied to the container';
    }),

  dns: () =>
    withCleanup(async (own) => {
      const task = await webTask(own);
      const record = named('www');
      const made = await create('dns', { record, type: 'ALIAS', target: task.name });
      own(`dns ${record}`, removing(`dns/${record}`));
      await edgeOk('DNS alias', `http://${made.fqdn}`, '/', { contains: 'It works' });
      return `${made.fqdn} served the container`;
    }),

  cdn: () =>
    withCleanup(async (own) => {
      const task = await webTask(own);
      const name = named('cdn');
      const made = await create('cdns', { name, origin: `http://sm4rt-task-${WS}-${task.name}:80` });
      own(`cdn ${name}`, removing(`cdns/${name}`));
      await edgeOk('CDN', made.url, '/', { contains: 'It works', header: 'x-cache' });
      const hit = await until('CDN cache hit', async () => {
        const res = await edgeRequest(made.url, '/');
        return String(res.headers['x-cache'] ?? '').includes('HIT') ? res : null;
      });
      must(hit.status === 200, 'CDN hit was not a 200');
      const purge = await api('POST', `${BASE}/cdns/${name}/purge`);
      must(purge.status === 202, `purge -> HTTP ${purge.status}`);
      return 'origin served, second request was a cache HIT, purge accepted';
    }),

  objectstore: () =>
    withCleanup(async (own) => {
      await enableAddon('objectstore', own);
      await until('object store running', async () => (await api('GET', `${BASE}/objectstore`)).json?.state === 'running');
      const bucket = named('smoke-bucket');
      // a fresh name, so only a real create can make it appear in the list
      // Owned before the first POST: a retried create can land server-side
      // even when its reply is lost. 404 means nothing was created.
      own(`bucket ${bucket}`, removing(`objectstore/buckets/${bucket}`, [204, 404]));
      await until('bucket created', async () => {
        const res = await api('POST', `${BASE}/objectstore/buckets`, { name: bucket });
        return res.status === 201;
      });
      const list = await api('GET', `${BASE}/objectstore/buckets`);
      must((list.json?.buckets ?? []).some((b) => b.name === bucket), 'bucket missing from the list');
      return 'S3 store running; bucket created, listed and deleted';
    }),

  tablestore: () =>
    withCleanup(async (own) => {
      await enableAddon('tablestore', own);
      await until('table store running', async () => (await api('GET', `${BASE}/tablestore`)).json?.state === 'running');
      const table = `smoke_table_${RUN}`;
      own(`table ${table}`, removing(`tablestore/tables/${table}`, [204, 404]));
      await until('table created', async () => {
        const res = await api('POST', `${BASE}/tablestore/tables`, { name: table, hashKey: 'id' });
        return res.status === 201;
      });
      const list = await api('GET', `${BASE}/tablestore/tables`);
      must((list.json?.tables ?? []).some((t) => t.name === table), 'table missing from the list');
      return 'DynamoDB-compatible store running; table created, listed and deleted';
    }),

  broker: () =>
    withCleanup(async (own) => {
      const made = await enableAddon('broker', own);
      await until('broker running', async () => (await api('GET', `${BASE}/broker`)).json?.state === 'running');
      const queue = named('smoke-q');
      own(`queue ${queue}`, removing(`broker/queues/${queue}`, [204, 404]));
      await until('queue created', async () => (await api('POST', `${BASE}/broker/queues`, { name: queue })).status === 201);
      const list = await api('GET', `${BASE}/broker/queues`);
      must((list.json?.queues ?? []).some((q) => q.name === queue), 'queue missing from the list');
      await edgeOk('broker management UI', made.managementUrl, '/', { contains: 'RabbitMQ' });
      return 'RabbitMQ running; queue created and listed; management UI reachable';
    }),

  registry: () =>
    withCleanup(async (own) => {
      const made = await enableAddon('registry', own);
      await until('registry running', async () => (await api('GET', `${BASE}/registry`)).json?.state === 'running');
      // /v2/ must demand credentials: 401 means the registry is up and protected
      await edgeOk('registry API', made.url, '/v2/', { want: 401 });
      const repos = await until('repo listing', async () => {
        const res = await api('GET', `${BASE}/registry/repos`);
        return res.status === 200 ? res : null;
      });
      must(Array.isArray(repos.json?.repos), 'repo list is not an array');
      return 'registry running, /v2/ requires auth, repo listing works';
    }),

  function: () =>
    withCleanup(async (own) => {
      const name = named('fn');
      const made = await create('functions', { name });
      own(`function ${name}`, removing(`functions/${name}`));
      const res = await edgeOk('function', made.url, '/', { contains: 'hello' });
      return `invoked over HTTP -> ${res.body.slice(0, 60)}`;
    }),

  observability: () =>
    withCleanup(async (own) => {
      const made = await enableAddon('observability', own);
      const health = await edgeOk('Grafana', made.grafanaUrl, '/api/health', { contains: 'database' });
      let db = null;
      try {
        db = JSON.parse(health.body).database;
      } catch {
        // not JSON
      }
      must(db === 'ok', `Grafana health reports database=${db}`);
      await until('OTLP ingest', async () => {
        const res = await edgeRequest(made.otlpUrl, '/v1/logs', {
          method: 'POST',
          body: '{"resourceLogs":[]}',
          headers: { 'content-type': 'application/json' },
        });
        return res.status === 200;
      });
      return 'Grafana healthy; OTLP endpoint accepted a log export';
    }),

  devops: () =>
    withCleanup(async (own) => {
      const made = await enableAddon('devops', own);
      await edgeOk('Gitea', made.gitUrl, '/api/v1/version', { contains: 'version' });
      await edgeOk('CI server', made.ciUrl, '/healthz', { want: 204 });
      await until('DevOps bootstrapped', async () => {
        const res = await api('GET', `${BASE}/devops`);
        return res.json?.bootstrapped === true && res.json?.state === 'running';
      });
      return 'Gitea and the CI server answered; stack bootstrapped';
    }),
};

async function main() {
  const ws = await api('GET', `/api/instances/${WS}`);
  if (ws.status !== 200) {
    console.error(`workspace "${WS}" not reachable: HTTP ${ws.status} ${ws.text.slice(0, 200)}`);
    process.exit(2);
  }
  const unknown = [...(ONLY ?? []), ...SKIP].filter((k) => !Object.hasOwn(FEATURES, k));
  if (unknown.length > 0) {
    console.error(`unknown features: ${unknown.join(', ')} (known: ${Object.keys(FEATURES).join(', ')})`);
    process.exit(2);
  }
  const selected = Object.keys(FEATURES).filter((k) => (!ONLY || ONLY.includes(k)) && !SKIP.includes(k));
  if (selected.length === 0) {
    console.error('the selection matches no feature');
    process.exit(2);
  }
  log(`run ${RUN}: testing ${selected.join(', ')}`);
  const results = [];
  for (const key of selected) {
    log(`▶ ${key}`);
    const started = Date.now();
    try {
      const detail = await FEATURES[key]();
      results.push({ key, ok: true, detail });
      log(`  ${key}: PASS - ${detail} [${Math.round((Date.now() - started) / 1000)}s]`);
    } catch (err) {
      results.push({ key, ok: false, detail: err.message });
      log(`  ${key}: FAIL - ${err.message}`);
    }
  }
  console.log('\nfeature         result');
  for (const r of results) {
    console.log(`${r.key.padEnd(15)} ${r.ok ? 'pass' : 'FAIL'}  ${r.detail}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} features passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
