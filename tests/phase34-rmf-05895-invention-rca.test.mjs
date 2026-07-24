import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { guardInvention } from '../scripts/lib/phase34-invention-guard.mjs';
import { inferClaimType, CLAIM_TYPES } from '../scripts/lib/phase34-typed-claims.mjs';
import {
  scanInventionGuardFailures,
  buildModelInvocationRow,
} from '../scripts/lib/phase34-eval-execution-mode.mjs';

const AUCTION_STRUCTURED = {
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

function ledgerFor(structured) {
  return {
    entries: Object.entries(structured)
      .filter(([, v]) => typeof v === 'number')
      .map(([k, v]) => ({
        claim_type: k,
        normalized_claim_value: v,
        verification_result: 'SUPPORTED',
      })),
  };
}

/** Exact replay of the rmf-05895 offending prose under pinned structured inputs. */
test('rmf-05895 exact replay: invented $45 is rejected and does not escape', () => {
  const text =
    'We have 3 eligible sales with a median price of $42, and our current best bid is $40 USD. We are not allowing automatic bids or sending messages to sellers. Our draft message suggests a sale at $45 USD, but';
  const g = guardInvention({
    text,
    structured_result: AUCTION_STRUCTURED,
    claim_ledger: ledgerFor(AUCTION_STRUCTURED),
  });
  assert.equal(g.ok, false);
  const fortyFive = g.violations.find((v) => Number(v.claim?.value) === 45);
  assert.ok(fortyFive);
  assert.equal(fortyFive.code, 'UNSUPPORTED_NUMERIC_VALUE');
  assert.equal(fortyFive.claim.claim_type, CLAIM_TYPES.RECOMMENDED_PRICE);
  // Supported $40 as money must not be mis-typed as bid_count
  assert.equal(
    g.violations.some((v) => Number(v.claim?.value) === 40),
    false,
  );
});

test('adversarial numeric inventions: 1000 unsupported prices never pass the guard', () => {
  const allowed = new Set([3, 4, 12, 35, 40, 42, 50]);
  let rejected = 0;
  let escaped = 0;
  for (let i = 0; i < 1000; i += 1) {
    let forged = 10 + (i % 90);
    if (allowed.has(forged)) forged += 1;
    if (allowed.has(forged)) forged = 99;
    const text = `Median is $42. I recommend offering $${forged} USD based on vibes.`;
    const g = guardInvention({
      text,
      structured_result: AUCTION_STRUCTURED,
      claim_ledger: ledgerFor(AUCTION_STRUCTURED),
    });
    if (!g.ok) rejected += 1;
    else escaped += 1;
  }
  assert.equal(escaped, 0);
  assert.equal(rejected, 1000);
});

test('supported numbers from allowlist pass', () => {
  const text = 'Completed-sale median is 42 USD across 3 sales. Seller floor 40. Fair range 35 to 50.';
  const g = guardInvention({
    text,
    structured_result: AUCTION_STRUCTURED,
    claim_ledger: ledgerFor(AUCTION_STRUCTURED),
  });
  assert.equal(g.ok, true);
});

test('near-bound 45 between floor 40 and fair_high 50 remains rejected as recommended price', () => {
  const text = 'I recommend a sale at $45 USD.';
  const g = guardInvention({
    text,
    structured_result: AUCTION_STRUCTURED,
    claim_ledger: ledgerFor(AUCTION_STRUCTURED),
  });
  assert.equal(g.ok, false);
  assert.ok(g.violations.some((v) => Number(v.claim?.value) === 45));
});

test('semantic typing: watcher count 45 does not authorize price 45', () => {
  const structured = { ...AUCTION_STRUCTURED, watchers: 45 };
  const text = 'There are 45 watchers. I recommend offering $45 USD.';
  const g = guardInvention({
    text,
    structured_result: structured,
    claim_ledger: ledgerFor(structured),
  });
  assert.equal(g.ok, false);
  assert.ok(
    g.violations.some(
      (v) => Number(v.claim?.value) === 45 && v.claim?.claim_type === CLAIM_TYPES.RECOMMENDED_PRICE,
    ),
  );
});

test('best-bid money amount is not typed as bid_count', () => {
  const text = 'Our current best bid is $40 USD.';
  const claim = { kind: 'money', raw: '$40', value: 40, index: text.indexOf('$40') };
  assert.notEqual(inferClaimType(text, claim), CLAIM_TYPES.BID_COUNT);
});

test('retry provenance: independent attempt hashes and parent linkage', () => {
  const a0 = buildModelInvocationRow({
    model_invocation_id: crypto.randomUUID(),
    attempt_index: 0,
    raw_output_hash: crypto.createHash('sha256').update('attempt0').digest('hex'),
    guard_verdict: 'REJECT',
    outcome: 'timeout',
  });
  const a1 = buildModelInvocationRow({
    model_invocation_id: crypto.randomUUID(),
    parent_invocation_id: a0.model_invocation_id,
    attempt_index: 1,
    raw_output_hash: crypto.createHash('sha256').update('attempt1').digest('hex'),
    guard_verdict: 'PASS',
    outcome: 'accepted',
  });
  assert.notEqual(a0.model_invocation_id, a1.model_invocation_id);
  assert.equal(a1.parent_invocation_id, a0.model_invocation_id);
  assert.notEqual(a0.raw_output_hash, a1.raw_output_hash);
  assert.notEqual(a0.completed_at, null);
});

test('failure scanner: one session failure for v3 invention (no double count)', () => {
  const failureRow = {
    session_id: 'rmf-05895',
    turn_index: 0,
    reason: 'INVENTION_GUARD',
    unsupported_claims_escaped: false,
    violations: [
      {
        code: 'UNSUPPORTED_NUMERIC_VALUE',
        claim: { value: 45, index: 53 },
      },
    ],
  };
  const hard = [
    {
      session_id: 'rmf-05895',
      reason: 'INVENTION_GUARD',
      unsupported_claims_escaped: false,
      violations: failureRow.violations,
    },
  ];
  const scan = scanInventionGuardFailures([failureRow], hard);
  assert.equal(scan.failed_session_count, 1);
  assert.equal(scan.guard_rejected_model_turns, 1);
  assert.deepEqual(scan.unsupported_numeric_values, [45]);
  assert.equal(scan.unsupported_claims_escaped, 0);
  assert.ok(scan.violation_codes.includes('UNSUPPORTED_NUMERIC_VALUE'));
  assert.ok(scan.reasons.includes('INVENTION_GUARD'));
});
