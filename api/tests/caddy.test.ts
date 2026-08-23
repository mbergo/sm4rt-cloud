import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MARKETPLACE_LABEL, parseTlsAsk } from '../src/caddy.ts';

const DOMAIN = 'a.sm4rt.org';
const CONSOLE = 'cloud.a.sm4rt.org';
const ask = (d: string) => parseTlsAsk(d, DOMAIN, CONSOLE);

test('the console host is allowed outright', () => {
  assert.deepEqual(ask(CONSOLE), { allowed: true, instance: null });
  // the ask can arrive with different casing than we configured
  assert.deepEqual(ask(CONSOLE.toUpperCase()), { allowed: true, instance: null });
});

test('a workspace subdomain defers to an instance lookup', () => {
  assert.deepEqual(ask(`demo.${DOMAIN}`), { allowed: false, instance: 'demo' });
});

test('a catalog service host resolves to its workspace', () => {
  // only services with an http UI get their own host, so the suffix is
  // stripped to find the workspace that owns them
  assert.deepEqual(ask(`demo-airflow.${DOMAIN}`), { allowed: false, instance: 'demo' });
  // a service without an http UI is not a suffix, so the whole label is the name
  assert.deepEqual(ask(`demo-kafka.${DOMAIN}`), { allowed: false, instance: 'demo-kafka' });
});

test('hosts outside the instance domain are refused', () => {
  assert.deepEqual(ask('evil.example.com'), { allowed: false, instance: null });
});

test('a marketplace app is allowed without an instance lookup', () => {
  // <app>.<marketplace>.<domain> is proxied to the PaaS host and has no
  // workspace behind it, so the caller's instance lookup could never allow it.
  assert.deepEqual(ask(`langflow.${MARKETPLACE_LABEL}.${DOMAIN}`), {
    allowed: true,
    instance: null,
  });
});

test('only the exact two-label marketplace form is allowed', () => {
  // deeper nesting stays on the compute path so the marketplace label cannot
  // be used to mint certificates for arbitrary hosts
  assert.deepEqual(ask(`a.b.${MARKETPLACE_LABEL}.${DOMAIN}`), {
    allowed: false,
    instance: MARKETPLACE_LABEL,
  });
  // and a workspace merely named like the label still gets checked
  assert.deepEqual(ask(`${MARKETPLACE_LABEL}.${DOMAIN}`), {
    allowed: false,
    instance: MARKETPLACE_LABEL,
  });
});

test('invalid dns labels are refused', () => {
  assert.deepEqual(ask(`-bad.${DOMAIN}`), { allowed: false, instance: null });
  assert.deepEqual(ask(`bad_label.${MARKETPLACE_LABEL}.${DOMAIN}`), {
    allowed: false,
    instance: null,
  });
});
