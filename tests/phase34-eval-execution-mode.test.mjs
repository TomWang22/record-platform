import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  EVAL_MODE,
  shouldStopOnFailure,
  assertInvocationLedgerInvariant,
  isFailureLedgerRow,
  countFailureLedgerRows,
  appendModelInvocationLedger,
  emptyQualitySoakCounters,
} from '../scripts/lib/phase34-eval-execution-mode.mjs';
import { guardInvention } from '../scripts/lib/phase34-invention-guard.mjs';

test('SAFETY_CANARY stops on contained invention-guard rejection', () => {
  assert.equal(
    shouldStopOnFailure({
      mode: EVAL_MODE.SAFETY_CANARY,
      failure: { reason: 'INVENTION_GUARD', unsupported_claims_escaped: false },
    }),
    true,
  );
});

test('QUALITY_SOAK continues after contained invention-guard rejection', () => {
  assert.equal(
    shouldStopOnFailure({
      mode: EVAL_MODE.QUALITY_SOAK,
      failure: { reason: 'INVENTION_GUARD', unsupported_claims_escaped: false },
    }),
    false,
  );
});

test('QUALITY_SOAK still stops when unsupported claim escapes', () => {
  assert.equal(
    shouldStopOnFailure({
      mode: EVAL_MODE.QUALITY_SOAK,
      failure: { reason: 'INVENTION_GUARD', unsupported_claims_escaped: true },
    }),
    true,
  );
  assert.equal(
    shouldStopOnFailure({
      mode: EVAL_MODE.QUALITY_SOAK,
      failure: { reason: 'UNSUPPORTED_CLAIM_ESCAPED' },
    }),
    true,
  );
});

test('invocation ledger invariant holds for accepted + rejected + timeout split', () => {
  const r = assertInvocationLedgerInvariant({
    model_invocation_ledger_rows: 10,
    model_invoked_turns: 10,
    accepted_model_turns: 7,
    guard_rejected_turns: 2,
    timeout_turns: 1,
    transport_failure_turns: 0,
  });
  assert.equal(r.ok, true);
});

test('invocation ledger invariant fails on missing rows', () => {
  const r = assertInvocationLedgerInvariant({
    model_invocation_ledger_rows: 0,
    model_invoked_turns: 5,
    accepted_model_turns: 5,
    guard_rejected_turns: 0,
    timeout_turns: 0,
    transport_failure_turns: 0,
  });
  assert.equal(r.ok, false);
});

test('failure scanner recognizes v3 reason+violations schema', () => {
  const v3 = {
    session_id: 'rmf-05895',
    turn_index: 0,
    capability: 'auction_intelligence',
    violations: [
      {
        code: 'UNSUPPORTED_NUMERIC_VALUE',
        claim: { kind: 'number', raw: '45', value: 45, index: 53 },
        message: 'unsupported value 45',
      },
    ],
    answer: '…sale at $45 USD…',
  };
  assert.equal(isFailureLedgerRow(v3), true);

  const tmp = path.join(os.tmpdir(), `phase34-fail-${Date.now()}.jsonl`);
  fs.writeFileSync(tmp, `${JSON.stringify(v3)}\n`);
  const counted = countFailureLedgerRows(tmp);
  assert.equal(counted.rows, 1);
  fs.unlinkSync(tmp);
});

test('empty failures.jsonl is INITIALIZED_NO_ROWS not an error', () => {
  const tmp = path.join(os.tmpdir(), `phase34-fail-empty-${Date.now()}.jsonl`);
  fs.writeFileSync(tmp, '');
  const counted = countFailureLedgerRows(tmp);
  assert.equal(counted.rows, 0);
  assert.equal(counted.state, 'INITIALIZED_NO_ROWS');
  fs.unlinkSync(tmp);
});

test('rmf-05895 style invention is TRUE_MODEL_INVENTION against auction allowlist', () => {
  const structured = {
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
  const text =
    'We have 3 eligible sales with a median price of $42, and our current best bid is $40 USD. Our draft message suggests a sale at $45 USD.';
  const claim_ledger = {
    entries: Object.entries(structured)
      .filter(([, v]) => typeof v === 'number')
      .map(([k, v]) => ({
        claim_type: k,
        normalized_claim_value: v,
        verification_result: 'SUPPORTED',
      })),
  };
  const g = guardInvention({ text, structured_result: structured, claim_ledger });
  assert.equal(g.ok, false);
  assert.ok(g.violations.some((v) => v.claim?.value === 45));
  // 45 not in allowlist — true invention
  assert.equal([3, 4, 12, 35, 40, 42, 50].includes(45), false);
});

test('appendModelInvocationLedger writes one row per call (unbuffered)', () => {
  const tmp = path.join(os.tmpdir(), `phase34-inv-${Date.now()}.jsonl`);
  appendModelInvocationLedger(tmp, { inference_id: 'a', outcome: 'accepted' });
  appendModelInvocationLedger(tmp, { inference_id: 'b', outcome: 'guard_rejected' });
  const lines = fs.readFileSync(tmp, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  fs.unlinkSync(tmp);
});

test('quality soak counters shape', () => {
  const c = emptyQualitySoakCounters();
  assert.equal(c.unsupported_claims_escaped, 0);
  assert.equal(c.model_generations_guard_rejected, 0);
  assert.equal(c.safe_fallback_success, 0);
  assert.equal(c.customer_request_failures, 0);
  assert.equal(c.guard_rejected_contained, 0);
  assert.equal(c.verified_fallback_delivered, 0);
  assert.equal(c.model_timeout, 0);
});

test('attempt-level ledger invariant allows retries above turn count', () => {
  const r = assertInvocationLedgerInvariant({
    model_invocation_ledger_rows: 3,
    successful_attempts: 1,
    guard_rejected_attempts: 0,
    timed_out_attempts: 2,
    transport_failed_attempts: 0,
  });
  assert.equal(r.ok, true);
  assert.equal(r.level, 'attempt');
});

test('appendModelInvocationLedger normalizes schema_version', () => {
  const tmp = path.join(os.tmpdir(), `phase34-inv-schema-${Date.now()}.jsonl`);
  appendModelInvocationLedger(tmp, { inference_id: 'x', outcome: 'accepted' });
  const row = JSON.parse(fs.readFileSync(tmp, 'utf8').trim());
  assert.equal(row.schema_version, 'phase34-model-invocation-v1');
  assert.equal(row.outcome, 'accepted');
  fs.unlinkSync(tmp);
});
