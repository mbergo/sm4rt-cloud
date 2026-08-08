// Integration tests: ResourceGateway + API Explorer against a REAL floci emulator.
// Requires a running emulator (default http://127.0.0.1:4566):
//   docker run -d -p 4566:4566 floci/floci:latest
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { ResourceGateway, type ServiceId } from '../src/resources.ts';
import { explore } from '../src/explorer.ts';

const ENDPOINT = process.env.FLOCI_ENDPOINT ?? 'http://127.0.0.1:4566';
const gw = new ResourceGateway(ENDPOINT);
const run = Date.now().toString(36);

async function eventually<T>(fn: () => Promise<T>, check: (v: T) => boolean, ms = 30_000): Promise<T> {
  const deadline = Date.now() + ms;
  let last: T;
  for (;;) {
    last = await fn();
    if (check(last)) return last;
    if (Date.now() > deadline) return last;
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

before(async () => {
  const deadline = Date.now() + 180_000;
  for (;;) {
    try {
      const res = await fetch(`${ENDPOINT}/_floci/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`floci emulator not healthy at ${ENDPOINT}`);
    await new Promise((r) => setTimeout(r, 2_000));
  }
});

interface Lifecycle {
  service: ServiceId;
  name: string;
  value?: string;
  /** some deletions are async on AWS (kms schedules, kinesis DELETING) — skip the gone assertion */
  skipGoneCheck?: boolean;
}

const cases: Lifecycle[] = [
  { service: 's3', name: `ci-bucket-${run}` },
  { service: 'sqs', name: `ci-queue-${run}` },
  { service: 'sns', name: `ci-topic-${run}` },
  { service: 'dynamodb', name: `ci-table-${run}` },
  { service: 'iam', name: `ci-user-${run}`, value: 'user' },
  { service: 'ssm', name: `/ci/param-${run}`, value: 'hello' },
  { service: 'secrets', name: `ci-secret-${run}`, value: 's3cr3t' },
  { service: 'logs', name: `/ci/logs-${run}` },
  { service: 'events', name: `ci-rule-${run}`, value: 'rate(5 minutes)' },
  { service: 'states', name: `ci-sfn-${run}` },
  { service: 'kinesis', name: `ci-stream-${run}`, skipGoneCheck: true },
  { service: 'kms', name: `ci-key-${run}`, skipGoneCheck: true },
];

for (const c of cases) {
  test(`${c.service}: create → list → remove`, async () => {
    const created = await gw.create(c.service, { name: c.name, value: c.value });
    assert.ok(created.id, `${c.service} create returned no id`);

    const listed = await eventually(
      () => gw.list(c.service),
      (items) => items.some((r) => r.id === created.id || r.name === c.name),
    );
    assert.ok(
      listed.some((r) => r.id === created.id || r.name === c.name),
      `${c.service} list missing ${created.id}`,
    );

    await gw.remove(c.service, created.id);

    if (!c.skipGoneCheck) {
      const after = await eventually(
        () => gw.list(c.service),
        (items) => !items.some((r) => r.id === created.id),
      );
      assert.ok(!after.some((r) => r.id === created.id), `${c.service} ${created.id} still listed after remove`);
    }
  });
}

test('lambda: create function → list → remove', async () => {
  const name = `ci-fn-${run}`;
  const created = await gw.create('lambda', {
    name,
    runtime: 'nodejs20.x',
    handler: 'index.handler',
    code: 'export const handler = async () => ({ ok: true });',
  });
  assert.equal(created.id, name);
  const listed = await eventually(
    () => gw.list('lambda'),
    (items) => items.some((r) => r.id === name),
  );
  assert.ok(listed.some((r) => r.id === name), 'lambda not listed');
  await gw.remove('lambda', name);
});

test('explorer: sts GetCallerIdentity (Query protocol)', async () => {
  const res = await explore(ENDPOINT, { service: 'sts', operation: 'GetCallerIdentity' });
  assert.equal(res.status, 200);
  assert.match(res.body, /GetCallerIdentityResult|Arn/);
});

test('explorer: s3 REST_XML list buckets', async () => {
  const res = await explore(ENDPOINT, { service: 's3', operation: 'GET /' });
  assert.equal(res.status, 200);
  assert.match(res.body, /ListAllMyBucketsResult/);
});

test('explorer: dynamodb JSON protocol ListTables', async () => {
  const res = await explore(ENDPOINT, { service: 'dynamodb', operation: 'ListTables', body: '{}' });
  assert.equal(res.status, 200);
  assert.match(res.body, /TableNames/);
});
