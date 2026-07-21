/**
 * Phase E — planner, retrieval honesty, synthesis, invention guard, actions, pipeline.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { planQuery, RESPONSE_DEPTHS } from '../scripts/lib/phase34-query-planner.mjs';
import {
  retrieve,
  retrieveForPlan,
  createRetrievalStores,
} from '../scripts/lib/phase34-retrieval.mjs';
import {
  median,
  count,
  percentChange,
  runCalculations,
  CALC_IDS,
} from '../scripts/lib/phase34-deterministic-analytics.mjs';
import {
  synthesizeDeterministic,
  synthesizeGrounded,
  validateSynthesisOutput,
  REQUIRED_ANSWER_FIELDS,
} from '../scripts/lib/phase34-grounded-synthesis.mjs';
import {
  guardInvention,
  guardWithRetry,
  assertInventionGuardPass,
} from '../scripts/lib/phase34-invention-guard.mjs';
import {
  ActionToolRuntime,
  createActionToolRuntime,
  ACTION_TOOL_NAMES,
} from '../scripts/lib/phase34-action-tools.mjs';
import { runIntelligencePipeline } from '../scripts/lib/phase34-intelligence-pipeline.mjs';

test('E1: query planner structured plan + compound + follow-up refinement', () => {
  const plan = planQuery({
    request_text:
      'What is the Blue Note market analytics median over the last 90 days and also draft a negotiation reply',
    session_facts: [
      { key: 'shipping_amount_usd', value: 6, active: true },
      { key: 'currency', value: 'USD', active: true },
    ],
  });
  assert.equal(plan.capability, 'market_analytics');
  assert.ok(plan.calculations.includes('calc:median'));
  assert.ok(plan.evidence_types.includes('settlements'));
  assert.ok(RESPONSE_DEPTHS.includes(plan.response_depth));
  assert.ok(plan.compound_intents.length >= 1);
  assert.ok(plan.tools.includes('insert_negotiation_draft') ||
    plan.compound_intents.some((c) => c.tools.includes('insert_negotiation_draft')));
  assert.equal(plan.constraints.shipping_amount_usd, 6);

  const follow = planQuery({
    request_text: 'Actually shipping is $5 and exact pressing only',
    prior_plan: plan,
    is_follow_up: true,
    session_facts: [
      { key: 'shipping_amount_usd', value: 5, active: true },
      { key: 'exact_pressing', value: true, active: true },
    ],
  });
  assert.equal(follow.is_follow_up, true);
  assert.equal(follow.constraints.exact_pressing, true);
  assert.equal(follow.constraints.shipping_amount_usd, 5);
  assert.ok(follow.refinements.length >= 1);
});

test('E2: hybrid honesty — vector unavailable is not labeled hybrid', () => {
  const stores = createRetrievalStores({
    catalog: [
      { id: 'c1', title: 'Kind of Blue', artist: 'Miles Davis', tags: [] },
      { id: 'c2', title: 'Blue Train', artist: 'John Coltrane', tags: ['picture_disc'] },
    ],
    settlements: [
      {
        id: 's1',
        market_event_id: 's1',
        title: 'Kind of Blue sale',
        price: 40,
        event_type: 'SALE_COMPLETED',
        sale_kind: 'sold',
      },
    ],
  });

  const hybrid = retrieve({
    query: 'Kind of Blue',
    stores,
    store_names: ['catalog'],
    requested_mode: 'hybrid',
    filters: { exclude_picture_disc: true },
  });
  assert.equal(hybrid.requested_mode, 'hybrid');
  assert.notEqual(hybrid.executed_mode, 'hybrid');
  assert.match(hybrid.executed_mode, /vector_unavailable|keyword/);
  assert.equal(hybrid.fallback_reason, 'VECTOR_INDEX_UNAVAILABLE');
  assert.equal(hybrid.vector_executed, false);
  assert.ok(hybrid.candidate_ids.includes('c1'));
  assert.ok(!hybrid.candidate_ids.includes('c2'));

  // With a real vector callable, executed_mode may be hybrid
  const withVector = retrieve({
    query: 'Kind of Blue',
    stores,
    store_names: ['catalog'],
    requested_mode: 'hybrid',
    vectorSearch: (q, docs) => ({
      executed: true,
      results: docs.filter((d) => /kind of blue/i.test(d.title)).map((doc) => ({ doc, score: 0.9 })),
    }),
  });
  assert.equal(withVector.executed_mode, 'hybrid');
  assert.equal(withVector.vector_executed, true);
  assert.equal(withVector.fallback_reason, null);
});

test('E3: deterministic analytics helpers for calc:* IDs', () => {
  assert.equal(median([10, 30, 20]), 20);
  assert.equal(median([10, 20]), 15);
  assert.equal(median([]), null);
  assert.equal(count([1, 2, 3]), 3);
  assert.equal(percentChange(100, 110), 10);
  assert.equal(percentChange(0, 10), null);
  const ran = runCalculations([CALC_IDS.MEDIAN, CALC_IDS.COUNT, CALC_IDS.PERCENT_CHANGE], {
    values: [40, 42, 50],
    items: [1, 2, 3],
    prior: 40,
    current: 50,
  });
  assert.equal(ran.find((r) => r.deterministic_calculation_id === 'calc:median').value, 42);
  assert.equal(ran.find((r) => r.deterministic_calculation_id === 'calc:count').value, 3);
  assert.equal(ran.find((r) => r.deterministic_calculation_id === 'calc:percent_change').value, 25);
});

test('E4: deterministic synthesis produces required fields without inventing numbers', () => {
  const out = synthesizeDeterministic({
    capability: 'market_analytics',
    structured_result: {
      sold_count: 3,
      sold_median: 42,
      currency: 'USD',
      conclusion: 'Completed-sale median is 42 USD across 3 sales.',
    },
    snapshot: { included_event_ids: ['a', 'b', 'c'], excluded_event_ids: [] },
  });
  for (const field of REQUIRED_ANSWER_FIELDS) {
    assert.ok(Object.prototype.hasOwnProperty.call(out, field), field);
  }
  validateSynthesisOutput(out);
  assert.equal(out.model_invoked, false);
  assert.match(out.direct_answer, /42/);
  assert.doesNotMatch(out.direct_answer, /999/);
  assert.equal(out.key_values.sold_median, 42);

  const empty = synthesizeDeterministic({
    capability: 'valuation',
    structured_result: { sold_count: 0, sample_size: 0 },
    snapshot: { included_event_ids: [], excluded_event_ids: [] },
    honest_limit: true,
  });
  assert.match(empty.direct_answer, /not have enough eligible evidence/i);
  assert.ok(empty.limitations.includes('INSUFFICIENT_EVIDENCE'));
});

test('E4: model tiers fall back without live gateway', async () => {
  const out = await synthesizeGrounded({
    capability: 'valuation',
    tier: 'high-quality',
    structured_result: { fair_low: 30, fair_high: 45, sold_count: 2, currency: 'USD' },
    snapshot: { included_event_ids: ['x', 'y'], excluded_event_ids: [] },
  });
  assert.equal(out.model_invoked, false);
  assert.equal(out.fallback_tier, 'deterministic-only');
  assert.ok(out.limitations.some((l) => /MODEL_GATEWAY_UNAVAILABLE/.test(l)));
});

test('E5: invention guard fail-closed on unsupported values and wrong currency', () => {
  const structured = { sold_count: 2, sold_median: 40, currency: 'USD' };
  const bad = guardInvention({
    text: 'Median is $999 USD based on exact pressing comps.',
    structured_result: structured,
    subject_resolution: { match_status: 'MATCHED_RELEASE_ONLY' },
    constraints: { currency: 'USD' },
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.violations.some((v) => v.code === 'UNSUPPORTED_NUMERIC_VALUE'));
  assert.ok(bad.violations.some((v) => v.code === 'EXACT_PRESSING_FROM_RELEASE_ONLY'));

  const wrongFx = guardInvention({
    text: 'Median is 40 EUR.',
    structured_result: structured,
    constraints: { currency: 'USD' },
  });
  assert.equal(wrongFx.ok, false);
  assert.ok(wrongFx.violations.some((v) => v.code === 'WRONG_CURRENCY'));

  const good = guardInvention({
    text: 'Completed-sale median is 40 USD across 2 sales.',
    structured_result: structured,
    constraints: { currency: 'USD' },
  });
  assert.equal(good.ok, true);
  assertInventionGuardPass(good);
});

test('E5: invention guard retry-once then deterministic fallback', async () => {
  const structured = { sold_count: 1, sold_median: 40, currency: 'USD' };
  let retries = 0;
  const result = await guardWithRetry({
    text: 'Worth exactly $777 tomorrow.',
    structured_result: structured,
    constraints: { currency: 'USD' },
    retryOnce: async () => {
      retries += 1;
      return 'Still inventing $666.';
    },
    synthesisInput: {
      capability: 'valuation',
      structured_result: structured,
      snapshot: { included_event_ids: ['e1'], excluded_event_ids: [] },
    },
  });
  assert.equal(retries, 1);
  assert.equal(result.used_fallback, true);
  assert.ok(result.fallback_synthesis);
  assert.doesNotMatch(result.fallback_synthesis.direct_answer, /777|666/);
});

test('E6: action tools require confirmation; insert ≠ send', () => {
  const rt = createActionToolRuntime();
  assert.ok(ACTION_TOOL_NAMES.includes('insert_negotiation_draft'));

  const preview = rt.invoke(
    'insert_negotiation_draft',
    { body: 'Thanks for the offer of $35.', thread_id: 't1' },
    { principal_id: 'seller_a' },
  );
  assert.equal(preview.dry_run, true);
  assert.equal(preview.executed, false);
  assert.equal(preview.message_sent, false);

  assert.throws(
    () =>
      rt.invoke(
        'insert_negotiation_draft',
        {
          dry_run: false,
          body: 'Thanks for the offer of $35.',
          thread_id: 't1',
          idempotency_key: 'idem-key-001',
        },
        { principal_id: 'seller_a' },
      ),
    /ACTION_CONFIRMATION_REQUIRED/,
  );

  const inserted = rt.invoke(
    'insert_negotiation_draft',
    {
      dry_run: false,
      confirm: true,
      body: 'Thanks for the offer of $35.',
      thread_id: 't1',
      idempotency_key: 'idem-key-001',
    },
    { principal_id: 'seller_a' },
  );
  assert.equal(inserted.executed, true);
  assert.equal(inserted.message_sent, false);
  assert.equal(inserted.status, 'INSERTED');

  const replay = rt.invoke(
    'insert_negotiation_draft',
    {
      dry_run: false,
      confirm: true,
      body: 'Thanks for the offer of $35.',
      thread_id: 't1',
      idempotency_key: 'idem-key-001',
    },
    { principal_id: 'seller_a' },
  );
  assert.equal(replay.idempotent_replay, true);
  assert.ok(rt.audit_log.length >= 3);
});

test('E7: pipeline end-to-end with empty evidence honest limit', async () => {
  const result = await runIntelligencePipeline({
    request_text: 'Give me market analytics for this obscure pressing last 90 days',
    capability: 'market_analytics',
    stores: createRetrievalStores(),
    candidates: [],
    synthesis_tier: 'deterministic-only',
    request: { request_id: 'req-e7', session_id: 'sess-e7' },
  });

  assert.equal(result.pipeline_version, 'phase34-intelligence-pipeline-v1');
  assert.equal(result.plan.capability, 'market_analytics');
  assert.ok(result.snapshot.evidence_snapshot_id);
  assert.ok(result.snapshot.evidence_snapshot_hash);
  assert.equal(result.structured_result.sold_count, 0);
  assert.match(result.synthesis.direct_answer, /not have enough eligible evidence/i);
  assert.ok(result.synthesis.limitations.includes('INSUFFICIENT_EVIDENCE'));
  assert.ok(result.envelope.evidence_snapshot_id);
  assert.ok(result.envelope.claim_ledger_id);
  assert.equal(result.envelope.safety.model_weight_training, 'NO');
  // Hybrid not falsely claimed
  if (result.retrieval.requested_mode === 'hybrid') {
    assert.notEqual(result.retrieval.executed_mode, 'hybrid');
  }
});

test('E7: pipeline with settlements produces grounded envelope', async () => {
  const stores = createRetrievalStores({
    settlements: [
      {
        id: 'sale-1',
        market_event_id: 'sale-1',
        event_type: 'SALE_COMPLETED',
        sale_kind: 'sold',
        price: 40,
        currency: 'USD',
        occurred_at: '2026-06-01T00:00:00.000Z',
        rights_status: 'first_party',
        release_id: 'r1',
      },
      {
        id: 'sale-2',
        market_event_id: 'sale-2',
        event_type: 'SALE_COMPLETED',
        sale_kind: 'sold',
        price: 44,
        currency: 'USD',
        occurred_at: '2026-06-15T00:00:00.000Z',
        rights_status: 'first_party',
        release_id: 'r1',
      },
    ],
  });

  const result = await runIntelligencePipeline({
    request_text: 'market analytics median for release r1',
    capability: 'market_analytics',
    stores,
    candidates: stores.settlements,
    subject: { release_id: 'r1' },
    requested_mode: 'keyword',
    synthesis_tier: 'deterministic-only',
  });

  assert.ok(result.structured_result.sold_count >= 1);
  assert.ok(result.envelope.customer_summary || result.envelope.answer);
  assert.equal(result.invention_guard.used_fallback, false);
});
