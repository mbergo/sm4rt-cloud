import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidName, randomName } from '../src/names.ts';

test('isValidName accepts lowercase kebab names', () => {
  assert.equal(isValidName('demo'), true);
  assert.equal(isValidName('sturdy-condor'), true);
  assert.equal(isValidName('a1-b2-c3'), true);
});

test('isValidName rejects invalid names', () => {
  assert.equal(isValidName(''), false);
  assert.equal(isValidName('UPPER'), false);
  assert.equal(isValidName('-lead'), false);
  assert.equal(isValidName('trail-'), false);
  assert.equal(isValidName('double--dash'), false);
  assert.equal(isValidName('has_underscore'), false);
  assert.equal(isValidName('1starts-with-digit'), false);
  assert.equal(isValidName('x'.repeat(29)), false);
  assert.equal(isValidName('x'.repeat(28)), true);
});

test('randomName returns a valid, untaken name', () => {
  const taken = new Set<string>();
  for (let i = 0; i < 20; i++) {
    const name = randomName(taken);
    assert.equal(isValidName(name), true);
    assert.equal(taken.has(name), false);
    taken.add(name);
  }
});
