// Pure unit tests for the real-service catalog (no network, no emulator).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INSTANCE_NAME_RE,
  REAL_SERVICES,
  SERVICE_CATALOG,
  SERVICE_CATEGORIES,
  isRealServiceId,
} from '../src/services.ts';
import { createLogDemuxer, agentTaskAddress } from '../src/swarm.ts';

test('catalog covers every REAL_SERVICES id with a consistent spec', () => {
  for (const id of REAL_SERVICES) {
    const spec = SERVICE_CATALOG[id];
    assert.ok(spec, `missing spec for ${id}`);
    assert.equal(spec.id, id);
    assert.ok(spec.label.length > 0, `${id} label`);
    assert.ok(spec.image.includes(':'), `${id} image must be tagged: ${spec.image}`);
    assert.ok(SERVICE_CATEGORIES.includes(spec.category), `${id} category ${spec.category}`);
    assert.ok(spec.ports.length > 0, `${id} needs at least one port`);
    assert.ok(
      spec.ports.some((p) => p.port === spec.probePort),
      `${id} probePort ${spec.probePort} must be a declared port`,
    );
    if (spec.httpIngressPort !== undefined) {
      assert.ok(
        spec.ports.some((p) => p.port === spec.httpIngressPort),
        `${id} httpIngressPort ${spec.httpIngressPort} must be a declared port`,
      );
    }
  }
});

test('data engineering services are registered', () => {
  for (const id of ['kafka', 'nifi', 'flink', 'ozone', 'iceberg', 'polaris', 'atlas', 'spark', 'airflow', 'trino']) {
    assert.ok(isRealServiceId(id), `${id} should be a real service`);
  }
  assert.equal(isRealServiceId('griffin'), false, 'griffin is roadmap-only');
});

test('spark spec: master + worker sidecar wiring', () => {
  const spark = SERVICE_CATALOG.spark;
  assert.deepEqual(spark.ports.map((p) => p.port).sort(), [7077, 8080]);
  assert.ok(spark.command?.join(' ').includes('deploy.master.Master'), 'main runs the Master');
  const env = spark.env({ serviceHost: 'spark', externalHost: 'spark.example.com' });
  assert.ok(env.some((e) => e.name === 'SPARK_MASTER_HOST' && e.value === 'localhost'));
  assert.equal(spark.sidecars?.length, 1);
  const worker = spark.sidecars![0];
  assert.equal(worker.name, 'worker');
  // swarm fixHost only rewrites sidecar env (not command), so the master URL
  // must reach the command via shell expansion of $SPARK_MASTER_URL.
  assert.ok(worker.command?.some((c) => c.includes('$SPARK_MASTER_URL')));
  assert.ok(worker.env?.some((e) => e.name === 'SPARK_MASTER_URL' && e.value === 'spark://localhost:7077'));
});

test('atlas spec: single http port + persistent data volume', () => {
  const atlas = SERVICE_CATALOG.atlas;
  assert.deepEqual(atlas.ports.map((p) => p.port), [21000]);
  assert.equal(atlas.httpIngressPort, 21000);
  assert.ok(atlas.volumes?.some((v) => v.mountPath === '/apache-atlas/data'));
  assert.ok(atlas.startupSeconds >= 300, 'atlas needs a long startup window');
});

test('polaris spec: catalog + management ports and bootstrap credentials', () => {
  const polaris = SERVICE_CATALOG.polaris;
  assert.deepEqual(polaris.ports.map((p) => p.port).sort(), [8181, 8182]);
  assert.equal(polaris.httpIngressPort, 8181);
  const env = polaris.env({ serviceHost: 'polaris', externalHost: 'polaris.example.com' });
  assert.ok(env.some((e) => e.name === 'POLARIS_BOOTSTRAP_CREDENTIALS' && e.value === 'POLARIS,root,secret'));
  assert.ok(env.some((e) => e.name === 'POLARIS_REALM_CONTEXT_REALMS' && e.value === 'POLARIS'));
});

test('endpoints render with and without an external url', () => {
  for (const id of ['spark', 'atlas', 'polaris'] as const) {
    const spec = SERVICE_CATALOG[id];
    const base = spec.endpoints({ serviceHost: `${id}-host`, externalUrl: null });
    const pub = spec.endpoints({ serviceHost: `${id}-host`, externalUrl: 'https://x.example.com' });
    assert.ok(base.length > 0);
    assert.ok(pub.length > base.length, `${id} should add a public endpoint`);
    for (const e of [...base, ...pub]) {
      assert.ok(e.label.length > 0 && e.value.length > 0, `${id} endpoint fields`);
    }
  }
});

test('INSTANCE_NAME_RE accepts short kebab names and rejects bad input', () => {
  for (const ok of ['a', 'blue', 'replica-2', 'a1-b2', 'x'.repeat(21)]) {
    assert.ok(INSTANCE_NAME_RE.test(ok), `should accept ${ok}`);
  }
  for (const bad of ['', '-lead', 'UPPER', 'has space', 'dot.name', 'x'.repeat(22), 'ünïcode']) {
    assert.ok(!INSTANCE_NAME_RE.test(bad), `should reject ${bad}`);
  }
});

test('createLogDemuxer reassembles multiplexed frames split across chunks', () => {
  const frame = (stream: number, text: string) => {
    const payload = Buffer.from(text, 'utf8');
    const head = Buffer.alloc(8);
    head[0] = stream;
    head.writeUInt32BE(payload.length, 4);
    return Buffer.concat([head, payload]);
  };
  const whole = Buffer.concat([frame(1, 'hello '), frame(2, 'world'), frame(1, '!\n')]);
  // Split at awkward byte boundaries (inside headers and payloads).
  for (const cut of [1, 3, 9, 13]) {
    const demux = createLogDemuxer();
    let out = '';
    out += demux.push(whole.subarray(0, cut));
    out += demux.push(whole.subarray(cut));
    assert.equal(out, 'hello world!\n', `cut at ${cut}`);
  }
});

test('createLogDemuxer passes raw TTY streams through unchanged', () => {
  const demux = createLogDemuxer();
  let out = '';
  out += demux.push(Buffer.from('plain tty '));
  out += demux.push(Buffer.from('output\n'));
  assert.equal(out, 'plain tty output\n');
});

test('agentTaskAddress picks the running agent task on the right node and strips CIDR', () => {
  const tasks = [
    {
      NodeID: 'node-a',
      Status: { State: 'running' },
      NetworksAttachments: [
        { Network: { Spec: { Name: 'other-net' } }, Addresses: ['10.9.9.9/24'] },
        { Network: { Spec: { Name: 'floci-net' } }, Addresses: ['10.0.1.5/24'] },
      ],
    },
    {
      NodeID: 'node-b',
      Status: { State: 'running' },
      NetworksAttachments: [
        { Network: { Spec: { Name: 'floci-net' } }, Addresses: ['10.0.1.7/24'] },
      ],
    },
    // failed task on node-b must be ignored
    {
      NodeID: 'node-b',
      Status: { State: 'failed' },
      NetworksAttachments: [
        { Network: { Spec: { Name: 'floci-net' } }, Addresses: ['10.0.1.99/24'] },
      ],
    },
  ];
  assert.equal(agentTaskAddress(tasks, 'node-a', 'floci-net'), '10.0.1.5');
  assert.equal(agentTaskAddress(tasks, 'node-b', 'floci-net'), '10.0.1.7');
  assert.equal(agentTaskAddress(tasks, 'node-c', 'floci-net'), null);
  assert.equal(agentTaskAddress([], 'node-a', 'floci-net'), null);
  // task without addresses yields null rather than empty string
  assert.equal(
    agentTaskAddress(
      [{ NodeID: 'x', Status: { State: 'running' }, NetworksAttachments: [] }],
      'x',
      'floci-net',
    ),
    null,
  );
});
