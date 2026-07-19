/**
 * Phase 34 material correction gate regressions — negotiation, recommendations, analytics.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { analyzeNegotiation } from '../scripts/lib/phase33d-negotiation.mjs';
import { analyzeRecommendations } from '../scripts/lib/phase33d-recommendations.mjs';
import { analyzeMarketAnalytics } from '../scripts/lib/phase33e-analytics.mjs';
import {
  GOLDEN_TURN_INTENTS,
  buildGoldenFactProgression,
} from '../scripts/lib/phase34-negotiation-fact-invariants.mjs';
import {
  MEASUREMENT_STATUS,
  spanSetForTurn,
  instrumentSpans,
  pipelineStageCompleteness,
  timingField,
} from '../scripts/lib/phase34-source-verification-telemetry.mjs';

const SELLER = 'seller-contract-fixture';
const THREAD = 'thread-correction-gate';

function hash(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

function negoInput({ intent, prior = [], turn_index = 0 }) {
  return {
    requesting_principal_fixture: SELLER,
    principal_id: SELLER,
    participant_side: 'seller',
    authorized_thread_id: THREAD,
    asking_price: 41,
    force_negotiation_market_floor: true,
    subject: { listing_id: 'listing-corr', title: 'Quiet Kenny', user_intent: intent },
    thread: {
      thread_id: THREAD,
      participant_principals: [SELLER, 'buyer-contract-fixture'],
      latest_user_intent: intent,
      prior_turns: prior,
    },
    messages: [
      {
        message_id: 'm1',
        thread_id: THREAD,
        body: 'Offer on Quiet Kenny',
        deletion_state: 'ACTIVE',
      },
    ],
    session_id: 'sess-corr',
    turn_id: `turn-${turn_index + 1}`,
    turn_index,
    prior_turns: prior,
    user_intent: intent,
    automatic_send_allowed: false,
  };
}

test('negotiation one-turn vs four-turn final results differ materially', () => {
  const one = analyzeNegotiation(
    negoInput({ intent: GOLDEN_TURN_INTENTS[0], turn_index: 0 }),
  ).result;
  const prior = [];
  let four = null;
  for (let i = 0; i < GOLDEN_TURN_INTENTS.length; i += 1) {
    four = analyzeNegotiation(
      negoInput({
        intent: GOLDEN_TURN_INTENTS[i],
        prior: [...prior],
        turn_index: i,
      }),
    ).result;
    prior.push({
      turn_index: i,
      turn_id: `turn-${i + 1}`,
      intent: GOLDEN_TURN_INTENTS[i],
    });
  }

  assert.notEqual(hash(one.strategy), hash(four.strategy), 'strategy must differ');
  assert.notEqual(
    hash(one.draft_reply || one.reply_draft),
    hash(four.draft_reply || four.reply_draft),
    'draft must differ',
  );
  assert.notEqual(hash(one.structured_facts || {}), hash(four.structured_facts || {}));

  const facts = four.structured_facts || {};
  assert.equal(facts.offer_amount_usd, 35);
  assert.equal(facts.listing_price_usd, 41);
  assert.equal(facts.shipping_cost_usd, 6);
  assert.equal(facts.condition, 'VG');
  assert.match(String(facts.condition_notes || ''), /seam/i);
  assert.equal(facts.seller_floor_usd, 37);
  assert.equal(facts.tone_constraint, 'avoid_desperate');

  const draft = String(four.draft_reply || four.reply_draft || '');
  assert.ok(draft.length > 20);
  assert.match(draft, /seam|sleeve|VG|shipping|\$6|37/i);
  assert.equal(four.automatic_send_allowed, false);
  assert.notEqual(four.message_sent, true);

  const prog = buildGoldenFactProgression();
  assert.equal(prog.correction_precedence_ok, true);
});

test('recommendation Blue Note correction changes membership or rank', () => {
  const success = analyzeRecommendations({
    requesting_principal_fixture: SELLER,
    principal_id: SELLER,
    recommendation_mode: 'portfolio_diversification',
    force_recommendation_floor: true,
    user_intent: 'Keep it under $60, exclude picture discs, and diversify artists.',
  }).result;
  const corrected = analyzeRecommendations({
    requesting_principal_fixture: SELLER,
    principal_id: SELLER,
    recommendation_mode: 'portfolio_diversification',
    force_recommendation_floor: true,
    user_intent: 'Forget picture discs and keep Blue Note preference.',
  }).result;

  assert.ok((success.recommendations || []).length >= 5);
  assert.ok((corrected.recommendations || []).length >= 5);
  assert.ok((success.item_ids || []).length >= 5);

  for (const card of [...success.recommendations, ...corrected.recommendations]) {
    assert.ok(card.price == null || card.price <= 60);
    assert.notEqual(card.format, 'picture_disc');
    assert.notEqual(card.picture_disc, true);
    assert.ok(card.reason_customer || card.explanation);
  }

  const priorIds = success.item_ids || success.recommendations.map((r) => r.entity_id);
  const updatedIds = corrected.item_ids || corrected.recommendations.map((r) => r.entity_id);
  const added = updatedIds.filter((id) => !priorIds.includes(id));
  const removed = priorIds.filter((id) => !updatedIds.includes(id));
  const priorRank = Object.fromEntries(success.recommendations.map((r) => [r.entity_id, r.rank]));
  const updatedRank = Object.fromEntries(corrected.recommendations.map((r) => [r.entity_id, r.rank]));
  const rankChanged = Object.keys(updatedRank).filter(
    (id) => priorRank[id] != null && priorRank[id] !== updatedRank[id],
  );

  assert.ok(
    added.length + removed.length >= 1 || rankChanged.length >= 2,
    `material gate failed added=${added.length} removed=${removed.length} rankChanged=${rankChanged.length}`,
  );
  assert.ok(
    corrected.recommendations.some((r) => /blue note/i.test(String(r.reason_customer || ''))),
  );
  assert.ok(String(corrected.what_changed || '').length > 10);
  assert.notEqual(hash(priorIds), hash(updatedIds));
});

test('analytics US/VG+ constraint changes event membership and aggregates', () => {
  const unconstrained = analyzeMarketAnalytics({
    requesting_principal_fixture: SELLER,
    principal_id: SELLER,
    analytics_mode: 'release_market_summary',
    currency: 'USD',
    force_analytics_floor: true,
    user_intent: 'How did completed Blue Note LP sales change over the last 90 days?',
  }).result;
  const constrained = analyzeMarketAnalytics({
    requesting_principal_fixture: SELLER,
    principal_id: SELLER,
    analytics_mode: 'release_market_summary',
    currency: 'USD',
    force_analytics_floor: true,
    user_intent: 'Limit to US sellers and VG+ or better.',
  }).result;

  assert.ok(unconstrained.sample_size > 0 || unconstrained.population_size > 0);
  assert.ok(constrained.population_size > 0);
  assert.notDeepEqual(
    unconstrained.included_event_ids || [],
    constrained.included_event_ids || [],
  );
  assert.ok(
    unconstrained.sample_size !== constrained.sample_size ||
      unconstrained.population_size !== constrained.population_size ||
      unconstrained.price_median !== constrained.price_median,
  );
  assert.equal(constrained.constraints_applied?.country, 'US');
  assert.equal(constrained.constraints_applied?.min_condition, 'VG+');
  assert.ok((constrained.excluded_by_country_ids || []).length + (constrained.excluded_by_condition_ids || []).length >= 1);
  assert.ok(String(constrained.what_changed || '').length > 10);
  assert.ok(String(unconstrained.time_range_customer || '').length > 5);
  assert.doesNotMatch(JSON.stringify(constrained.time_range_customer || ''), /\{/);
});

test('executed required stages cannot be NOT_INSTRUMENTED without exemption', () => {
  const required = [
    'browser.action',
    'gateway.request',
    'authorization.check',
    'context.load',
    'context.correct',
    'evidence.assemble',
    'schema.validate',
    'grounding.validate',
    'safety.validate',
    'privacy.validate',
    'gateway.response',
    'browser.terminal_ready',
  ];
  let spans = spanSetForTurn({ trace_id: 'tr', session_id: 's', turn_index: 0, capability: 'negotiation_assistance' });
  const updates = {};
  for (const name of required) {
    updates[name] = { duration_us: 1000, measurement_status: MEASUREMENT_STATUS.INSTRUMENTED };
  }
  spans = instrumentSpans(spans, updates);
  const c = pipelineStageCompleteness(spans);
  for (const name of required) {
    const row = c.rows.find((r) => r.name === name);
    assert.equal(row.measurement_status, MEASUREMENT_STATUS.INSTRUMENTED);
    assert.ok(row.duration_us > 0);
  }
  const zero = timingField(null);
  assert.equal(zero.value_us, null);
  assert.equal(zero.measurement_status, MEASUREMENT_STATUS.NOT_INSTRUMENTED);
});
