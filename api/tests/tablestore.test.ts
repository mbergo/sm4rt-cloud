import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidAttrName, isValidTableName } from '../src/tablestore.ts';

test('isValidTableName accepts dynamodb-legal names', () => {
  for (const name of ['abc', 'my-table', 'Users_2026', 'a.b.c', 'x'.repeat(255)]) {
    assert.ok(isValidTableName(name), `expected valid: ${name}`);
  }
});

test('isValidTableName rejects illegal names', () => {
  for (const name of ['', 'ab', 'x'.repeat(256), 'has space', 'emoji💥', 'semi;colon']) {
    assert.ok(!isValidTableName(name), `expected invalid: ${name}`);
  }
});

test('isValidAttrName bounds', () => {
  assert.ok(isValidAttrName('id'));
  assert.ok(isValidAttrName('a'));
  assert.ok(!isValidAttrName(''));
  assert.ok(!isValidAttrName('x'.repeat(256)));
  assert.ok(!isValidAttrName('bad key'));
});
