import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyKafkaSourceIdentity } from '../scripts/lib/phase34-kafka-identity.mjs';

test('no existing source_event_id → ACCEPTED', () => {
  const r = classifyKafkaSourceIdentity({
    existing: null,
    incomingPayloadHash: 'abc',
    topic: 't',
    partition: 0,
    offset: '1',
  });
  assert.equal(r.result, 'ACCEPTED');
  assert.equal(r.quarantine, false);
});

test('same source + same hash → DUPLICATE', () => {
  const r = classifyKafkaSourceIdentity({
    existing: { payload_hash: 'abc' },
    incomingPayloadHash: 'abc',
    topic: 't',
    partition: 0,
    offset: '2',
  });
  assert.equal(r.result, 'DUPLICATE');
  assert.equal(r.quarantine, false);
});

test('same source + different hash → IDENTITY_PAYLOAD_CONFLICT quarantine', () => {
  const r = classifyKafkaSourceIdentity({
    existing: { payload_hash: 'abc' },
    incomingPayloadHash: 'def',
    topic: 't',
    partition: 0,
    offset: '3',
  });
  assert.equal(r.result, 'IDENTITY_PAYLOAD_CONFLICT');
  assert.equal(r.quarantine, true);
});

test('duplicate topic/partition/offset → DUPLICATE', () => {
  const r = classifyKafkaSourceIdentity({
    existing: null,
    incomingPayloadHash: 'abc',
    topic: 't',
    partition: 0,
    offset: '9',
    existingOffsetKey: 't:0:9',
  });
  assert.equal(r.result, 'DUPLICATE');
  assert.equal(r.reason, 'duplicate_offset_delivery');
});

test('same payload under different event ID is a separate ACCEPTED path', () => {
  // Pure classifier has no cross-event memory; caller creates a new identity.
  const r = classifyKafkaSourceIdentity({
    existing: null,
    incomingPayloadHash: 'same-hash',
    topic: 't',
    partition: 1,
    offset: '10',
  });
  assert.equal(r.result, 'ACCEPTED');
});
