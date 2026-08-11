import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MarketplaceError,
  MarketplaceManager,
  domainsOf,
  projectNameFor,
} from '../src/marketplace.ts';

function mockFetch(routes: Record<string, (init?: RequestInit) => { status: number; body: unknown }>) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = `${method} ${new URL(url).pathname}`;
    const handler = routes[key];
    if (!handler) {
      return new Response(JSON.stringify({ message: 'Not found.' }), { status: 404 });
    }
    const { status, body } = handler(init);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { impl, calls };
}

const BASE = { url: 'https://coolify.test', token: 'tok' };

test('projectNameFor prefixes the workspace', () => {
  assert.equal(projectNameFor('demo'), 'ws-demo');
});

test('domainsOf extracts fqdns from applications', () => {
  assert.deepEqual(
    domainsOf({ applications: [{ fqdn: 'https://a.x, https://b.x' }, { fqdn: '' }, {}] }),
    ['https://a.x', 'https://b.x'],
  );
  assert.deepEqual(domainsOf({}), []);
});

test('manager is disabled without url/token and raises 503', async () => {
  const m = new MarketplaceManager({ url: '', token: '' });
  assert.equal(m.enabled, false);
  await assert.rejects(
    () => m.listTemplates(),
    (err: MarketplaceError) => err.statusCode === 503,
  );
});

test('listTemplates probes the create endpoint and caches the catalog', async () => {
  let probes = 0;
  const { impl } = mockFetch({
    'GET /api/v1/servers': () => ({ status: 200, body: [{ uuid: 'srv-1' }] }),
    'GET /api/v1/projects': () => ({ status: 200, body: [{ uuid: 'proj-any', name: 'Main' }] }),
    'POST /api/v1/services': () => {
      probes += 1;
      return { status: 422, body: { valid_service_types: ['uptime-kuma', 'gitea'] } };
    },
  });
  const m = new MarketplaceManager({ ...BASE, fetchImpl: impl });
  assert.deepEqual(await m.listTemplates(), ['uptime-kuma', 'gitea']);
  assert.deepEqual(await m.listTemplates(), ['uptime-kuma', 'gitea']);
  assert.equal(probes, 1, 'second call must hit the cache');
});

test('createApp validates the type against the catalog', async () => {
  const { impl } = mockFetch({
    'GET /api/v1/servers': () => ({ status: 200, body: [{ uuid: 'srv-1' }] }),
    'GET /api/v1/projects': () => ({ status: 200, body: [] }),
    'POST /api/v1/projects': () => ({ status: 201, body: { uuid: 'proj-1' } }),
    'POST /api/v1/services': (init) => {
      const body = JSON.parse(String(init?.body)) as { type: string };
      if (body.type === 'sm4rt-catalog-probe' || body.type === 'nope') {
        return { status: 422, body: { valid_service_types: ['uptime-kuma'] } };
      }
      return { status: 201, body: { uuid: 'svc-1', domains: ['https://kuma.test'] } };
    },
  });
  const m = new MarketplaceManager({ ...BASE, fetchImpl: impl });
  await assert.rejects(
    () => m.createApp('demo', { type: 'nope' }),
    (err: MarketplaceError) => err.statusCode === 400 && /unknown template/.test(err.message),
  );
  const created = await m.createApp('demo', { type: 'uptime-kuma', name: 'kuma' });
  assert.deepEqual(created, { uuid: 'svc-1', domains: ['https://kuma.test'] });
});

test('createApp reuses an existing ws-<name> project', async () => {
  let createdProjects = 0;
  const { impl, calls } = mockFetch({
    'GET /api/v1/servers': () => ({ status: 200, body: [{ uuid: 'srv-1' }] }),
    'GET /api/v1/projects': () => ({ status: 200, body: [{ uuid: 'proj-x', name: 'ws-demo' }] }),
    'POST /api/v1/projects': () => {
      createdProjects += 1;
      return { status: 201, body: { uuid: 'proj-new' } };
    },
    'POST /api/v1/services': (init) => {
      const body = JSON.parse(String(init?.body)) as { type: string; project_uuid?: string };
      if (body.type === 'sm4rt-catalog-probe') {
        return { status: 422, body: { valid_service_types: ['uptime-kuma'] } };
      }
      assert.equal(body.project_uuid, 'proj-x');
      return { status: 201, body: { uuid: 'svc-1', domains: [] } };
    },
  });
  const m = new MarketplaceManager({ ...BASE, fetchImpl: impl });
  await m.createApp('demo', { type: 'uptime-kuma' });
  assert.equal(createdProjects, 0);
  assert.ok(calls.some((c) => c.method === 'POST' && c.url.endsWith('/services')));
});

test('listApps returns [] for a project with no services', async () => {
  const { impl } = mockFetch({
    'GET /api/v1/projects': () => ({ status: 200, body: [{ uuid: 'proj-x', name: 'ws-demo' }] }),
    'GET /api/v1/projects/proj-x/production': () => ({ status: 200, body: { services: [] } }),
  });
  const m = new MarketplaceManager({ ...BASE, fetchImpl: impl });
  assert.deepEqual(await m.listApps('demo'), []);
});

test('listApps hydrates status and domains from the service detail', async () => {
  const { impl } = mockFetch({
    'GET /api/v1/projects': () => ({ status: 200, body: [{ uuid: 'proj-x', name: 'ws-demo' }] }),
    'GET /api/v1/projects/proj-x/production': () => ({
      status: 200,
      body: { services: [{ uuid: 'svc-1', name: 'kuma', created_at: '2026-01-01' }] },
    }),
    'GET /api/v1/services/svc-1': () => ({
      status: 200,
      body: {
        name: 'kuma',
        service_type: 'uptime-kuma',
        status: 'running:healthy',
        applications: [{ fqdn: 'https://kuma.test' }],
      },
    }),
  });
  const m = new MarketplaceManager({ ...BASE, fetchImpl: impl });
  const apps = await m.listApps('demo');
  assert.equal(apps.length, 1);
  assert.equal(apps[0].status, 'running:healthy');
  assert.equal(apps[0].type, 'uptime-kuma');
  assert.deepEqual(apps[0].domains, ['https://kuma.test']);
});

test('deleteApp and appAction refuse a service outside the workspace project', async () => {
  const { impl } = mockFetch({
    'GET /api/v1/projects': () => ({ status: 200, body: [{ uuid: 'proj-x', name: 'ws-demo' }] }),
    'GET /api/v1/projects/proj-x/production': () => ({
      status: 200,
      body: { services: [{ uuid: 'svc-owned' }] },
    }),
  });
  const m = new MarketplaceManager({ ...BASE, fetchImpl: impl });
  await assert.rejects(
    () => m.deleteApp('demo', 'svc-foreign'),
    (err: MarketplaceError) => err.statusCode === 404,
  );
  await assert.rejects(
    () => m.appAction('demo', 'svc-foreign', 'stop'),
    (err: MarketplaceError) => err.statusCode === 404,
  );
});

test('deleteApp issues DELETE with volume cleanup for an owned service', async () => {
  const { impl, calls } = mockFetch({
    'GET /api/v1/projects': () => ({ status: 200, body: [{ uuid: 'proj-x', name: 'ws-demo' }] }),
    'GET /api/v1/projects/proj-x/production': () => ({
      status: 200,
      body: { services: [{ uuid: 'svc-1' }] },
    }),
    'DELETE /api/v1/services/svc-1': () => ({ status: 200, body: { message: 'queued' } }),
  });
  const m = new MarketplaceManager({ ...BASE, fetchImpl: impl });
  await m.deleteApp('demo', 'svc-1');
  const del = calls.find((c) => c.method === 'DELETE');
  assert.ok(del?.url.includes('delete_volumes=true'));
});
