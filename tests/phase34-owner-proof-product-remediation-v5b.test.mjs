import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  LATENCY_MEASUREMENT_STATUS,
  LATENCY_REPRESENTATIVE_STATUS,
  PERCENTILE_SUPPORT,
  summarizeLatency,
} from '../scripts/lib/phase34-latency-summary.mjs';
import {
  assertScreenshotDistinctness,
  isLoadingScreenshotRow,
  DUPLICATE_SCREENSHOT_MASQUERADING_AS_DISTINCT_STATE,
} from '../scripts/lib/phase34-product-screenshot-distinctness.mjs';
import { stitchPngsVertically } from '../scripts/lib/phase34-png-composite.mjs';
import { analyzeNegotiation } from '../scripts/lib/phase33d-negotiation.mjs';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('complete schedule plus blocked acceptance is not an aborted latency run', () => {
  const samples = Array.from({ length: 27 }, (_, i) => 800 + i * 100);
  const summary = summarizeLatency(samples, {
    plannedTurns: 27,
    runCompleted: true,
    runAborted: false,
    ownerProofSchedule: true,
    acceptanceStatus: 'BLOCKED_POST_EXECUTION',
    acceptanceFailureClass: 'SCREENSHOT_AND_PACKAGE_GATES',
  });
  assert.equal(summary.run_completed, true);
  assert.equal(summary.run_aborted, false);
  assert.equal(summary.schedule_coverage, '27/27');
  assert.equal(
    summary.measurement_status,
    LATENCY_MEASUREMENT_STATUS.COMPLETE_OWNER_PROOF_SCHEDULE,
  );
  assert.equal(
    summary.representative_status,
    LATENCY_REPRESENTATIVE_STATUS.OWNER_PROOF_ONLY,
  );
  assert.equal(summary.acceptance_status, 'BLOCKED_POST_EXECUTION');
  assert.equal(summary.acceptance_failure_class, 'SCREENSHOT_AND_PACKAGE_GATES');
  assert.equal(summary.percentiles.p100.support, PERCENTILE_SUPPORT.OBSERVED_MAX_ONLY);
  assert.equal(summary.percentiles.p99.support, PERCENTILE_SUPPORT.NOT_ESTIMABLE);
  assert.doesNotMatch(summary.note, /PARTIAL_ABORTED/);
});

test('identical loading frames do not fail material distinctness', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase34-distinct-'));
  const a = path.join(dir, 'loading-t2.png');
  const b = path.join(dir, 'loading-t3.png');
  fs.writeFileSync(a, TINY_PNG);
  fs.writeFileSync(b, TINY_PNG);
  assert.equal(
    isLoadingScreenshotRow({ label: 'negotiation_assistance:loading:turn2' }),
    true,
  );
  assert.doesNotThrow(() =>
    assertScreenshotDistinctness(
      [
        { path: a, label: 'negotiation_assistance:loading:turn2', state: 'loading' },
        { path: b, label: 'negotiation_assistance:loading:turn3', state: 'loading' },
      ],
      { maxExactDuplicates: 0 },
    ),
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('identical terminal frames still fail material distinctness', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase34-distinct-term-'));
  const a = path.join(dir, 'ready-t2.png');
  const b = path.join(dir, 'ready-t3.png');
  fs.writeFileSync(a, TINY_PNG);
  fs.writeFileSync(b, TINY_PNG);
  assert.throws(
    () =>
      assertScreenshotDistinctness(
        [
          { path: a, label: 'negotiation_assistance:ready:turn2', state: 'ready' },
          { path: b, label: 'negotiation_assistance:ready:turn3', state: 'ready' },
        ],
        { maxExactDuplicates: 0 },
      ),
    (err) => err.code === DUPLICATE_SCREENSHOT_MASQUERADING_AS_DISTINCT_STATE,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('png composite stitches multiple sources', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase34-composite-'));
  const a = path.join(dir, 'a.png');
  const b = path.join(dir, 'b.png');
  const out = path.join(dir, '18-honest-limits-scarcity-valuation.png');
  fs.writeFileSync(a, TINY_PNG);
  fs.writeFileSync(b, TINY_PNG);
  const stitched = stitchPngsVertically([a, b], out, {
    labels: ['Honest limit — scarcity', 'Honest limit — valuation'],
  });
  assert.ok(fs.existsSync(out));
  assert.ok(stitched.sha256);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('owner-proof negotiation with offer/ask produces usable draft without abstain contradiction', () => {
  const out = analyzeNegotiation({
    participant_side: 'seller',
    asking_price: 41,
    offers: [{ amount: 35 }],
    authorized_thread_id: 'thread-owner-proof-1',
    requesting_principal_fixture: 'seller-1',
    thread: {
      thread_id: 'thread-owner-proof-1',
      participant_principals: ['seller-1', 'buyer-1'],
    },
    user_intent: 'They offered $35 for my $41 listing. What should I do?',
    force_negotiation_market_floor: true,
  });
  assert.equal(out.envelope.abstention.abstained, false);
  assert.ok(out.result.strategy);
  assert.ok(out.result.draft_reply);
  assert.doesNotMatch(String(out.result.summary), /Abstaining from negotiation/i);
  assert.doesNotMatch(String(out.result.draft_reply), /should not advise further/i);
  assert.match(String(out.result.draft_send_customer || ''), /has not been sent/i);
});

test('four-turn negotiation draft includes condition shipping and floor', () => {
  const t1 = analyzeNegotiation({
    participant_side: 'seller',
    asking_price: 41,
    offers: [{ amount: 35 }],
    authorized_thread_id: 'thread-owner-proof-1',
    requesting_principal_fixture: 'seller-1',
    thread: {
      thread_id: 'thread-owner-proof-1',
      participant_principals: ['seller-1', 'buyer-1'],
    },
    user_intent: 'They offered $35 for my $41 listing. What should I do?',
    force_negotiation_market_floor: true,
    session_id: 'sess-1',
    turn_index: 0,
  });
  const t2 = analyzeNegotiation({
    participant_side: 'seller',
    asking_price: 41,
    offers: [{ amount: 35 }],
    authorized_thread_id: 'thread-owner-proof-1',
    requesting_principal_fixture: 'seller-1',
    thread: {
      thread_id: 'thread-owner-proof-1',
      participant_principals: ['seller-1', 'buyer-1'],
    },
    user_intent: 'The sleeve has a seam split, and shipping will cost me $6.',
    force_negotiation_market_floor: true,
    session_id: 'sess-1',
    turn_index: 1,
    prior_turns: [{ summary: t1.result.summary, intent: t1.result.summary }],
  });
  const t3 = analyzeNegotiation({
    participant_side: 'seller',
    asking_price: 41,
    offers: [{ amount: 35 }],
    authorized_thread_id: 'thread-owner-proof-1',
    requesting_principal_fixture: 'seller-1',
    thread: {
      thread_id: 'thread-owner-proof-1',
      participant_principals: ['seller-1', 'buyer-1'],
    },
    user_intent: 'I would accept $37, but I do not want to sound desperate.',
    force_negotiation_market_floor: true,
    session_id: 'sess-1',
    turn_index: 2,
    prior_turns: [
      { summary: t1.result.summary },
      { summary: t2.result.summary },
    ],
  });
  const t4 = analyzeNegotiation({
    participant_side: 'seller',
    asking_price: 41,
    offers: [{ amount: 35 }],
    authorized_thread_id: 'thread-owner-proof-1',
    requesting_principal_fixture: 'seller-1',
    thread: {
      thread_id: 'thread-owner-proof-1',
      participant_principals: ['seller-1', 'buyer-1'],
    },
    user_intent: 'Draft the reply.',
    force_negotiation_market_floor: true,
    session_id: 'sess-1',
    turn_index: 3,
    prior_turns: [
      { summary: t1.result.summary },
      { summary: t2.result.summary },
      { summary: t3.result.summary },
    ],
  });
  assert.equal(t4.envelope.abstention.abstained, false);
  assert.match(String(t4.result.draft_reply), /seam split|\$38|\$37/i);
  assert.notEqual(t1.result.strategy, t2.result.strategy);
  assert.notEqual(t2.result.draft_reply, t4.result.draft_reply);
});
