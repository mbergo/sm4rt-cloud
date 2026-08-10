// Pure unit tests for the real-service catalog (no network, no emulator).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REAL_SERVICES,
  SERVICE_CATALOG,
  SERVICE_CATEGORIES,
  isRealServiceId,
} from '../src/services.ts';

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
