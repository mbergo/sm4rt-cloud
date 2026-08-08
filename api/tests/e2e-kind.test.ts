// End-to-end test: full instance lifecycle through the HTTP API against a REAL
// Kubernetes cluster (kind in CI). Gated behind RUN_KIND=1 because it needs a
// live cluster + kubectl in PATH.
//
// Locally:
//   kind create cluster --name floci-ci
//   RUN_KIND=1 node --test tests/e2e-kind.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const RUN = process.env.RUN_KIND === '1';
const PORT = 18080;
const API = `http://127.0.0.1:${PORT}`;
const TOKEN = 'ci-token';
const NAME = 'ci-e2e';
const FLOCI_IMAGE = process.env.FLOCI_IMAGE ?? 'floci/floci:latest';
const PF_PORT = 14566;

const auth = { authorization: `Bearer ${TOKEN}` };
const children: ChildProcess[] = [];

function spawnChild(cmd: string, args: string[], env?: Record<string, string>): ChildProcess {
  const child = spawn(cmd, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  children.push(child);
  return child;
}

async function waitHttp(url: string, ms: number, init?: RequestInit): Promise<Response> {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
    } catch {
      // retry
    }
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${url}`);
    await sleep(2_000);
  }
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  // only set a JSON content-type when there is a body — Fastify rejects empty JSON bodies
  const headers: Record<string, string> = {
    ...auth,
    ...(init.body ? { 'content-type': 'application/json' } : {}),
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  return fetch(`${API}${path}`, { ...init, headers });
}

test('kind e2e: instance lifecycle via HTTP API', { skip: !RUN, timeout: 25 * 60_000 }, async (t) => {
  t.after(async () => {
    for (const child of children) {
      try {
        child.kill('SIGTERM');
      } catch {
        // already dead
      }
    }
    // best-effort cleanup of namespaces
    spawn('kubectl', ['delete', 'ns', `floci-i-${NAME}`, 'floci-i-ci-reap', '--ignore-not-found', '--wait=false'], {
      stdio: 'ignore',
    });
  });

  // 1. boot the real server against the kind cluster
  spawnChild('node', ['src/server.ts'], {
    PORT: String(PORT),
    FLOCI_CLOUD_TOKEN: TOKEN,
    INSTANCE_DOMAIN: 'ci.local',
    FLOCI_IMAGE,
    INGRESS_CLASS: 'nginx',
    INSTANCE_TLS: 'false',
    GATEWAY_NAME: '',
    GATEWAY_NAMESPACE: '',
    CLERK_SECRET_KEY: '',
  });
  await waitHttp(`${API}/healthz`, 30_000);

  // 2. auth is enforced
  const unauthed = await fetch(`${API}/api/instances`);
  assert.equal(unauthed.status, 401, 'expected 401 without token');

  // 3. create instance
  const createRes = await api('/api/instances', {
    method: 'POST',
    body: JSON.stringify({ name: NAME, ttlHours: 1 }),
  });
  assert.equal(createRes.status, 201, `create failed: ${await createRes.clone().text()}`);

  // 4. wait until the emulator pod is running (real image pull + boot)
  let instance: { status?: string } = {};
  const deadline = Date.now() + 12 * 60_000;
  for (;;) {
    const res = await api(`/api/instances/${NAME}`);
    assert.notEqual(res.status, 404, 'instance vanished while provisioning');
    instance = (await res.json()) as { status?: string };
    if (instance.status === 'running') break;
    if (Date.now() > deadline) {
      assert.fail(`instance never reached running: ${JSON.stringify(instance)}`);
    }
    await sleep(5_000);
  }

  // 5. port-forward to the emulator service and do a REAL S3 roundtrip
  spawnChild('kubectl', ['port-forward', '-n', `floci-i-${NAME}`, 'svc/floci', `${PF_PORT}:4566`]);
  await waitHttp(`http://127.0.0.1:${PF_PORT}/_floci/health`, 60_000);

  const { ResourceGateway } = await import('../src/resources.ts');
  const gateway = new ResourceGateway(`http://127.0.0.1:${PF_PORT}`);
  const bucket = `ci-e2e-${Date.now().toString(36)}`;
  await gateway.create('s3', { name: bucket });
  const buckets = await gateway.list('s3');
  assert.ok(buckets.some((b) => b.name === bucket), 's3 bucket not listed inside kind instance');
  await gateway.remove('s3', bucket);

  // 6. instance logs flow through
  const logsRes = await api(`/api/instances/${NAME}/logs`);
  assert.equal(logsRes.status, 200);

  // 7. start a real catalog service (httpd), wait for running, stop it
  const startRes = await api(`/api/instances/${NAME}/services/httpd/start`, { method: 'POST' });
  assert.ok(startRes.status < 300, `httpd start failed: ${await startRes.clone().text()}`);
  const svcDeadline = Date.now() + 6 * 60_000;
  for (;;) {
    const res = await api(`/api/instances/${NAME}/services`);
    const body = (await res.json()) as { services?: Array<{ id: string; status: string }> };
    const httpd = body.services?.find((s) => s.id === 'httpd');
    if (httpd?.status === 'running') break;
    if (Date.now() > svcDeadline) {
      assert.fail(`httpd never reached running: ${JSON.stringify(httpd)}`);
    }
    await sleep(5_000);
  }
  const stopRes = await api(`/api/instances/${NAME}/services/httpd/stop`, { method: 'POST' });
  assert.ok(stopRes.status < 300, 'httpd stop failed');

  // 8. delete instance, confirm 404
  const delRes = await api(`/api/instances/${NAME}`, { method: 'DELETE' });
  assert.equal(delRes.status, 204);
  const goneDeadline = Date.now() + 3 * 60_000;
  for (;;) {
    const res = await api(`/api/instances/${NAME}`);
    if (res.status === 404) break;
    if (Date.now() > goneDeadline) assert.fail('instance still present after delete');
    await sleep(5_000);
  }
});

test('kind e2e: TTL reaper removes expired instances', { skip: !RUN, timeout: 5 * 60_000 }, async () => {
  const { Provisioner } = await import('../src/k8s.ts');
  const prov = new Provisioner({
    instanceDomain: 'ci.local',
    flociImage: FLOCI_IMAGE,
    ingressClass: 'nginx',
    tls: false,
    clusterIssuer: 'unused',
  });
  await prov.create('ci-reap', 0.0005); // ~1.8s TTL
  await sleep(4_000);
  const reaped = await prov.reapExpired();
  assert.ok(reaped.includes('ci-reap'), `reaper missed ci-reap (got: ${reaped.join(',')})`);
  const deadline = Date.now() + 2 * 60_000;
  for (;;) {
    const inst = await prov.get('ci-reap');
    if (!inst) break;
    if (Date.now() > deadline) assert.fail('reaped namespace still present');
    await sleep(5_000);
  }
});
