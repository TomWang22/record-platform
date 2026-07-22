import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyKafkaDelivery,
  classifyKafkaSourceIdentity,
} from '../scripts/lib/phase34-kafka-identity.mjs';
import { verifyMaterialClaimIntegrity } from '../scripts/lib/phase34-claim-integrity.mjs';

test('no existing identity → ACCEPTED + create market event', () => {
  const r = classifyKafkaDelivery({
    existingIdentity: null,
    incomingPayloadHash: 'abc',
    topic: 't',
    partition: 0,
    offset: '1',
  });
  assert.equal(r.result, 'ACCEPTED');
  assert.equal(r.create_market_event, true);
});

test('same source + same hash → DUPLICATE_DELIVERY', () => {
  const r = classifyKafkaDelivery({
    existingIdentity: { canonical_payload_hash: 'abc', accepted_market_event_id: 'me-1' },
    incomingPayloadHash: 'abc',
    topic: 't',
    partition: 0,
    offset: '2',
  });
  assert.equal(r.result, 'DUPLICATE_DELIVERY');
  assert.equal(r.create_market_event, false);
});

test('same source + different hash → IDENTITY_PAYLOAD_CONFLICT quarantine', () => {
  const r = classifyKafkaDelivery({
    existingIdentity: { canonical_payload_hash: 'abc', accepted_market_event_id: 'me-1' },
    incomingPayloadHash: 'def',
    topic: 't',
    partition: 0,
    offset: '3',
  });
  assert.equal(r.result, 'IDENTITY_PAYLOAD_CONFLICT');
  assert.equal(r.quarantine, true);
  assert.equal(r.create_market_event, false);
});

test('duplicate topic/partition/offset → DUPLICATE_DELIVERY', () => {
  const r = classifyKafkaDelivery({
    existingIdentity: null,
    incomingPayloadHash: 'abc',
    topic: 't',
    partition: 0,
    offset: '9',
    existingDeliveryCoordinate: 't:0:9',
  });
  assert.equal(r.result, 'DUPLICATE_DELIVERY');
  assert.equal(r.reason, 'duplicate_offset_delivery');
});

test('compat classifier maps DUPLICATE_DELIVERY → DUPLICATE', () => {
  const r = classifyKafkaSourceIdentity({
    existing: { payload_hash: 'abc' },
    incomingPayloadHash: 'abc',
    topic: 't',
    partition: 0,
    offset: '2',
  });
  assert.equal(r.result, 'DUPLICATE');
});

test('claim integrity requires calculation_id', () => {
  const r = verifyMaterialClaimIntegrity({
    claim: { claim_type: 'sold_count', normalized_claim_value: 3 },
    calculation: { calculation_id: 'c1', sold_count: 3, evidence_snapshot_id: 's1' },
    snapshot: { evidence_snapshot_id: 's1' },
    includedMarketEventIds: [],
  });
  assert.equal(r.ok, false);
  assert.ok(r.failures.includes('claim_missing_calculation_id'));
});

test('claim integrity rejects excluded supporting event', () => {
  const r = verifyMaterialClaimIntegrity({
    claim: {
      claim_type: 'sold_count',
      deterministic_calculation_id: 'c1',
      normalized_claim_value: 3,
      supporting_snapshot_item_ids: ['me-x'],
    },
    calculation: { calculation_id: 'c1', sold_count: 3, evidence_snapshot_id: 's1' },
    snapshot: { evidence_snapshot_id: 's1' },
    includedMarketEventIds: [],
    excludedMarketEventIds: ['me-x'],
  });
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => f.startsWith('excluded_event_supports_claim')));
});

test('legacy source_sha blocked in acceptance snapshot', () => {
  const r = verifyMaterialClaimIntegrity({
    claim: {
      claim_type: 'sold_count',
      deterministic_calculation_id: 'c1',
      normalized_claim_value: 3,
      supporting_snapshot_item_ids: ['me-1'],
    },
    calculation: {
      calculation_id: 'c1',
      sold_count: 3,
      evidence_snapshot_id: 's1',
      eligible_sale_source_shas: ['LEGACY_UNKNOWN'],
    },
    snapshot: { evidence_snapshot_id: 's1' },
    includedMarketEventIds: ['me-1'],
  });
  assert.equal(r.ok, false);
  assert.ok(r.failures.includes('legacy_source_sha_in_acceptance_snapshot'));
});
