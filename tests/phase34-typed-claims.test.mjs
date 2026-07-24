import test from 'node:test';
import assert from 'node:assert/strict';
import { guardInvention } from '../scripts/lib/phase34-invention-guard.mjs';
import {
  buildTypedSupportedClaims,
  isTypedClaimSupported,
  CLAIM_TYPES,
  buildTripleVerdicts,
} from '../scripts/lib/phase34-typed-claims.mjs';
import { summarizeFailureSessions } from '../scripts/lib/phase34-freeze-manifest.mjs';
import { countFailureLedgerRows } from '../scripts/lib/phase34-eval-execution-mode.mjs';

const AUCTION = {
  sold_count: 3,
  median: 42,
  currency: 'USD',
  fair_low: 35,
  fair_high: 50,
  seller_floor: 40,
  watchers: 12,
  bid_count: 4,
  draft: 'Would you consider 40 USD?',
};

test('45 inside fair range is rejected as recommended price', () => {
  const text =
    'We have 3 eligible sales with a median price of $42. Our draft message suggests a sale at $45 USD.';
  const g = guardInvention({ text, structured_result: AUCTION });
  assert.equal(g.ok, false);
  assert.ok(g.violations.some((v) => Number(v.claim?.value) === 45));
  assert.equal(
    g.violations.find((v) => Number(v.claim?.value) === 45)?.claim?.claim_type,
    CLAIM_TYPES.RECOMMENDED_PRICE,
  );
});

test('supported floor/median/range bounds pass', () => {
  const text = 'Completed-sale median is 42 USD across 3 sales. Seller floor 40. Fair range 35 to 50.';
  const g = guardInvention({ text, structured_result: AUCTION });
  assert.equal(g.ok, true, JSON.stringify(g.violations));
});

test('watcher count does not authorize price 12 as recommended sale', () => {
  const text = 'I recommend offering $12 USD for this lot.';
  const g = guardInvention({ text, structured_result: AUCTION });
  assert.equal(g.ok, false);
});

test('typed allowlist: range membership alone does not support recommended price', () => {
  const supported = buildTypedSupportedClaims(AUCTION);
  assert.equal(isTypedClaimSupported(CLAIM_TYPES.RECOMMENDED_PRICE, 45, supported), false);
  assert.equal(isTypedClaimSupported(CLAIM_TYPES.RECOMMENDED_PRICE, 40, supported), true);
  assert.equal(isTypedClaimSupported(CLAIM_TYPES.FAIR_RANGE, 35, supported), true);
  assert.equal(isTypedClaimSupported(CLAIM_TYPES.FAIR_RANGE, 45, supported), false);
});

test('triple verdicts: contained invention => SAFETY PASS, MODEL_QUALITY BLOCKED', () => {
  const v = buildTripleVerdicts({
    unsupported_claims_escaped: 0,
    model_generations_accepted: 100,
    model_generations_guard_rejected: 1,
    verified_fallback_delivered: 1,
    accepted_grounded_model_response: 100,
    safe_deterministic_fallback: 1,
  });
  assert.equal(v.SAFETY_CONTAINMENT.verdict, 'PASS');
  assert.equal(v.MODEL_QUALITY.verdict, 'BLOCKED');
  assert.equal(v.CUSTOMER_OUTCOME.verdict, 'PASS');
});

test('failure summary does not double-count session+failure as two sessions', () => {
  const rows = [
    { session_id: 'rmf-05895', reason: 'INVENTION_GUARD', violations: [{ code: 'UNSUPPORTED_NUMERIC_VALUE' }] },
  ];
  const s = summarizeFailureSessions(rows);
  assert.equal(s.failed_session_count, 1);
  assert.equal(s.failure_row_count, 1);
});

test('v3 failures.jsonl scanner reports exactly one failure session', () => {
  const counted = countFailureLedgerRows(
    '/tmp/phase34-real-model-full-eval-v3/ledgers/failures.jsonl',
  );
  assert.equal(counted.rows, 1);
});
