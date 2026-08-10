import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validDomain, normalizeDomain, dnsInstructions, verifyDomain } from '../src/domains.ts';
import type { DnsResolver } from '../src/domains.ts';
import { Store } from '../src/db.ts';
import type { DomainRow } from '../src/db.ts';
import { ComputeManager } from '../src/compute.ts';

// — domain validation —

test('validDomain accepts real domains', () => {
  assert.equal(validDomain('example.com'), true);
  assert.equal(validDomain('sub.example.co.uk'), true);
  assert.equal(validDomain('my-app.io'), true);
});

test('validDomain rejects garbage', () => {
  assert.equal(validDomain(''), false);
  assert.equal(validDomain('nodot'), false);
  assert.equal(validDomain('http://example.com'), false);
  assert.equal(validDomain('EXAMPLE.COM'), false);
  assert.equal(validDomain('-bad.com'), false);
  assert.equal(validDomain('bad-.com'), false);
  assert.equal(validDomain('exa mple.com'), false);
});

test('normalizeDomain trims, lowercases, strips trailing dot', () => {
  assert.equal(normalizeDomain('  Example.COM. '), 'example.com');
});

// — instructions —

const row = (over: Partial<DomainRow> = {}): DomainRow => ({
  domain: 'client.dev',
  workspace: 'acme',
  verifyToken: 'tok-123',
  status: 'pending',
  createdAt: new Date().toISOString(),
  verifiedAt: null,
  ...over,
});

test('dnsInstructions lists TXT + wildcard record', () => {
  const withIp = dnsInstructions(row(), { ip: '203.0.113.9' });
  assert.equal(withIp.length, 2);
  assert.deepEqual(withIp[0], {
    type: 'TXT',
    name: '_sm4rt-verify.client.dev',
    value: 'tok-123',
    purpose: 'ownership verification',
  });
  assert.equal(withIp[1].type, 'A');
  assert.equal(withIp[1].name, '*.client.dev');
  assert.equal(withIp[1].value, '203.0.113.9');

  const withCname = dnsInstructions(row(), { cname: 'edge.platform.io' });
  assert.equal(withCname[1].type, 'CNAME');
  assert.equal(withCname[1].value, 'edge.platform.io');
});

// — verification (mock resolver, no network) —

function resolver(tables: {
  txt?: Record<string, string[][]>;
  a?: Record<string, string[]>;
  cname?: Record<string, string[]>;
}): DnsResolver {
  const fail = (kind: string, host: string) => {
    throw Object.assign(new Error(`ENOTFOUND ${host}`), { code: 'ENOTFOUND', kind });
  };
  return {
    resolveTxt: async (h) => tables.txt?.[h] ?? fail('txt', h),
    resolve4: async (h) => tables.a?.[h] ?? fail('a', h),
    resolveCname: async (h) => tables.cname?.[h] ?? fail('cname', h),
  };
}

test('verifyDomain fails without TXT record', async () => {
  const res = await verifyDomain(row(), { ip: '203.0.113.9' }, resolver({}));
  assert.equal(res.ok, false);
  assert.equal(res.txt, false);
  assert.match(res.detail, /TXT _sm4rt-verify\.client\.dev/);
});

test('verifyDomain fails when token mismatches', async () => {
  const res = await verifyDomain(
    row(),
    { ip: '203.0.113.9' },
    resolver({ txt: { '_sm4rt-verify.client.dev': [['wrong-token']] } }),
  );
  assert.equal(res.ok, false);
  assert.equal(res.txt, false);
});

test('verifyDomain fails when wildcard is missing (ownership ok)', async () => {
  const res = await verifyDomain(
    row(),
    { ip: '203.0.113.9' },
    resolver({ txt: { '_sm4rt-verify.client.dev': [['tok-123']] } }),
  );
  assert.equal(res.ok, false);
  assert.equal(res.txt, true);
  assert.equal(res.routing, false);
  assert.match(res.detail, /wildcard/);
});

test('verifyDomain fails when wildcard points elsewhere', async () => {
  const res = await verifyDomain(
    row(),
    { ip: '203.0.113.9' },
    resolver({
      txt: { '_sm4rt-verify.client.dev': [['tok-123']] },
      a: { 'sm4rt-probe.client.dev': ['198.51.100.1'] },
    }),
  );
  assert.equal(res.ok, false);
  assert.equal(res.routing, false);
  assert.match(res.detail, /198\.51\.100\.1/);
});

test('verifyDomain passes with TXT + wildcard A to edge ip', async () => {
  const res = await verifyDomain(
    row(),
    { ip: '203.0.113.9' },
    resolver({
      txt: { '_sm4rt-verify.client.dev': [['tok', '-123']] }, // chunked TXT joins
      a: { 'sm4rt-probe.client.dev': ['203.0.113.9'] },
    }),
  );
  assert.deepEqual(res, { ok: true, txt: true, routing: true, detail: 'verified' });
});

test('verifyDomain passes with wildcard CNAME to edge host (A follows chain)', async () => {
  const res = await verifyDomain(
    row(),
    { cname: 'edge.platform.io' },
    resolver({
      txt: { '_sm4rt-verify.client.dev': [['tok-123']] },
      a: {
        'edge.platform.io': ['203.0.113.9'],
        'sm4rt-probe.client.dev': ['203.0.113.9'],
      },
    }),
  );
  assert.equal(res.ok, true);
});

test('verifyDomain falls back to CNAME name match', async () => {
  const res = await verifyDomain(
    row(),
    { cname: 'edge.platform.io' },
    resolver({
      txt: { '_sm4rt-verify.client.dev': [['tok-123']] },
      cname: { 'sm4rt-probe.client.dev': ['edge.platform.io.'] },
    }),
  );
  assert.equal(res.ok, true);
});

// — host generation —

test('hostFor uses platform domain by default and custom domain when set', () => {
  let custom: string | null = null;
  const compute = new ComputeManager({
    instanceDomain: 'cloud.example',
    tls: true,
    domainFor: () => custom,
  });
  assert.equal(compute.hostFor('acme', 'task-api'), 'task-api.acme.cloud.example');
  assert.equal(compute.taskUrl('acme', 'api'), 'https://api.acme.cloud.example');
  custom = 'client.dev';
  assert.equal(compute.hostFor('acme', 'task-api'), 'task-api.client.dev');
  assert.equal(compute.taskUrl('acme', 'api'), 'https://api.client.dev');
});

// — store (file backend, temp dir) —

test('Store persists domains and default-domain settings', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sm4rt-store-'));
  try {
    const store = new Store({ dataFile: path.join(dir, 'store.json') });
    await store.init();

    const created = await store.createDomain('client.dev', 'acme');
    assert.equal(created.status, 'pending');
    assert.ok(created.verifyToken.length >= 16);
    assert.equal(store.getDomain('client.dev')?.workspace, 'acme');
    assert.equal(store.listDomains('acme').length, 1);
    assert.equal(store.listDomains('other').length, 0);

    // pending domains never influence host generation or tls-ask
    assert.equal(store.domainForHost('api.client.dev'), null);
    await store.setDefaultDomain('acme', null);
    assert.equal(store.getDefaultDomain('acme'), null);

    await store.markVerified('client.dev');
    assert.equal(store.getDomain('client.dev')?.status, 'verified');
    assert.equal(store.domainForHost('api.client.dev')?.workspace, 'acme');
    assert.equal(store.domainForHost('client.dev')?.workspace, 'acme');
    assert.equal(store.domainForHost('api.unrelated.dev'), null);

    await store.setDefaultDomain('acme', 'client.dev');
    assert.equal(store.getDefaultDomain('acme'), 'client.dev');
    assert.deepEqual(store.workspacesUsingDomain('client.dev'), ['acme']);

    await store.upsertUser('user_1', 'a@b.c');
    await store.upsertUser('user_1', 'a@b.c');

    // reload from disk → same state
    const store2 = new Store({ dataFile: path.join(dir, 'store.json') });
    await store2.init();
    assert.equal(store2.getDefaultDomain('acme'), 'client.dev');
    assert.equal(store2.getDomain('client.dev')?.status, 'verified');

    await store.deleteDomain('client.dev');
    assert.equal(store.getDomain('client.dev'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
