import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeNegotiation } from '../scripts/lib/phase33d-negotiation.mjs';
import { analyzeRecommendations } from '../scripts/lib/phase33d-recommendations.mjs';
import { evaluateScenario, runCapability } from '../scripts/lib/phase33d-intelligence.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function market() {
  return [
    {
      evidence_id: 'sold_1',
      source_type: 'sale',
      source_id: 'sold_1',
      sale_kind: 'sold',
      price: 30,
      currency: 'USD',
      pressing_id: 'p1',
      release_id: 'r1',
      observed_at: '2026-07-01T12:00:00.000Z',
      retrieved_at: '2026-07-01T12:00:00.000Z',
      summary: 'sold',
      authorization_scope: 'authenticated_market',
      privacy_class: 'MARKETPLACE_SHARED',
      deletion_state: 'ACTIVE',
      freshness_status: 'fresh',
    },
  ];
}

test('buyer participant-side and auto-send false', () => {
  const out = analyzeNegotiation({
    requesting_principal_fixture: 'buyer_a',
    participant_side: 'buyer',
    authorized_thread_id: 't1',
    asking_price: 40,
    subject: { listing_id: 'L1', release_id: 'r1', pressing_id: 'p1' },
    thread: { thread_id: 't1', participant_principals: ['buyer_a', 'seller_b'] },
    messages: [],
    market_candidates: market(),
  });
  assert.equal(out.result.participant_side, 'buyer');
  assert.equal(out.result.automatic_send_allowed, false);
  assert.equal(out.result.auto_send, false);
  assert.equal(out.result.impersonation, false);
});

test('seller participant-side', () => {
  const out = analyzeNegotiation({
    requesting_principal_fixture: 'seller_b',
    participant_side: 'seller',
    authorized_thread_id: 't1',
    asking_price: 40,
    seller_minimum: 28,
    subject: { listing_id: 'L1', release_id: 'r1', pressing_id: 'p1' },
    thread: { thread_id: 't1', participant_principals: ['buyer_a', 'seller_b'] },
    messages: [],
    market_candidates: market(),
  });
  assert.equal(out.result.participant_side, 'seller');
  assert.ok(out.result.walk_away_guidance >= 28);
});

test('cross-user thread rejection', () => {
  const out = analyzeNegotiation({
    requesting_principal_fixture: 'buyer_a',
    participant_side: 'buyer',
    authorized_thread_id: 't2',
    subject: { listing_id: 'L1', release_id: 'r1' },
    thread: { thread_id: 't2', participant_principals: ['other'], owner_cross_user_attempt: true },
    messages: [{ message_id: 'm1', thread_id: 't2', text_redacted: 'x' }],
    market_candidates: market(),
  });
  assert.equal(out.envelope.abstention.abstained, true);
  assert.ok(out.diagnostics.unauthorized_thread);
});

test('deleted message excluded from influence', () => {
  const out = analyzeNegotiation({
    requesting_principal_fixture: 'buyer_a',
    participant_side: 'buyer',
    authorized_thread_id: 't1',
    budget: 30,
    subject: { listing_id: 'L1', release_id: 'r1', pressing_id: 'p1' },
    thread: { thread_id: 't1', participant_principals: ['buyer_a', 'seller_b'] },
    messages: [
      {
        message_id: 'del',
        thread_id: 't1',
        deleted: true,
        correction_budget: 999,
      },
    ],
    market_candidates: market(),
  });
  assert.equal(out.diagnostics.deleted_message_influence, 0);
  assert.ok(out.result.stated_objectives.some((s) => s.includes('30')));
  assert.ok(!out.result.stated_objectives.some((s) => s.includes('999')));
});

test('fabricated leverage / impersonation / auto-send refused', () => {
  for (const flag of [
    'request_fabricated_leverage',
    'request_impersonation',
    'request_auto_send',
    'request_intimidation',
  ]) {
    const out = analyzeNegotiation({
      requesting_principal_fixture: 'buyer_a',
      participant_side: 'buyer',
      authorized_thread_id: 't1',
      subject: { listing_id: 'L1', release_id: 'r1', pressing_id: 'p1' },
      thread: { thread_id: 't1', participant_principals: ['buyer_a'] },
      market_candidates: market(),
      [flag]: true,
    });
    assert.equal(out.envelope.abstention.abstained, true, flag);
    assert.equal(out.result.automatic_send_allowed, false);
  }
});

test('multi-turn budget correction precedence', () => {
  const out = analyzeNegotiation({
    requesting_principal_fixture: 'buyer_a',
    participant_side: 'buyer',
    authorized_thread_id: 't1',
    budget: 40,
    subject: { listing_id: 'L1', release_id: 'r1', pressing_id: 'p1' },
    thread: { thread_id: 't1', participant_principals: ['buyer_a'] },
    messages: [
      {
        message_id: 'c1',
        thread_id: 't1',
        participant_side: 'buyer',
        correction_budget: 32,
      },
    ],
    market_candidates: market(),
  });
  assert.ok(out.result.stated_objectives.some((s) => s.includes('32')));
});

test('recommendations budget + deleted + negative preference', () => {
  const out = analyzeRecommendations({
    requesting_principal_fixture: 'buyer_a',
    recommendation_mode: 'budget_opportunity',
    budget: 25,
    negative_preferences: ['artist_bad'],
    candidates: [
      {
        entity_id: 'a',
        entity_type: 'listing',
        artist: 'artist_ok',
        price: 20,
        deletion_state: 'ACTIVE',
        authorization_scope: 'authenticated_market',
        privacy_class: 'MARKETPLACE_SHARED',
      },
      {
        entity_id: 'b',
        entity_type: 'listing',
        artist: 'artist_bad',
        price: 18,
        deletion_state: 'ACTIVE',
        authorization_scope: 'authenticated_market',
        privacy_class: 'MARKETPLACE_SHARED',
      },
      {
        entity_id: 'c',
        entity_type: 'listing',
        artist: 'artist_ok',
        price: 40,
        deletion_state: 'ACTIVE',
        authorization_scope: 'authenticated_market',
        privacy_class: 'MARKETPLACE_SHARED',
      },
      {
        entity_id: 'd',
        entity_type: 'listing',
        artist: 'artist_ok',
        price: 15,
        deleted: true,
        deletion_state: 'DELETED',
        authorization_scope: 'authenticated_market',
        privacy_class: 'MARKETPLACE_SHARED',
      },
    ],
  });
  assert.equal(out.result.pay_to_rank, false);
  assert.ok(out.result.recommendations.every((r) => (r.budget_fit.price ?? 0) <= 25));
  assert.ok(!out.result.recommendations.some((r) => r.entity_id === 'b'));
  assert.ok(!out.result.recommendations.some((r) => r.entity_id === 'd'));
});

test('cross-user collection attempt abstains', () => {
  const out = analyzeRecommendations({
    requesting_principal_fixture: 'buyer_a',
    recommendation_mode: 'collection_gap',
    cross_user_collection_attempt: true,
    candidates: [{ entity_id: 'x', entity_type: 'listing', price: 10, deletion_state: 'ACTIVE' }],
  });
  assert.equal(out.envelope.abstention.abstained, true);
});

test('pay-to-rank and appreciation claims refused', () => {
  const out = analyzeRecommendations({
    requesting_principal_fixture: 'buyer_a',
    recommendation_mode: 'market_opportunity',
    request_pay_to_rank: true,
    candidates: [{ entity_id: 'x', entity_type: 'listing', price: 10, deletion_state: 'ACTIVE' }],
  });
  assert.equal(out.envelope.abstention.abstained, true);
  const out2 = analyzeRecommendations({
    requesting_principal_fixture: 'buyer_a',
    recommendation_mode: 'market_opportunity',
    request_guaranteed_appreciation: true,
    candidates: [{ entity_id: 'x', entity_type: 'listing', price: 10, deletion_state: 'ACTIVE' }],
  });
  assert.equal(out2.envelope.abstention.abstained, true);
});

test('ranking determinism', () => {
  const input = {
    requesting_principal_fixture: 'buyer_a',
    recommendation_mode: 'similar_release',
    candidates: [
      { entity_id: 'z', entity_type: 'listing', price: 20, metadata_relevance: 0.9, deletion_state: 'ACTIVE', authorization_scope: 'authenticated_market', privacy_class: 'MARKETPLACE_SHARED' },
      { entity_id: 'a', entity_type: 'listing', price: 21, metadata_relevance: 0.9, deletion_state: 'ACTIVE', authorization_scope: 'authenticated_market', privacy_class: 'MARKETPLACE_SHARED' },
    ],
  };
  const a = analyzeRecommendations(input).result.recommendations.map((r) => r.entity_id);
  const b = analyzeRecommendations(input).result.recommendations.map((r) => r.entity_id);
  assert.deepEqual(a, b);
});

test('runner stdout JSON separation', () => {
  const runner = path.join(ROOT, 'scripts/ai-platform/run-phase33d-capability.mjs');
  const payload = JSON.stringify({
    capability: 'recommendations',
    input: {
      requesting_principal_fixture: 'buyer_a',
      recommendation_mode: 'similar_release',
      candidates: [
        {
          entity_id: 'e1',
          entity_type: 'listing',
          price: 12,
          deletion_state: 'ACTIVE',
          authorization_scope: 'authenticated_market',
          privacy_class: 'MARKETPLACE_SHARED',
        },
      ],
    },
  });
  const proc = spawnSync(process.execPath, [runner], {
    input: payload,
    encoding: 'utf8',
    cwd: ROOT,
  });
  const body = JSON.parse(proc.stdout);
  assert.equal(body.status, 'PASS');
  assert.equal(body.result.automatic_send_allowed, false);
});

test('evaluateScenario hard-stop scan for private fields', () => {
  const r = evaluateScenario({
    scenario_id: 't',
    capability_id: 'negotiation_assistance',
    input: {
      requesting_principal_fixture: 'buyer_a',
      participant_side: 'buyer',
      authorized_thread_id: 't1',
      subject: { listing_id: 'L1', release_id: 'r1', pressing_id: 'p1' },
      thread: { thread_id: 't1', participant_principals: ['buyer_a'] },
      market_candidates: market(),
    },
    expected: { abstain: false, auto_send_false: true },
  });
  assert.equal(r.status, 'PASS');
  assert.ok(!r.hard_violations.includes('private_field'));
});

test('runCapability aliases', () => {
  const out = runCapability('negotiation', {
    requesting_principal_fixture: 'buyer_a',
    participant_side: 'buyer',
    authorized_thread_id: 't1',
    subject: { listing_id: 'L1', release_id: 'r1', pressing_id: 'p1' },
    thread: { thread_id: 't1', participant_principals: ['buyer_a'] },
    market_candidates: market(),
  });
  assert.equal(out.result.automatic_send_allowed, false);
});
