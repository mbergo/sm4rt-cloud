#!/usr/bin/env node
// Catalog smoke test: deploys every catalog service through the control-plane
// API and proves it actually works, the way a person using the console would
// see it. For each service it checks:
//
//   1. deploy   - POST .../start, then the API reports the service `running`
//   2. function - the service answers a real request (HTTP through the edge
//                 proxy on its public hostname, or a protocol command run with
//                 the console's exec API)
//   3. panel    - what the console's centre panel renders: endpoints, the
//                 config view, logs, and the exec terminal
//   4. stop     - POST .../stop removes it again
//
// It only talks to the API and the edge, so it runs against a laptop swarm and
// against a real install alike:
//
//   node e2e/smoke/catalog-smoke.mjs --api https://cloud.example.com \
//        --token "$FLOCI_CLOUD_TOKEN" --workspace smoke
//
// Local swarm without DNS: add --edge http://127.0.0.1 so requests go to the
// local edge with the public hostname in the Host header.
//
// Exit code 0 only when every selected service passes every check.

import http from 'node:http';
import https from 'node:https';
import { writeFileSync } from 'node:fs';

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
const KEEP = args.keep === 'true';
const EXTRA_WAIT = Number(args['pull-seconds'] ?? 900);
const REPORT = args.report ?? null;

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
    signal: AbortSignal.timeout(60_000),
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

/** HTTP request to a service's public URL, optionally pinned to a local edge. */
function edgeRequest(publicUrl, path, opts = {}) {
  const target = new URL(path, publicUrl);
  const viaEdge = EDGE ? new URL(EDGE) : null;
  const lib = (viaEdge ?? target).protocol === 'https:' ? https : http;
  const headers = { host: target.host, ...(opts.headers ?? {}) };
  if (opts.auth) {
    headers.authorization = `Basic ${Buffer.from(opts.auth).toString('base64')}`;
  }
  if (opts.body !== undefined) {
    headers['content-length'] = Buffer.byteLength(opts.body);
  }
  return new Promise((resolve) => {
    const req = lib.request(
      {
        hostname: (viaEdge ?? target).hostname,
        port: (viaEdge ?? target).port || ((viaEdge ?? target).protocol === 'https:' ? 443 : 80),
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
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
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

const fail = (why) => ({ ok: false, why });
const pass = (detail) => ({ ok: true, detail });

/** GET a path and require a status (and optionally a body substring). */
// Always pass `contains`: the edge answers 200 with an empty body for a
// hostname it has no route for yet, so a bare status proves nothing.
const httpCheck =
  (path, { expect = 200, contains, auth, headers } = {}) =>
  async (ctx) => {
    const res = await ctx.edge(path, { auth, headers });
    if (res.status !== expect) {
      return fail(`GET ${path} -> ${res.status || res.error} (want ${expect})`);
    }
    if (contains && !res.body.includes(contains)) {
      return fail(`GET ${path} -> ${res.status} but body lacks "${contains}"`);
    }
    return pass(`GET ${path} -> ${res.status}`);
  };

/** Run a command inside the service with the console's exec API. */
const execCheck =
  (cmd, { contains, target } = {}) =>
  async (ctx) => {
    const res = await ctx.exec(cmd, target);
    if (res.status !== 200) {
      return fail(`exec -> HTTP ${res.status} ${res.text.slice(0, 160)}`);
    }
    const out = String(res.json?.output ?? '');
    if (res.json?.exitCode !== 0) {
      return fail(`exec exit ${res.json?.exitCode}: ${out.trim().slice(-200)}`);
    }
    if (contains && !out.includes(contains)) {
      return fail(`exec output lacks "${contains}": ${out.trim().slice(-200)}`);
    }
    return pass(`exec ok${contains ? ` (${contains})` : ''}`);
  };

const all =
  (...checks) =>
  async (ctx) => {
    const details = [];
    for (const check of checks) {
      const r = await check(ctx);
      if (!r.ok) {
        return r;
      }
      details.push(r.detail);
    }
    return pass(details.join('; '));
  };

// What "it works" means for each service. Kept next to the catalog ids on
// purpose: a new catalog entry without a check here fails the run.
const CHECKS = {
  kafka: all(
    execCheck(
      ['/opt/kafka/bin/kafka-topics.sh', '--bootstrap-server', 'localhost:9092', '--create', '--if-not-exists', '--topic', 'smoke'],
    ),
    execCheck(['/opt/kafka/bin/kafka-topics.sh', '--bootstrap-server', 'localhost:9092', '--list'], {
      contains: 'smoke',
    }),
    httpCheck('/api/clusters', { contains: '"status":"online"' }),
  ),
  cassandra: all(
    execCheck(['cqlsh', '-e', 'SELECT release_version FROM system.local'], { contains: 'release_version' }),
    httpCheck('/', { contains: 'Cassandra-Web' }),
  ),
  activemq: httpCheck('/admin/', { auth: 'admin:admin', contains: 'ActiveMQ' }),
  // The S3 gateway only accepts SigV4-signed requests, so an anonymous GET is
  // answered with an S3 error document: that proves the gateway is reachable
  // through the edge. The bucket round trip runs inside the container.
  ozone: all(
    // two execs on purpose: each `ozone sh` starts a JVM, and both together
    // can run past the exec API's 30s limit on a busy node
    execCheck([
      'bash',
      '-c',
      'OZONE_CONF_DIR=/tmp/ozone-conf ozone sh bucket create /s3v/smoke-bkt >/dev/null 2>&1 || true',
    ]),
    execCheck(['bash', '-c', 'OZONE_CONF_DIR=/tmp/ozone-conf ozone sh bucket list /s3v 2>/dev/null'], {
      contains: 'smoke-bkt',
    }),
    httpCheck('/', { expect: 403, contains: '<Code>InvalidRequest</Code>' }),
  ),
  pulsar: httpCheck('/admin/v2/clusters', { contains: 'standalone' }),
  zookeeper: all(
    execCheck(['zkServer.sh', 'status'], { contains: 'Mode: standalone' }),
    httpCheck('/', { contains: 'ZooNavigator' }),
  ),
  couchdb: all(httpCheck('/_up', { contains: 'ok' }), httpCheck('/_all_dbs', { auth: 'admin:floci', contains: '[' })),
  flink: async (ctx) => {
    const res = await ctx.edge('/overview');
    if (res.status !== 200) {
      return fail(`GET /overview -> ${res.status || res.error}`);
    }
    const tms = Number(JSON.parse(res.body).taskmanagers ?? 0);
    return tms >= 1 ? pass(`jobmanager up, ${tms} taskmanager`) : fail('no taskmanager registered');
  },
  solr: httpCheck('/solr/admin/info/system?wt=json', { contains: 'solr-spec-version' }),
  nifi: httpCheck('/nifi-api/flow/about', { contains: 'NiFi' }),
  tomcat: httpCheck('/', { contains: 'Apache Tomcat' }),
  httpd: httpCheck('/', { contains: 'It works' }),
  ollama: httpCheck('/api/version', { contains: 'version' }),
  jupyter: httpCheck('/api/status?token=floci', { contains: 'started' }),
  mlflow: all(httpCheck('/health', { contains: 'OK' }), httpCheck('/api/2.0/mlflow/experiments/search?max_results=1', { contains: 'experiments' })),
  iceberg: httpCheck('/v1/config', { contains: 'defaults' }),
  trino: async (ctx) => {
    const info = await ctx.edge('/v1/info');
    if (info.status !== 200) {
      return fail(`GET /v1/info -> ${info.status || info.error}`);
    }
    if (JSON.parse(info.body).starting !== false) {
      return fail('trino still starting');
    }
    let res = await ctx.edge('/v1/statement', {
      method: 'POST',
      body: 'SELECT 42',
      headers: { 'x-trino-user': 'smoke' },
    });
    for (let i = 0; i < 40 && res.status === 200; i++) {
      const doc = JSON.parse(res.body);
      if (doc.error) {
        return fail(`query error: ${doc.error.message}`);
      }
      if (doc.data) {
        return String(doc.data[0][0]) === '42' ? pass('SELECT 42 -> 42') : fail('wrong query result');
      }
      if (!doc.nextUri) {
        return fail('query ended without data');
      }
      await sleep(500);
      const next = new URL(doc.nextUri);
      res = await ctx.edge(next.pathname + next.search, { headers: { 'x-trino-user': 'smoke' } });
    }
    return fail(`query did not finish (HTTP ${res.status || res.error})`);
  },
  airflow: httpCheck('/api/v2/monitor/health', { contains: 'healthy' }),
  spark: async (ctx) => {
    const res = await ctx.edge('/json/');
    if (res.status !== 200) {
      return fail(`GET /json/ -> ${res.status || res.error}`);
    }
    const alive = Number(JSON.parse(res.body).aliveworkers ?? 0);
    return alive >= 1 ? pass(`master up, ${alive} worker alive`) : fail('no worker registered with the master');
  },
  atlas: httpCheck('/api/atlas/admin/version', { auth: 'admin:admin', contains: 'Version' }),
  polaris: async (ctx) => {
    const res = await ctx.edge('/api/catalog/v1/oauth/tokens', {
      method: 'POST',
      body: 'grant_type=client_credentials&client_id=root&client_secret=secret&scope=PRINCIPAL_ROLE:ALL',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'polaris-realm': 'POLARIS' },
    });
    return res.status === 200 && res.body.includes('access_token')
      ? pass('OAuth token issued for root')
      : fail(`token request -> ${res.status || res.error} ${res.body.slice(0, 120)}`);
  },
  lgtm: async (ctx) => {
    const res = await ctx.edge('/api/health');
    let db = null;
    try {
      db = JSON.parse(res.body).database;
    } catch {
      // not JSON
    }
    return res.status === 200 && db === 'ok'
      ? pass('Grafana health: database ok')
      : fail(`GET /api/health -> ${res.status || res.error}, database=${db}`);
  },
};

async function testService(svc) {
  const id = svc.id;
  const result = { id, label: svc.label, image: svc.image, deploy: null, function: null, panel: null, stop: null };
  const started = Date.now();
  const check = CHECKS[id];
  if (!check) {
    result.deploy = fail('no smoke check defined for this catalog id');
    return result;
  }

  // Never take over a service someone already runs in this workspace: the
  // run would stop it at the end.
  if (svc.status !== 'stopped') {
    result.deploy = fail(`already ${svc.status} in workspace "${WS}" - stop it or use another workspace`);
    return result;
  }

  // From here on this run owns the service: stop it however the run ends,
  // including a start that fails half way (main service created, a sidecar
  // not) or throws.
  try {
    // 1. deploy
    const start = await api('POST', `/api/instances/${WS}/services/${id}/start`);
    if (start.status >= 300) {
      result.deploy = fail(`start -> HTTP ${start.status} ${start.text.slice(0, 200)}`);
      return result;
    }
    await checkService(svc, result, started, check);
  } finally {
    result.stop = KEEP ? pass('kept (--keep)') : await stopService(id);
  }
  return result;
}

async function stopService(id) {
  const stop = await api('POST', `/api/instances/${WS}/services/${id}/stop`).catch((err) => ({
    status: 0,
    text: err.message,
  }));
  let gone = false;
  for (let i = 0; i < 24 && !gone; i++) {
    await sleep(2500);
    const list = await api('GET', `/api/instances/${WS}/services`).catch(() => null);
    gone = list?.json?.services?.find((s) => s.id === id)?.status === 'stopped';
  }
  return stop.status < 300 && gone ? pass('stopped') : fail(`stop -> HTTP ${stop.status}, still listed`);
}

async function checkService(svc, result, started, check) {
  const id = svc.id;
  const deadline = Date.now() + (svc.startupSeconds ?? 300) * 1000 + EXTRA_WAIT * 1000;
  let info = null;
  let lastState = '';
  while (Date.now() < deadline) {
    const list = await api('GET', `/api/instances/${WS}/services`);
    info = list.json?.services?.find((s) => s.id === id) ?? null;
    const state = `${info?.status}${info?.statusDetail ? ` (${info.statusDetail})` : ''}`;
    if (state !== lastState) {
      log(`  ${id}: ${state}`);
      lastState = state;
    }
    if (info?.status === 'running') {
      break;
    }
    await sleep(5000);
  }
  if (info?.status !== 'running') {
    result.deploy = fail(`never reached running: ${lastState}`);
    return;
  }
  result.deploy = pass(`running after ${Math.round((Date.now() - started) / 1000)}s`);

  const publicUrl =
    info.instances?.find((i) => i.name === null)?.externalUrl ??
    info.endpoints?.map((e) => e.value).find((v) => /^https?:\/\//.test(v) && !v.includes('svc-')) ??
    null;
  const ctx = {
    edge: (path, opts) =>
      publicUrl ? edgeRequest(publicUrl, path, opts) : Promise.resolve({ status: 0, body: '', error: 'no public url' }),
    exec: (cmd, target) => api('POST', `/api/instances/${WS}/exec`, { service: target ?? id, cmd }),
  };

  // 2. function - "running" only means the container started, so keep asking
  // until the service really answers or its startup budget runs out.
  let fn = fail('not attempted');
  while (Date.now() < deadline) {
    try {
      fn = await check(ctx);
    } catch (err) {
      fn = fail(`check threw: ${err.message}`);
    }
    if (fn.ok) {
      break;
    }
    await sleep(5000);
  }
  result.function = fn.ok ? pass(`${fn.detail} [${Math.round((Date.now() - started) / 1000)}s]`) : fn;

  // 3. panel - what the console's centre panel shows for a running service
  const panel = [];
  const problems = [];
  if ((info.endpoints ?? []).length > 0) {
    panel.push(`${info.endpoints.length} endpoints`);
  } else {
    problems.push('no endpoints');
  }
  const logs = await api('GET', `/api/instances/${WS}/services/${id}/logs?tail=50`);
  if (logs.status === 200 && String(logs.json?.logs ?? '').trim().length > 0) {
    panel.push('logs');
  } else {
    problems.push(`logs -> HTTP ${logs.status}, ${String(logs.json?.logs ?? '').length} bytes`);
  }
  const config = await api('GET', `/api/instances/${WS}/services/${id}/config`);
  if (config.status === 200) {
    panel.push('config');
  } else {
    problems.push(`config -> HTTP ${config.status}`);
  }
  const targets = await api('GET', `/api/instances/${WS}/targets`);
  if (targets.status === 200 && JSON.stringify(targets.json).includes(`svc-${id}`)) {
    panel.push('listed as a target');
  } else {
    problems.push(`targets -> HTTP ${targets.status}, service missing`);
  }
  const term = await ctx.exec(['sh', '-c', 'echo smoke-terminal-ok']);
  if (term.status === 200 && String(term.json?.output ?? '').includes('smoke-terminal-ok')) {
    panel.push('terminal');
  } else {
    problems.push(`terminal -> HTTP ${term.status} ${term.text.slice(0, 120)}`);
  }
  result.panel = problems.length === 0 ? pass(panel.join(', ')) : fail(problems.join('; '));

  if (!fn.ok) {
    const tail = await api('GET', `/api/instances/${WS}/services/${id}/logs?tail=30`);
    result.logTail = String(tail.json?.logs ?? '').split('\n').slice(-30).join('\n');
  }

}

async function main() {
  const ws = await api('GET', `/api/instances/${WS}`);
  if (ws.status !== 200) {
    console.error(`workspace "${WS}" not reachable: HTTP ${ws.status} ${ws.text.slice(0, 200)}`);
    process.exit(2);
  }
  const list = await api('GET', `/api/instances/${WS}/services`);
  const catalog = list.json?.services;
  if (list.status !== 200 || !Array.isArray(catalog) || catalog.length === 0) {
    console.error(`could not read the service catalog: HTTP ${list.status} ${list.text.slice(0, 200)}`);
    process.exit(2);
  }
  const known = new Set(catalog.map((s) => s.id));
  const unknown = [...(ONLY ?? []), ...SKIP].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    console.error(`unknown catalog ids: ${unknown.join(', ')} (known: ${[...known].join(', ')})`);
    process.exit(2);
  }
  const missing = catalog.map((s) => s.id).filter((id) => !CHECKS[id]);
  const selected = catalog.filter((s) => (!ONLY || ONLY.includes(s.id)) && !SKIP.includes(s.id));
  if (selected.length === 0) {
    console.error('the selection matches no catalog service');
    process.exit(2);
  }
  log(`catalog has ${catalog.length} services; testing ${selected.length}`);

  const results = [];
  for (const svc of selected) {
    log(`▶ ${svc.id} (${svc.image})`);
    let r;
    try {
      r = await testService(svc);
    } catch (err) {
      r = { id: svc.id, deploy: fail(`harness error: ${err.message}`) };
    }
    results.push(r);
    const cell = (c) => (c ? (c.ok ? 'PASS' : 'FAIL') : '-');
    log(
      `  ${svc.id}: deploy=${cell(r.deploy)} function=${cell(r.function)} panel=${cell(r.panel)} stop=${cell(r.stop)}`,
    );
    for (const key of ['deploy', 'function', 'panel', 'stop']) {
      if (r[key] && !r[key].ok) {
        log(`    ${key}: ${r[key].why}`);
      }
    }
    if (REPORT) {
      writeFileSync(REPORT, JSON.stringify({ api: API, workspace: WS, results }, null, 2));
    }
  }

  const ok = (r) => ['deploy', 'function', 'panel', 'stop'].every((k) => r[k]?.ok);
  const failed = results.filter((r) => !ok(r));
  console.log('\nservice      deploy  function  panel  stop');
  for (const r of results) {
    const cell = (c) => (c ? (c.ok ? 'pass' : 'FAIL') : '-').padEnd(8);
    console.log(`${r.id.padEnd(12)} ${cell(r.deploy)}${cell(r.function)}  ${cell(r.panel)}${cell(r.stop)}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} services passed every check`);
  if (missing.length > 0) {
    console.log(`catalog ids with no smoke check: ${missing.join(', ')}`);
  }
  process.exit(failed.length === 0 && missing.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
