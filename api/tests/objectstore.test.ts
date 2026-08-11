import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidBucketName } from '../src/objectstore.ts';

test('isValidBucketName accepts s3-legal names', () => {
  for (const name of ['abc', 'my-bucket', 'logs.2026', 'a1b2c3', 'x'.repeat(63)]) {
    assert.ok(isValidBucketName(name), `expected valid: ${name}`);
  }
});

test('isValidBucketName rejects illegal names', () => {
  for (const name of [
    '',
    'ab',
    'x'.repeat(64),
    'UPPER',
    '-lead',
    'trail-',
    'dot..dot',
    'dash-.dot',
    'dot.-dash',
    '192.168.1.1',
    'has_underscore',
    'has space',
  ]) {
    assert.ok(!isValidBucketName(name), `expected invalid: ${name}`);
  }
});
