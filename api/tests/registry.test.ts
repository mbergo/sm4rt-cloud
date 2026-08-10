import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { htpasswdLine, isValidRepoName } from '../src/registry.ts';

test('htpasswdLine produces user:bcrypt pair that verifies', () => {
  const line = htpasswdLine('smoke', 's3cret-pass');
  const [user, hash] = [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1)];
  assert.equal(user, 'smoke');
  assert.ok(hash.startsWith('$2'), `expected bcrypt hash, got ${hash}`);
  assert.ok(bcrypt.compareSync('s3cret-pass', hash));
  assert.ok(!bcrypt.compareSync('wrong', hash));
});

test('htpasswdLine hashes are salted (distinct per call)', () => {
  assert.notEqual(htpasswdLine('u', 'p'), htpasswdLine('u', 'p'));
});

test('isValidRepoName accepts distribution-spec names', () => {
  for (const name of ['alpine', 'myapp/backend', 'a.b_c-d', 'team/sub/repo', 'app__x', 'v2--beta']) {
    assert.ok(isValidRepoName(name), `${name} should be valid`);
  }
});

test('isValidRepoName rejects bad names', () => {
  const bad = ['', 'Alpine', 'my app', 'repo%', '/lead', 'trail/', 'a..b'.replace('..', '..'), '-x', 'x-/y', 'a'.repeat(256)];
  for (const name of bad) {
    assert.ok(!isValidRepoName(name), `${name} should be invalid`);
  }
});
