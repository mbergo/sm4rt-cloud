import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  DEFAULT_FUNCTION_CODE,
  isValidFunctionName,
  runnerScript,
} from '../src/functions.ts';

test('isValidFunctionName accepts sane names', () => {
  for (const name of ['hello', 'my-fn', 'a', 'fn2', 'x'.repeat(40)]) {
    assert.ok(isValidFunctionName(name), `expected valid: ${name}`);
  }
});

test('isValidFunctionName rejects illegal names', () => {
  for (const name of ['', '-lead', 'trail-', 'UPPER', 'has_underscore', 'x'.repeat(41), 'a b']) {
    assert.ok(!isValidFunctionName(name), `expected invalid: ${name}`);
  }
});

// The real deal: run the exact runner script with the default handler and
// make an HTTP request against it — same code path as the container.
test('runner serves the default handler over HTTP', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sm4rt-fn-'));
  writeFileSync(path.join(dir, 'handler.js'), DEFAULT_FUNCTION_CODE);
  const fixed = runnerScript()
    .replace("require('/fn/handler.js')", `require('${dir}/handler.js')`)
    .replace('server.listen(8080', 'server.listen(18099');
  const child2 = spawn(process.execPath, ['-e', fixed], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('runner did not start')), 10000);
      child2.stdout.on('data', (c: Buffer) => {
        if (String(c).includes('listening')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child2.stderr.on('data', (c: Buffer) => {
        clearTimeout(timer);
        reject(new Error(`runner stderr: ${c}`));
      });
    });
    const res = await fetch('http://127.0.0.1:18099/greet?x=1', { method: 'GET' });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { message: string; path: string; method: string };
    assert.equal(body.message, 'hello world');
    assert.equal(body.method, 'GET');
    assert.ok(body.path.startsWith('/greet'));
  } finally {
    child2.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runner returns 500 with error JSON when the handler throws', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sm4rt-fn-'));
  writeFileSync(
    path.join(dir, 'handler.js'),
    "module.exports = () => { throw new Error('boom'); };",
  );
  const fixed = runnerScript()
    .replace("require('/fn/handler.js')", `require('${dir}/handler.js')`)
    .replace('server.listen(8080', 'server.listen(18098');
  const child = spawn(process.execPath, ['-e', fixed], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('runner did not start')), 10000);
      child.stdout.on('data', (c: Buffer) => {
        if (String(c).includes('listening')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const res = await fetch('http://127.0.0.1:18098/');
    assert.equal(res.status, 500);
    const body = (await res.json()) as { error: string };
    assert.ok(body.error.includes('boom'));
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
