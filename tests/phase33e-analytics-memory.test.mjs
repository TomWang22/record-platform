import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeMarketAnalytics } from '../scripts/lib/phase33e-analytics.mjs';
import { analyzeMemory } from '../scripts/lib/phase33e-memory.mjs';
import { evaluateScenario, runCapability } from '../scripts/lib/phase33e-intelligence.mjs';

function sold(id, price, extra = {}) {
  return {
    evidence_id: id,
    source_id: id,
    source_type: 'sale',
    sale_kind: 'sold',
    price,
    currency: 'USD',
    pressing_id: 'p1',
    release_id: 'r1',
    observed_at: '2026-06-01T12:00:00.000Z',
    retrieved_at: '2026-06-01T12:00:00.000Z',
    summary: id,
    authorization_scope: 'authenticated_market',
    privacy_class: 'MARKETPLACE_SHARED',
    deletion_state: 'ACTIVE',
    days_to_sale: 8,
    ...extra,
  };
}

test('sold versus asking separation', () => {
  const out = analyzeMarketAnalytics({
    requesting_principal_fixture: 'principal_a',
    analytics_mode: 'price_distribution',
    subject: { pressing_id: 'p1', release_id: 'r1' },
    events: [
      sold('s1', 30),
      {
        ...sold('a1', 80),
        sale_kind: 'asking',
        source_type: 'listing',
      },
    ],
  });
  assert.equal(out.result.sold_count, 1);
  assert.equal(out.result.pricing.sold_median, 30);
  assert.equal(out.result.pricing.asking_median, 80);
  assert.equal(out.diagnostics.asking_as_sold, 0);
});

test('active versus completed auction separation', () => {
  const out = analyzeMarketAnalytics({
    requesting_principal_fixture: 'principal_a',
    analytics_mode: 'auction_trend',
    subject: { pressing_id: 'p1', release_id: 'r1' },
    events: [
      {
        ...sold('act', 22),
        source_type: 'auction',
        auction_state: 'active',
        sale_kind: 'asking',
      },
      {
        ...sold('done', 31),
        source_type: 'auction',
        auction_state: 'completed',
        sale_kind: 'sold',
      },
    ],
  });
  assert.equal(out.result.auction_activity.active, 1);
  assert.equal(out.result.auction_activity.completed, 1);
  assert.equal(out.diagnostics.active_as_completed, 0);
});

test('exact pressing excludes wrong pressing', () => {
  const out = analyzeMarketAnalytics({
    requesting_principal_fixture: 'principal_a',
    analytics_mode: 'pressing_market_summary',
    require_exact_pressing: true,
    subject: { pressing_id: 'p1', release_id: 'r1' },
    events: [sold('ok', 30), sold('wrong', 99, { pressing_id: 'other' })],
  });
  assert.equal(out.result.sample_size, 1);
  assert.ok(out.result.excluded_events.some((e) => e.reason_codes.includes('WRONG_PRESSING')));
  assert.equal(out.diagnostics.wrong_pressing, 0);
});

test('currency conversion failure abstains', () => {
  const out = analyzeMarketAnalytics({
    requesting_principal_fixture: 'principal_a',
    analytics_mode: 'release_market_summary',
    subject: { release_id: 'r1' },
    events: [sold('fx', 1000, { currency: 'JPY' })],
    min_sample: 1,
  });
  assert.equal(out.envelope.abstention.abstained, true);
  assert.ok(out.result.excluded_events.some((e) => e.reason_codes.includes('CONVERSION_UNAVAILABLE')));
});

test('mixed currencies normalize into USD sample', () => {
  const out = analyzeMarketAnalytics({
    requesting_principal_fixture: 'principal_a',
    analytics_mode: 'price_distribution',
    currency: 'USD',
    subject: { release_id: 'r1', pressing_id: 'p1' },
    events: [sold('usd', 30, { currency: 'USD' }), sold('eur', 28, { currency: 'EUR' })],
  });
  assert.equal(out.envelope.abstention.abstained, false);
  assert.equal(out.result.sample_size, 2);
  assert.ok(out.result.price_median != null);
});

test('deleted and stale sources excluded', () => {
  const out = analyzeMarketAnalytics({
    requesting_principal_fixture: 'principal_a',
    analytics_mode: 'liquidity_report',
    subject: { release_id: 'r1', pressing_id: 'p1' },
    events: [
      sold('del', 30, { deleted: true, deletion_state: 'DELETED' }),
      sold('stale', 31, { stale: true }),
      sold('ok', 29),
    ],
  });
  assert.equal(out.result.sample_size, 1);
  assert.equal(out.diagnostics.deleted_source, 0);
});

test('unsupported causal and prediction abstain', () => {
  for (const flag of ['request_causal_claim', 'request_future_price_prediction']) {
    const out = analyzeMarketAnalytics({
      requesting_principal_fixture: 'principal_a',
      analytics_mode: 'release_market_summary',
      subject: { release_id: 'r1' },
      events: [sold('s', 30)],
      [flag]: true,
    });
    assert.equal(out.envelope.abstention.abstained, true);
  }
});

test('unauthorized watchlist/inventory abstain', () => {
  const out = analyzeMarketAnalytics({
    requesting_principal_fixture: 'principal_a',
    analytics_mode: 'watchlist_market_report',
    unauthorized_scope: true,
    owner_principal_fixture: 'principal_other',
    events: [sold('s', 30)],
  });
  assert.equal(out.envelope.abstention.abstained, true);
  assert.ok(out.envelope.abstention.reason_codes.includes('UNAUTHORIZED_SCOPE'));
});

test('methodology contract present with sample size and time range', () => {
  const out = analyzeMarketAnalytics({
    requesting_principal_fixture: 'principal_a',
    analytics_mode: 'collection_report',
    owner_principal_fixture: 'principal_a',
    subject: { release_id: 'r1' },
    events: [sold('s', 30), sold('s2', 34, { observed_at: '2026-06-20T12:00:00.000Z' })],
  });
  assert.ok(out.result.methodology_contract?.version);
  assert.equal(typeof out.result.sample_size, 'number');
  assert.ok(out.result.time_range?.start);
  assert.ok(out.result.liquidity);
});

test('correction precedence prefers newer budget', () => {
  const out = analyzeMemory({
    operation: 'resolve',
    requesting_principal_fixture: 'principal_a',
    thread_id: 'thread_1',
    memory_items: [
      {
        memory_id: 'm1',
        memory_class: 'session',
        owner_fixture: 'principal_a',
        scope: { thread_id: 'thread_1' },
        fact_key: 'budget',
        content: { value: 40 },
        updated_at: '2026-07-01T10:00:00.000Z',
        deletion_state: 'ACTIVE',
        source_turn_ids: ['t1'],
      },
      {
        memory_id: 'm2',
        memory_class: 'session',
        owner_fixture: 'principal_a',
        scope: { thread_id: 'thread_1' },
        fact_key: 'budget',
        content: { value: 32 },
        updated_at: '2026-07-02T10:00:00.000Z',
        deletion_state: 'ACTIVE',
        source_turn_ids: ['t2'],
      },
    ],
  });
  assert.equal(out.result.current_facts.budget, 32);
  assert.ok(!out.result.recalled_items.some((r) => r.memory_id === 'm1' && r.deletion_state === 'ACTIVE'));
});

test('cross-user and cross-thread isolation', () => {
  const crossUser = analyzeMemory({
    operation: 'resolve',
    requesting_principal_fixture: 'principal_a',
    cross_user_attempt: true,
    thread_id: 'thread_1',
    memory_items: [
      {
        memory_id: 'x',
        memory_class: 'session',
        owner_fixture: 'principal_b',
        scope: { thread_id: 'thread_1' },
        fact_key: 'budget',
        content: { value: 10 },
        updated_at: '2026-07-02T10:00:00.000Z',
        deletion_state: 'ACTIVE',
      },
    ],
  });
  assert.equal(crossUser.envelope.abstention.abstained, true);
  assert.equal(crossUser.diagnostics.cross_user_leakage, 0);

  const crossThread = analyzeMemory({
    operation: 'resolve',
    requesting_principal_fixture: 'principal_a',
    thread_id: 'thread_1',
    memory_items: [
      {
        memory_id: 'y',
        memory_class: 'session',
        owner_fixture: 'principal_a',
        scope: { thread_id: 'thread_other' },
        fact_key: 'budget',
        content: { value: 99 },
        updated_at: '2026-07-02T10:00:00.000Z',
        deletion_state: 'ACTIVE',
      },
    ],
  });
  assert.equal(crossThread.result.recalled_items.length, 0);
  assert.equal(crossThread.diagnostics.cross_thread_leakage, 0);
});

test('deleted expired stale and forget propagation', () => {
  const deleted = analyzeMemory({
    operation: 'resolve',
    requesting_principal_fixture: 'principal_a',
    thread_id: 'thread_1',
    memory_items: [
      {
        memory_id: 'd1',
        memory_class: 'session',
        owner_fixture: 'principal_a',
        scope: { thread_id: 'thread_1' },
        fact_key: 'budget',
        content: { value: 32 },
        deletion_state: 'DELETED',
        updated_at: '2026-07-02T10:00:00.000Z',
      },
    ],
  });
  assert.equal(deleted.result.recalled_items.length, 0);

  const forget = analyzeMemory({
    operation: 'forget',
    requesting_principal_fixture: 'principal_a',
    thread_id: 'thread_1',
    forget_memory_ids: ['src'],
    memory_items: [
      {
        memory_id: 'src',
        memory_class: 'session',
        owner_fixture: 'principal_a',
        scope: { thread_id: 'thread_1' },
        fact_key: 'condition',
        content: { value: 'VG+' },
        deletion_state: 'ACTIVE',
        updated_at: '2026-07-02T10:00:00.000Z',
      },
      {
        memory_id: 'der',
        memory_class: 'derived_market_state',
        owner_fixture: 'principal_a',
        scope: { thread_id: 'thread_1' },
        derived_from: 'src',
        fact_key: 'condition_summary',
        content: { value: 'VG+' },
        deletion_state: 'ACTIVE',
        updated_at: '2026-07-02T10:00:00.000Z',
      },
    ],
  });
  assert.equal(forget.result.operation, 'forget');
  assert.equal(forget.result.forget_applied, true);
  assert.equal(forget.result.recalled_items.length, 0);
});

test('false memory and unauthorized durable write refused', () => {
  const falseMem = analyzeMemory({
    operation: 'resolve',
    requesting_principal_fixture: 'principal_a',
    thread_id: 'thread_1',
    request_fabricated_memory: true,
    memory_items: [],
  });
  assert.equal(falseMem.envelope.abstention.abstained, true);
  assert.equal(falseMem.result.false_memory_claims, 0);

  const write = analyzeMemory({
    operation: 'resolve',
    requesting_principal_fixture: 'principal_a',
    thread_id: 'thread_1',
    request_unauthorized_durable_write: true,
    memory_items: [],
  });
  assert.equal(write.envelope.abstention.abstained, true);
  assert.equal(write.result.unauthorized_durable_write, false);
});

test('bounded recall and capability routing', () => {
  const out = runCapability('multi_turn_memory', {
    operation: 'resolve',
    requesting_principal_fixture: 'principal_a',
    thread_id: 'thread_1',
    max_recall: 1,
    memory_items: [
      {
        memory_id: 'a',
        memory_class: 'session',
        owner_fixture: 'principal_a',
        scope: { thread_id: 'thread_1' },
        fact_key: 'budget',
        content: { value: 1 },
        updated_at: '2026-07-01T10:00:00.000Z',
        deletion_state: 'ACTIVE',
      },
      {
        memory_id: 'b',
        memory_class: 'session',
        owner_fixture: 'principal_a',
        scope: { thread_id: 'thread_1' },
        fact_key: 'condition',
        content: { value: 'VG' },
        updated_at: '2026-07-02T10:00:00.000Z',
        deletion_state: 'ACTIVE',
      },
    ],
  });
  assert.ok(out.result.recalled_items.length <= 1);

  const scored = evaluateScenario({
    scenario_id: 'unit_ma',
    capability_id: 'market_analytics',
    input: {
      requesting_principal_fixture: 'principal_a',
      analytics_mode: 'release_market_summary',
      subject: { release_id: 'r1' },
      events: [sold('s', 30)],
    },
    expected: { abstain: false, sample_size_present: true, sold_not_asking: true },
  });
  assert.equal(scored.status, 'PASS');
});
