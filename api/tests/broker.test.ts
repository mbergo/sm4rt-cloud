import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidQueueName } from '../src/broker.ts';

test('isValidQueueName accepts sane names', () => {
  for (const name of ['jobs', 'orders.priority', 'my-queue_2', 'Q']) {
    assert.ok(isValidQueueName(name), `expected valid: ${name}`);
  }
});

test('isValidQueueName rejects reserved and illegal names', () => {
  for (const name of ['', 'amq.direct', 'has space', 'x'.repeat(256), 'emoji💥']) {
    assert.ok(!isValidQueueName(name), `expected invalid: ${name}`);
  }
});
