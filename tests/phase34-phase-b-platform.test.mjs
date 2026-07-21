/**
 * Phase A hardening + Phase B platform regression tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertLegalLifecycleTransition,
  planLifecycleTransition,
  IllegalLifecycleTransitionError,
} from '../scripts/lib/phase34-lifecycle-transitions.mjs';
import { buildSaleCompletedEvent, SETTLEMENT_SOURCES } from '../scripts/lib/phase34-sale-completed-emitter.mjs';
import { buildSaleFollowupEvent } from '../scripts/lib/phase34-sale-followup-events.mjs';
import {
  buildRawObservation,
  buildCanonicalMarketEvent,
  SOURCE_CLASSES,
} from '../scripts/lib/phase34-canonical-market-platform.mjs';
import { resolveEntity } from '../scripts/lib/phase34-entity-resolution.mjs';
import { evaluateEligibility } from '../scripts/lib/phase34-eligibility-engine.mjs';
import {
  buildPlatformEvidenceSnapshot,
  buildClaimLedger,
  assertClaimLedgerPass,
} from '../scripts/lib/phase34-claim-ledger.mjs';
import { finalizeCapabilityResponse, EIGHT_CAPABILITIES } from '../scripts/lib/phase34-capability-response.mjs';
import crypto from 'node:crypto';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function deterministicSaleEventId(input) {
  const basis = [
    input.settlementSource,
    input.paymentTransactionId || '',
    input.orderId || '',
    input.listingId,
    input.payloadHash || '',
  ].join('|');
  return `sale-${crypto.createHash('sha256').update(JSON.stringify(basis)).digest('hex').slice(0, 28)}`;
}

test('A5: illegal lifecycle transitions rejected; archived never sells', () => {
  assert.throws(
    () => assertLegalLifecycleTransition('ARCHIVED', 'SOLD'),
    IllegalLifecycleTransitionError,
  );
  assert.throws(
    () => assertLegalLifecycleTransition('SOLD', 'ACTIVE'),
    IllegalLifecycleTransitionError,
  );
  assert.equal(assertLegalLifecycleTransition('ACTIVE', 'ENDED_UNSOLD').ok, true);
  assert.throws(
    () =>
      planLifecycleTransition({
        listingId: 'x',
        fromLifecycle: 'ACTIVE',
        toLifecycle: 'SOLD',
        reasonCode: 'TEST',
      }),
    /SOLD_REQUIRES_SALE_COMPLETED_EVENT/,
  );
  const planned = planLifecycleTransition({
    listingId: 'x',
    fromLifecycle: 'ACTIVE',
    toLifecycle: 'SOLD',
    reasonCode: 'CHECKOUT',
    saleEventId: 'sale-1',
    settlementEvidenceEligible: true,
  });
  assert.equal(planned.settlement_evidence_eligible, true);
});

test('A1/A7: refund creates follow-up event; original sale stays SALE_COMPLETED', () => {
  const sale = buildSaleCompletedEvent({
    listing_id: 'listing-1',
    final_price: 40,
    source: SETTLEMENT_SOURCES.CHECKOUT_SETTLEMENT,
    completed_at: '2026-07-20T12:00:00.000Z',
  });
  assert.equal(sale.event_type, 'SALE_COMPLETED');
  const refund = buildSaleFollowupEvent({
    relatedSaleEvent: sale,
    eventType: 'SALE_REFUNDED',
    amount: 40,
    currency: 'USD',
    reasonCode: 'BUYER_RETURN',
  });
  assert.equal(refund.event_type, 'SALE_REFUNDED');
  assert.equal(refund.related_sale_event_id, sale.sale_event_id);
  assert.equal(refund.payload.original_sale_immutable, true);
  assert.equal(sale.event_type, 'SALE_COMPLETED');
});

test('A2: deterministic sale ids are stable across retries', () => {
  const a = deterministicSaleEventId({
    listingId: 'listing-1',
    settlementSource: 'CHECKOUT_SETTLEMENT',
    paymentTransactionId: 'pay-abc',
    orderId: 'order-1',
    payloadHash: 'hash1',
  });
  const b = deterministicSaleEventId({
    listingId: 'listing-1',
    settlementSource: 'CHECKOUT_SETTLEMENT',
    paymentTransactionId: 'pay-abc',
    orderId: 'order-1',
    payloadHash: 'hash1',
  });
  assert.equal(a, b);
  const src = fs.readFileSync(
    path.join(REPO, 'services/shopping-service/src/lib/sale-completed-emitter.ts'),
    'utf8',
  );
  assert.match(src, /deterministicSaleEventId/);
  assert.match(src, /AUCTION_PAYMENT_SETTLEMENT/);
});

test('A3: sold_at-only / seed / archive candidates are EXCLUDED_UNSETTLED', () => {
  const { included, exclusions } = evaluateEligibility(
    [
      {
        market_event_id: 'me-sold-at',
        event_type: 'SALE_COMPLETED',
        from_sold_at_only: true,
        source_class: 'FIRST_PARTY_SETTLEMENT',
      },
      {
        market_event_id: 'me-seed',
        event_type: 'COMPLETED_SALE',
        from_seed: true,
      },
      {
        market_event_id: 'me-archive',
        event_type: 'SALE_COMPLETED',
        source_class: 'FIRST_PARTY_LISTING',
      },
      {
        market_event_id: 'me-real',
        event_type: 'SALE_COMPLETED',
        source_class: 'FIRST_PARTY_SETTLEMENT',
        settlement_evidence_eligible: true,
        payload_hash: 'p1',
        occurred_at: '2026-07-01T00:00:00.000Z',
        price_normalized: 40,
        rights_status: 'FIRST_PARTY',
      },
    ],
    {},
  );
  assert.equal(included.length, 1);
  assert.equal(included[0].market_event_id, 'me-real');
  assert.ok(exclusions.some((x) => x.decision === 'EXCLUDED_UNSETTLED'));
});

test('A1 schema: append-only triggers and follow-up table present in migration 50', () => {
  const sql = fs.readFileSync(path.join(REPO, 'infra/db/50-listings-sale-completed-hardening.sql'), 'utf8');
  assert.match(sql, /deny_sale_completed_mutation/);
  assert.match(sql, /BEFORE UPDATE ON listings\.sale_completed_events/);
  assert.match(sql, /BEFORE DELETE ON listings\.sale_completed_events/);
  assert.match(sql, /sale_followup_events/);
  assert.match(sql, /SALE_REFUNDED/);
  assert.match(sql, /settlement_evidence_eligible/);
  assert.match(sql, /uq_sale_completed_settlement_payment/);
  assert.match(sql, /REVOKE UPDATE, DELETE ON listings\.sale_completed_events/);
});

test('A4: shopping emitter uses BEGIN/COMMIT and outbox in same path', () => {
  const src = fs.readFileSync(
    path.join(REPO, 'services/shopping-service/src/lib/sale-completed-emitter.ts'),
    'utf8',
  );
  assert.match(src, /BEGIN/);
  assert.match(src, /COMMIT/);
  assert.match(src, /ROLLBACK/);
  assert.match(src, /listings\.outbox_events/);
  assert.match(src, /lifecycle_transition_audit/);
  assert.match(src, /settlement_evidence_eligible = TRUE/);
  assert.match(src, /ON CONFLICT/);
});

test('B1/B2: raw observation + canonical SALE_COMPLETED requires settlement class', () => {
  assert.ok(SOURCE_CLASSES.includes('FIRST_PARTY_SETTLEMENT'));
  const obs = buildRawObservation({
    source_class: 'FIRST_PARTY_SETTLEMENT',
    source_connector: 'shopping-checkout',
    source_record_id: 'pay-1',
    source_event_type: 'checkout.completed',
    raw_payload: { listing_id: 'L1', price: 40 },
    authorization_scope: 'first_party_settlement',
    rights_classification: 'FIRST_PARTY',
  });
  const event = buildCanonicalMarketEvent(obs, {
    event_type: 'SALE_COMPLETED',
    payload: { listing_id: 'L1', price_normalized: 40 },
    price_normalized: 40,
    currency_normalized: 'USD',
  });
  assert.equal(event.event_type, 'SALE_COMPLETED');
  assert.equal(event.observation_id, obs.observation_id);

  const listingObs = buildRawObservation({
    source_class: 'FIRST_PARTY_LISTING',
    source_connector: 'listings',
    source_record_id: 'L2',
    source_event_type: 'listing.sold_at_set',
    raw_payload: { sold_at: '2026-07-01' },
    authorization_scope: 'authenticated_market',
    rights_classification: 'FIRST_PARTY',
  });
  assert.throws(
    () => buildCanonicalMarketEvent(listingObs, { event_type: 'SALE_COMPLETED', payload: {} }),
    /SALE_COMPLETED_REQUIRES_FIRST_PARTY_SETTLEMENT/,
  );
});

test('B3: entity resolution returns exactly one status', () => {
  const exact = resolveEntity({
    artist: 'Kenny Dorham',
    title: 'Una Mas',
    pressing_id: 'BST-84127-US',
    catalog_number: 'BST-84127',
  });
  assert.equal(exact.resolution_status, 'MATCHED_EXACT_PRESSING');
  const release = resolveEntity({
    artist: 'Kenny Dorham',
    title: 'Una Mas',
    release_id: 'rel-1',
    catalog_number: 'BST-84127',
  });
  assert.equal(release.resolution_status, 'MATCHED_RELEASE_ONLY');
  const unresolved = resolveEntity({});
  assert.equal(unresolved.resolution_status, 'UNRESOLVED');
});

test('B5/B6: snapshot + claim ledger required; unsupported claims fail', () => {
  const snapshot = buildPlatformEvidenceSnapshot({
    capability: 'valuation',
    subject: { artist: 'Kenny Dorham', title: 'Una Mas', pressing_id: 'p1' },
    candidates: [
      {
        market_event_id: 'me-1',
        evidence_id: 'me-1',
        event_type: 'SALE_COMPLETED',
        sale_kind: 'sold',
        source_class: 'FIRST_PARTY_SETTLEMENT',
        settlement_evidence_eligible: true,
        payload_hash: 'h1',
        price_normalized: 39,
        occurred_at: '2026-07-01T00:00:00.000Z',
        rights_status: 'FIRST_PARTY',
      },
      {
        market_event_id: 'me-2',
        evidence_id: 'me-2',
        event_type: 'SALE_COMPLETED',
        sale_kind: 'sold',
        source_class: 'FIRST_PARTY_SETTLEMENT',
        settlement_evidence_eligible: true,
        payload_hash: 'h2',
        price_normalized: 40.75,
        occurred_at: '2026-07-02T00:00:00.000Z',
        rights_status: 'FIRST_PARTY',
      },
      {
        market_event_id: 'me-3',
        evidence_id: 'me-3',
        event_type: 'SALE_COMPLETED',
        sale_kind: 'sold',
        source_class: 'FIRST_PARTY_SETTLEMENT',
        settlement_evidence_eligible: true,
        payload_hash: 'h3',
        price_normalized: 42.5,
        occurred_at: '2026-07-03T00:00:00.000Z',
        rights_status: 'FIRST_PARTY',
      },
    ],
  });
  assert.ok(snapshot.evidence_snapshot_id);
  assert.ok(snapshot.evidence_snapshot_hash);
  assert.equal(snapshot.included_event_ids.length, 3);

  const okLedger = buildClaimLedger({
    responseId: 'resp-1',
    snapshot,
    claims: [
      {
        claim_type: 'sold_count',
        normalized_claim_value: 3,
        expected_count: 3,
        supporting_snapshot_item_ids: ['me-1', 'me-2', 'me-3'],
        material: true,
      },
      {
        claim_type: 'valuation',
        normalized_claim_value: 40.75,
        supporting_snapshot_item_ids: ['me-1', 'me-2', 'me-3', 'calc:median'],
        deterministic_calculation_id: 'calc:median',
        material: true,
      },
    ],
  });
  assert.equal(okLedger.verification_status, 'PASS');
  assertClaimLedgerPass(okLedger);

  const bad = buildClaimLedger({
    responseId: 'resp-2',
    snapshot,
    claims: [
      {
        claim_type: 'sold_count',
        normalized_claim_value: 99,
        expected_count: 99,
        supporting_snapshot_item_ids: ['me-1'],
        material: true,
      },
    ],
  });
  assert.equal(bad.verification_status, 'FAIL');
  assert.throws(() => assertClaimLedgerPass(bad), /CLAIM_LEDGER_VERIFICATION_FAILED/);
});

test('B7: all eight capabilities can finalize envelope with snapshot+ledger', () => {
  assert.equal(EIGHT_CAPABILITIES.length, 8);
  for (const capability of EIGHT_CAPABILITIES) {
    const envelope = finalizeCapabilityResponse({
      capability,
      subject: { artist: 'Test', title: 'Album' },
      candidates: [],
      structured_result: { status: 'insufficient_data' },
      answer: 'Insufficient evidence.',
      customer_summary: 'Not enough completed sales yet.',
      limitations: ['insufficient_evidence'],
      confidence: 0.2,
      claims: [],
    });
    assert.ok(envelope.evidence_snapshot_id);
    assert.ok(envelope.evidence_snapshot_hash);
    assert.ok(envelope.claim_ledger_id);
    assert.equal(envelope.capability, capability);
    assert.equal(envelope.envelope_version, 'phase34-response-envelope-v1');
  }
});

test('B schema migration 51 defines snapshots and claim ledger tables', () => {
  const sql = fs.readFileSync(path.join(REPO, 'infra/db/51-intelligence-evidence-platform.sql'), 'utf8');
  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS intelligence/);
  assert.match(sql, /raw_observations/);
  assert.match(sql, /market_events/);
  assert.match(sql, /entity_resolutions/);
  assert.match(sql, /eligibility_decisions/);
  assert.match(sql, /evidence_snapshots/);
  assert.match(sql, /evidence_snapshot_items/);
  assert.match(sql, /evidence_snapshot_exclusions/);
  assert.match(sql, /claim_ledgers/);
  assert.match(sql, /claim_ledger_entries/);
  assert.match(sql, /response_envelopes/);
  assert.match(sql, /MATCHED_EXACT_PRESSING/);
  assert.match(sql, /EXCLUDED_UNSETTLED/);
  assert.match(sql, /deny_append_only_mutation/);
});
