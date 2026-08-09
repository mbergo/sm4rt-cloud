// Unit tests: lenient JSON body parser.
// Guards the real-world case where browsers send DELETE requests with
// `content-type: application/json` and no body — Fastify's default parser
// rejects those with FST_ERR_CTP_EMPTY_JSON_BODY (400), which broke every
// plain-DELETE endpoint used by the console UI (workspaces, databases,
// caches, DNS records, gateways, CDNs, observability, devops, gitops apps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerLenientJsonParser } from '../src/json-body.ts';

async function build() {
  const app = Fastify();
  registerLenientJsonParser(app);
  app.delete('/thing/:id', async () => ({ ok: true }));
  app.post('/thing', async (req) => ({ got: req.body ?? null }));
  await app.ready();
  return app;
}

test('DELETE with content-type json and empty body succeeds', async () => {
  const app = await build();
  const res = await app.inject({
    method: 'DELETE',
    url: '/thing/abc',
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
  await app.close();
});

test('POST with valid JSON body still parses', async () => {
  const app = await build();
  const res = await app.inject({
    method: 'POST',
    url: '/thing',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ name: 'x' }),
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { got: { name: 'x' } });
  await app.close();
});

test('POST with malformed JSON body is rejected with 400', async () => {
  const app = await build();
  const res = await app.inject({
    method: 'POST',
    url: '/thing',
    headers: { 'content-type': 'application/json' },
    payload: '{nope',
  });
  assert.equal(res.statusCode, 400);
  await app.close();
});
