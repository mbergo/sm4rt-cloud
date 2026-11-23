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

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) {
      const next = all[i + 1];
      acc.push([a.slice(2), next && !next.startsWith('--') ? next : 'true']);
    }
    return acc;
  }, []),
);

const API = (args.api ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const TOKEN = args.token ?? process.env.FLOCI_CLOUD_TOKEN ?? '';
const WS = args.workspace ?? 'smoke';
const EDGE = args.edge ? args.edge.replace(/\/$/, '') : null;
const ONLY = args.only ? args.only.split(',') : null;
const SKIP = args.skip ? args.skip.split(',') : [];
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

async function create(path, body) {
  const res = await api('POST', `${BASE}/${path}`, body ?? {});
  must(res.status === 201, `POST ${path} -> HTTP ${res.status} ${res.text.slice(0, 200)}`);
  return res.json;
}

async function remove(path) {
  const res = await api('DELETE', `${BASE}/${path}`);
  must(res.status === 204, `DELETE ${path} -> HTTP ${res.status} ${res.text.slice(0, 160)}`);
}

/** Wait for an item in a list endpoint to report state "running". */
const runningIn = (path, key, name) =>
  until(`${path} "${name}" running`, async () => {
    const res = await api('GET', `${BASE}/${path}`);
    const item = (res.json?.[key] ?? []).find((x) => x.name === name);
    must(item?.state !== 'error', `${path} "${name}" is in error: ${JSON.stringify(item).slice(0, 200)}`);
    return item?.state === 'running' ? item : null;
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

// A shared web container: the gateway, DNS alias and CDN all need an upstream.
const WEB = 'smokeweb';
let webReady = false;
async function ensureWeb() {
  if (webReady) {
    return;
  }
  const list = await api('GET', `${BASE}/tasks`);
  if (!(list.json?.tasks ?? []).some((t) => t.name === WEB)) {
    await create('tasks', { name: WEB, image: 'httpd:2.4.68', port: 80, plan: 'micro' });
  }
  const task = await runningIn('tasks', 'tasks', WEB);
  await edgeOk('container', task.url, '/', { contains: 'It works' });
  webReady = true;
}

const FEATURES = {
  async container() {
    await ensureWeb();
    const logs = await api('GET', `${BASE}/tasks/${WEB}/logs`);
    must(logs.status === 200, `task logs -> HTTP ${logs.status}`);
    return 'httpd container served through its public URL; logs readable';
  },

  async cache() {
    const out = [];
    for (const engine of ['redis-7', 'valkey-8']) {
      const name = `sc-${engine.split('-')[0]}`;
      const made = await create('caches', { name, engine, plan: 'micro' });
      must(made.connectionUri?.startsWith('redis://'), 'cache has no connection URI');
      await runningIn('caches', 'caches', name);
      await remove(`caches/${name}`);
      out.push(engine);
    }
    return `${out.join(', ')} reached running`;
  },

  async database() {
    const out = [];
    for (const engine of ['postgres-16', 'mysql-8', 'mariadb-11']) {
      const name = `sd-${engine.split('-')[0]}`;
      const made = await create('databases', { name, engine, plan: 'micro' });
      must(Boolean(made.connectionUri), 'database has no connection URI');
      await runningIn('databases', 'databases', name);
      const logs = await api('GET', `${BASE}/databases/${name}/logs`);
      must(logs.status === 200 && String(logs.json?.logs ?? '').length > 0, 'database logs are empty');
      await remove(`databases/${name}`);
      out.push(engine);
    }
    return `${out.join(', ')} reached running with logs`;
  },

  async server() {
    const made = await create('vms', { name: 'smokevm', image: 'alpine-3', plan: 'nano' });
    try {
      await until('server running', async () => {
        const res = await api('GET', `${BASE}/vms`);
        const vm = (res.json?.vms ?? []).find((v) => v.id === made.id);
        return vm?.state === 'running' ? vm : null;
      });
      const host = EDGE ? new URL(EDGE).hostname : made.sshHost;
      await until(`SSH port ${made.sshPort} open`, () => tcpOpen(host, made.sshPort));
      return `alpine server running, SSH port ${made.sshPort} accepting connections`;
    } finally {
      await api('POST', `${BASE}/vms/${made.id}/action`, { action: 'terminate' });
    }
  },

  async gateway() {
    await ensureWeb();
    const made = await create('gateways', { name: 'smokegw', routes: [{ path: '/web', target: `task:${WEB}` }] });
    await edgeOk('gateway route', made.url, '/web', { contains: 'It works' });
    await remove('gateways/smokegw');
    return 'route /web proxied to the container';
  },

  async dns() {
    await ensureWeb();
    const made = await create('dns', { record: 'smokewww', type: 'ALIAS', target: WEB });
    await edgeOk('DNS alias', `http://${made.fqdn}`, '/', { contains: 'It works' });
    await remove('dns/smokewww');
    return `${made.fqdn} served the container`;
  },

  async cdn() {
    await ensureWeb();
    const task = await runningIn('tasks', 'tasks', WEB);
    const origin = `http://sm4rt-task-${WS}-${task.name}:80`;
    const made = await create('cdns', { name: 'smokecdn', origin });
    await edgeOk('CDN', made.url, '/', { contains: 'It works', header: 'x-cache' });
    const hit = await until('CDN cache hit', async () => {
      const res = await edgeRequest(made.url, '/');
      return String(res.headers['x-cache'] ?? '').includes('HIT') ? res : null;
    });
    must(hit.status === 200, 'CDN hit was not a 200');
    const purge = await api('POST', `${BASE}/cdns/smokecdn/purge`);
    must(purge.status === 202, `purge -> HTTP ${purge.status}`);
    await remove('cdns/smokecdn');
    return 'origin served, second request was a cache HIT, purge accepted';
  },

  async objectstore() {
    await create('objectstore');
    await until('object store running', async () => (await api('GET', `${BASE}/objectstore`)).json?.state === 'running');
    await until('bucket created', async () => {
      const res = await api('POST', `${BASE}/objectstore/buckets`, { name: 'smoke-bucket' });
      return res.status === 201 || res.status === 409;
    });
    const list = await api('GET', `${BASE}/objectstore/buckets`);
    must((list.json?.buckets ?? []).some((b) => b.name === 'smoke-bucket'), 'bucket missing from the list');
    await remove('objectstore/buckets/smoke-bucket');
    await remove('objectstore');
    return 'S3 store running; bucket created, listed and deleted';
  },

  async tablestore() {
    await create('tablestore');
    await until('table store running', async () => (await api('GET', `${BASE}/tablestore`)).json?.state === 'running');
    await until('table created', async () => {
      const res = await api('POST', `${BASE}/tablestore/tables`, { name: 'smoke_table', hashKey: 'id' });
      return res.status === 201 || res.status === 409;
    });
    const list = await api('GET', `${BASE}/tablestore/tables`);
    must((list.json?.tables ?? []).some((t) => t.name === 'smoke_table'), 'table missing from the list');
    await remove('tablestore/tables/smoke_table');
    await remove('tablestore');
    return 'DynamoDB-compatible store running; table created, listed and deleted';
  },

  async broker() {
    const made = await create('broker');
    await until('broker running', async () => (await api('GET', `${BASE}/broker`)).json?.state === 'running');
    await until('queue created', async () => (await api('POST', `${BASE}/broker/queues`, { name: 'smoke-q' })).status === 201);
    const list = await api('GET', `${BASE}/broker/queues`);
    must((list.json?.queues ?? []).some((q) => q.name === 'smoke-q'), 'queue missing from the list');
    await edgeOk('broker management UI', made.managementUrl, '/', { contains: 'RabbitMQ' });
    await remove('broker/queues/smoke-q');
    await remove('broker');
    return 'RabbitMQ running; queue created and listed; management UI reachable';
  },

  async registry() {
    const made = await create('registry');
    await until('registry running', async () => (await api('GET', `${BASE}/registry`)).json?.state === 'running');
    // /v2/ must demand credentials: 401 means the registry is up and protected
    await edgeOk('registry API', made.url, '/v2/', { want: 401 });
    const repos = await until('repo listing', async () => {
      const res = await api('GET', `${BASE}/registry/repos`);
      return res.status === 200 ? res : null;
    });
    must(Array.isArray(repos.json?.repos), 'repo list is not an array');
    await remove('registry');
    return 'registry running, /v2/ requires auth, repo listing works';
  },

  async function() {
    const made = await create('functions', { name: 'smokefn' });
    const res = await edgeOk('function', made.url, '/', { contains: 'hello' });
    must(res.body.includes('hello'), `unexpected function output: ${res.body.slice(0, 120)}`);
    await remove('functions/smokefn');
    return `invoked over HTTP -> ${res.body.slice(0, 60)}`;
  },

  async observability() {
    const made = await create('observability');
    const health = await edgeOk('Grafana', made.grafanaUrl, '/api/health', { contains: 'database' });
    must(health.body.includes('"database": "ok"'), 'Grafana health is not ok');
    const otlp = await until('OTLP ingest', async () => {
      const res = await edgeRequest(made.otlpUrl, '/v1/logs', {
        method: 'POST',
        body: '{"resourceLogs":[]}',
        headers: { 'content-type': 'application/json' },
      });
      return res.status === 200 ? res : null;
    });
    must(otlp.status === 200, 'OTLP endpoint did not accept logs');
    await remove('observability');
    return 'Grafana healthy; OTLP endpoint accepted a log export';
  },

  async devops() {
    const made = await create('devops');
    const git = await edgeOk('Gitea', made.gitUrl, '/api/v1/version', { contains: 'version' });
    must(git.body.includes('version'), 'Gitea did not report a version');
    await edgeOk('CI server', made.ciUrl, '/healthz', { want: 204 });
    await until('DevOps bootstrapped', async () => {
      const res = await api('GET', `${BASE}/devops`);
      return res.json?.bootstrapped === true && res.json?.state === 'running';
    });
    await remove('devops');
    return 'Gitea and the CI server answered; stack bootstrapped';
  },
};

async function main() {
  const ws = await api('GET', `/api/instances/${WS}`);
  if (ws.status !== 200) {
    console.error(`workspace "${WS}" not reachable: HTTP ${ws.status} ${ws.text.slice(0, 200)}`);
    process.exit(2);
  }
  const selected = Object.keys(FEATURES).filter((k) => (!ONLY || ONLY.includes(k)) && !SKIP.includes(k));
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
  if (webReady) {
    await api('POST', `${BASE}/tasks/${WEB}/action`, { action: 'delete' });
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
