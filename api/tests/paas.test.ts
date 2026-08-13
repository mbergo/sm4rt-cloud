import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAAS_DB_ENGINES,
  PaasError,
  PaasManager,
  isValidAppName,
  isValidRepoUrl,
} from '../src/paas.ts';

function mockFetch(routes: Record<string, (init?: RequestInit) => { status: number; body: unknown }>) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = `${method} ${new URL(url).pathname}`;
    const handler = routes[key];
    if (!handler) return new Response(JSON.stringify({ message: 'Not found.' }), { status: 404 });
    const { status, body } = handler(init);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { impl, calls };
}

const BASE = { url: 'https://paas.test', token: 'tok' };
const PROJECT_ROUTES = {
  'GET /api/v1/servers': () => ({ status: 200, body: [{ uuid: 'srv-1' }] }),
  'GET /api/v1/projects': () => ({ status: 200, body: [{ uuid: 'proj-x', name: 'ws-demo' }] }),
};

test('isValidRepoUrl accepts public https git hosts only', () => {
  assert.ok(isValidRepoUrl('https://github.com/user/repo'));
  assert.ok(isValidRepoUrl('https://gitlab.com/group/proj.git'));
  assert.ok(!isValidRepoUrl('git@github.com:user/repo.git'));
  assert.ok(!isValidRepoUrl('https://evil.example.com/x/y'));
  assert.ok(!isValidRepoUrl('http://github.com/user/repo'));
});

test('isValidAppName mirrors function naming rules', () => {
  assert.ok(isValidAppName('my-app'));
  assert.ok(!isValidAppName('-bad'));
  assert.ok(!isValidAppName('UPPER'));
});

test('manager disabled without config → 503', async () => {
  const m = new PaasManager({ url: '', token: '' });
  assert.equal(m.enabled, false);
  await assert.rejects(
    () => m.listApps('demo'),
    (err: PaasError) => err.statusCode === 503,
  );
});

test('createApp validates name, repo and build pack before any network call', async () => {
  const { impl, calls } = mockFetch(PROJECT_ROUTES);
  const m = new PaasManager({ ...BASE, fetchImpl: impl });
  await assert.rejects(
    () => m.createApp('demo', { name: 'Bad Name', repository: 'https://github.com/u/r' }),
    (err: PaasError) => err.statusCode === 400,
  );
  await assert.rejects(
    () => m.createApp('demo', { name: 'ok', repository: 'ftp://nope' }),
    (err: PaasError) => err.statusCode === 400 && /repository/.test(err.message),
  );
  await assert.rejects(
    () => m.createApp('demo', { name: 'ok', repository: 'https://github.com/u/r', buildPack: 'maven' }),
    (err: PaasError) => err.statusCode === 400 && /build pack/.test(err.message),
  );
  assert.equal(calls.length, 0, 'validation must fail before hitting the API');
});

test('createApp posts to /applications/public with ws-prefixed name and platform fqdn', async () => {
  const { impl, calls } = mockFetch({
    ...PROJECT_ROUTES,
    'POST /api/v1/applications/public': (init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.project_uuid, 'proj-x');
      assert.equal(body.server_uuid, 'srv-1');
      assert.equal(body.name, 'demo-web');
      assert.equal(body.git_branch, 'main');
      assert.equal(body.build_pack, 'nixpacks');
      return { status: 201, body: { uuid: 'app-1' } };
    },
  });
  const m = new PaasManager({ ...BASE, fetchImpl: impl });
  const created = await m.createApp('demo', {
    name: 'web',
    repository: 'https://github.com/user/repo',
  });
  assert.equal(created.uuid, 'app-1');
  assert.ok(calls.some((c) => c.url.endsWith('/applications/public')));
});

test('listApps filters the global list to the workspace project', async () => {
  const { impl } = mockFetch({
    ...PROJECT_ROUTES,
    'GET /api/v1/projects/proj-x/production': () => ({
      status: 200,
      body: { applications: [{ uuid: 'app-mine' }] },
    }),
    'GET /api/v1/applications': () => ({
      status: 200,
      body: [
        { uuid: 'app-mine', name: 'demo-web', status: 'running', git_repository: 'https://github.com/u/r', git_branch: 'main', build_pack: 'nixpacks', fqdn: 'https://web-demo.apps.test' },
        { uuid: 'app-foreign', name: 'other', status: 'running' },
      ],
    }),
  });
  const m = new PaasManager({ ...BASE, fetchImpl: impl });
  const apps = await m.listApps('demo');
  assert.equal(apps.length, 1);
  assert.equal(apps[0].uuid, 'app-mine');
  assert.equal(apps[0].fqdn, 'https://web-demo.apps.test');
});

test('appAction/deleteApp refuse resources outside the workspace project', async () => {
  const { impl } = mockFetch({
    ...PROJECT_ROUTES,
    'GET /api/v1/projects/proj-x/production': () => ({
      status: 200,
      body: { applications: [{ uuid: 'app-mine' }] },
    }),
  });
  const m = new PaasManager({ ...BASE, fetchImpl: impl });
  await assert.rejects(
    () => m.appAction('demo', 'app-foreign', 'restart'),
    (err: PaasError) => err.statusCode === 404,
  );
  await assert.rejects(
    () => m.deleteApp('demo', 'app-foreign'),
    (err: PaasError) => err.statusCode === 404,
  );
});

test('createDatabase validates the engine list and posts to the right path', async () => {
  const { impl, calls } = mockFetch({
    ...PROJECT_ROUTES,
    'POST /api/v1/databases/redis': () => ({ status: 201, body: { uuid: 'db-1' } }),
  });
  const m = new PaasManager({ ...BASE, fetchImpl: impl });
  await assert.rejects(
    () => m.createDatabase('demo', { engine: 'oracle' }),
    (err: PaasError) => err.statusCode === 400 && /unknown engine/.test(err.message),
  );
  const created = await m.createDatabase('demo', { engine: 'redis', name: 'cache' });
  assert.equal(created.uuid, 'db-1');
  const post = calls.find((c) => c.method === 'POST' && c.url.includes('/databases/redis'));
  assert.equal((post?.body as { name?: string }).name, 'demo-cache');
});

test('listDatabases maps engines from database_type across env keys', async () => {
  const { impl } = mockFetch({
    ...PROJECT_ROUTES,
    'GET /api/v1/projects/proj-x/production': () => ({
      status: 200,
      body: { postgresqls: [{ uuid: 'db-pg' }], redis: [{ uuid: 'db-redis' }] },
    }),
    'GET /api/v1/databases': () => ({
      status: 200,
      body: [
        { uuid: 'db-pg', name: 'demo-main', status: 'running', database_type: 'standalone-postgresql', internal_db_url: 'postgres://u:p@h:5432/db' },
        { uuid: 'db-redis', name: 'demo-cache', status: 'running', database_type: 'standalone-redis' },
        { uuid: 'db-foreign', name: 'other', status: 'running', database_type: 'standalone-mysql' },
      ],
    }),
  });
  const m = new PaasManager({ ...BASE, fetchImpl: impl });
  const dbs = await m.listDatabases('demo');
  assert.equal(dbs.length, 2);
  assert.deepEqual(dbs.map((d) => d.engine).sort(), ['postgresql', 'redis']);
});

test('all 8 engines are exposed', () => {
  assert.equal(PAAS_DB_ENGINES.length, 8);
  assert.ok(PAAS_DB_ENGINES.includes('clickhouse'));
});
