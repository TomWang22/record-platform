/**
 * Phase 34 context depth 4/8/16/32 — real context assembly + leakage gates.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNegotiationContextPack,
  evaluateNegotiationContextTiers,
  CONTEXT_TIERS,
} from '../scripts/lib/phase34-negotiation-context.mjs';
import {
  buildGoldenFactProgression,
  GOLDEN_TURN_INTENTS,
} from '../scripts/lib/phase34-negotiation-fact-invariants.mjs';
import {
  nearestRankPercentiles,
  timingField,
  MEASUREMENT_STATUS,
  pipelineStageCompleteness,
  spanSetForTurn,
  instrumentSpans,
} from '../scripts/lib/phase34-source-verification-telemetry.mjs';

test('deleted and cross-thread messages are excluded from context pack', () => {
  const pack = buildNegotiationContextPack({
    session_id: 's1',
    thread_id: 't1',
    turn_id: 'turn-1',
    participant_side: 'seller',
    user_intent: 'They offered $35 for my $41 listing. What should I do?',
    messages: [
      { message_id: 'ok', thread_id: 't1', body: 'hello', deletion_state: 'ACTIVE' },
      { message_id: 'gone', thread_id: 't1', body: 'secret', deletion_state: 'DELETED' },
      { message_id: 'other', thread_id: 't-other', body: 'leak', deletion_state: 'ACTIVE' },
    ],
  });
  assert.equal(pack.recent_message_count, 1);
  assert.ok(pack.facts_excluded.some((e) => e.reason === 'DELETED_MESSAGE'));
  assert.ok(pack.facts_excluded.some((e) => e.reason === 'CROSS_THREAD'));
  assert.equal(pack.structured_facts.offer_amount_usd, 35);
  assert.equal(pack.structured_facts.listing_price_usd, 41);
});

test('context tier constants cover 4/8/16/32 with 16k and 32k targets', () => {
  assert.equal(CONTEXT_TIERS.basic.executed_turns, 4);
  assert.equal(CONTEXT_TIERS.normal.executed_turns, 8);
  assert.equal(CONTEXT_TIERS.long.executed_turns, 16);
  assert.equal(CONTEXT_TIERS.stress.executed_turns, 32);
  assert.equal(CONTEXT_TIERS.long.target_effective_tokens, 16_000);
  assert.equal(CONTEXT_TIERS.stress.target_effective_tokens, 32_000);
});

test('4/8/16/32 context depth: retention, corrections, zero leakage', () => {
  const rows = evaluateNegotiationContextTiers({
    session_id: 'depth',
    thread_id: 't-depth',
    participant_side: 'seller',
  });
  assert.equal(rows.length, 4);
  for (const row of rows) {
    assert.ok(row.input_token_estimate > 0);
    assert.equal(row.context_retention_accuracy, 1);
    assert.equal(row.correction_precedence_accuracy, 1);
    assert.equal(row.summary_drift_count, 0);
    assert.equal(row.false_memory_count, 0);
    assert.equal(row.deleted_fact_influence_count, 0);
    assert.equal(row.cross_thread_leakage_count, 0);
    assert.equal(row.cross_user_leakage_count, 0);
    assert.equal(row.leakage_gates_ok, true);
    assert.equal(row.facts.listing_price_usd, 41);
    if (row.executed_turns >= 8) {
      assert.equal(row.facts.offer_amount_usd, 36);
    } else {
      assert.equal(row.facts.offer_amount_usd, 35);
    }
    if (row.executed_turns >= 3) {
      assert.equal(row.facts.seller_floor_usd, 37);
    }
  }
});

test('golden fact progression retains floor through turn 4', () => {
  const prog = buildGoldenFactProgression(GOLDEN_TURN_INTENTS);
  assert.equal(prog.correction_precedence_ok, true);
  assert.equal(prog.turns[3].facts_after.seller_floor_usd, 37);
  assert.equal(prog.turns[3].facts_after.request_draft, true);
});

test('nearest-rank percentiles: p99.9 NOT_ESTIMABLE for small n', () => {
  const p = nearestRankPercentiles([10, 20, 30, 40, 50]);
  assert.equal(p.n, 5);
  assert.ok(p.p50 != null);
  assert.ok(p.p100 === 50);
  assert.equal(p.p99_9, null);
  assert.equal(p.p99_9_status, MEASUREMENT_STATUS.NOT_ESTIMABLE);
  const empty = timingField(null);
  assert.equal(empty.value_us, null);
  assert.equal(empty.measurement_status, MEASUREMENT_STATUS.NOT_INSTRUMENTED);
});

test('pipeline span completeness never fabricates zeros', () => {
  let spans = spanSetForTurn({ trace_id: 'tr', session_id: 's', turn_index: 0 });
  spans = instrumentSpans(spans, {
    'browser.action': { duration_us: 1_200_000 },
  });
  const c = pipelineStageCompleteness(spans);
  assert.equal(c.required, spans.length);
  assert.ok(c.instrumented >= 1);
  const action = c.rows.find((r) => r.name === 'browser.action');
  assert.equal(action.duration_us, 1_200_000);
  const uninstrumented = c.rows.find((r) => r.name === 'authorization.check');
  assert.equal(uninstrumented.duration_us, null);
  assert.equal(uninstrumented.measurement_status, MEASUREMENT_STATUS.NOT_INSTRUMENTED);
});
