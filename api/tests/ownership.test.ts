import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/db.ts';

async function freshStore(): Promise<{ store: Store; dir: string }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'sm4rt-db-'));
  const store = new Store({ dataFile: path.join(dir, 'store.json') });
  await store.init();
  return { store, dir };
}

test('ownership: set, get, list per tenant, delete', async () => {
  const { store, dir } = await freshStore();
  try {
    assert.equal(store.getOwner('ws-a'), null);
    await store.setOwner('ws-a', 'user_alice');
    await store.setOwner('ws-b', 'user_alice');
    await store.setOwner('ws-c', 'user_bob');
    assert.equal(store.getOwner('ws-a'), 'user_alice');
    assert.deepEqual(store.workspacesOf('user_alice').sort(), ['ws-a', 'ws-b']);
    assert.deepEqual(store.workspacesOf('user_bob'), ['ws-c']);
    assert.deepEqual(store.workspacesOf('user_nobody'), []);
    // reassign (admin migration)
    await store.setOwner('ws-a', 'user_bob');
    assert.equal(store.getOwner('ws-a'), 'user_bob');
    assert.deepEqual(store.workspacesOf('user_alice'), ['ws-b']);
    await store.deleteOwner('ws-b');
    assert.equal(store.getOwner('ws-b'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ownership survives a reload (file persistence)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sm4rt-db-'));
  try {
    const file = path.join(dir, 'store.json');
    const first = new Store({ dataFile: file });
    await first.init();
    await first.setOwner('ws-persist', 'user_marcus');
    const second = new Store({ dataFile: file });
    await second.init();
    assert.equal(second.getOwner('ws-persist'), 'user_marcus');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('root domain: set, read, clear', async () => {
  const { store, dir } = await freshStore();
  try {
    assert.equal(store.getRootDomain('user_marcus'), null);
    await store.upsertUser('user_marcus', 'm@x.io');
    await store.setRootDomain('user_marcus', 'marcus.ai');
    assert.equal(store.getRootDomain('user_marcus'), 'marcus.ai');
    await store.setRootDomain('user_marcus', null);
    assert.equal(store.getRootDomain('user_marcus'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listUsers exposes upserted identities', async () => {
  const { store, dir } = await freshStore();
  try {
    await store.upsertUser('user_a', 'a@x.io');
    await store.upsertUser('user_b', null);
    const users = store.listUsers();
    assert.equal(users.length, 2);
    assert.ok(users.some((u) => u.clerkId === 'user_a' && u.email === 'a@x.io'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
