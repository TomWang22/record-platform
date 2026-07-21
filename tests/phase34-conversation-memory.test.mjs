/**
 * Phase D — authoritative multi-turn conversation memory tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTHORITY_ORDER,
  CONTEXT_BUDGETS,
  DRAFT_STATUS,
  FACT_AUTHORITY,
  MEMORY_SCOPE,
  applyCorrection,
  assembleContext,
  assertAuthorityMayOverride,
  assertMemoryIsolation,
  buildContextBudgetHelpers,
  createConversationSession,
  createDraft,
  forgetFacts,
  grantConsent,
  appendConversationTurn,
  ingestConversationFacts,
  recomputeAfterCorrection,
  requireActionConfirmation,
  resolveActiveFacts,
  activeFactsMap,
  serializeSession,
  hydrateSession,
  sessionStateVersion,
  transitionDraft,
  ConversationMemoryStore,
} from '../scripts/lib/phase34-conversation-memory.mjs';
import { analyzeNegotiation } from '../scripts/lib/phase33d-negotiation.mjs';

function market() {
  return [
    {
      evidence_id: 'sold_1',
      source_type: 'sale',
      source_id: 'sold_1',
      sale_kind: 'sold',
      price: 38,
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

test('D1: multi-turn fact persistence with provenance', () => {
  const session = createConversationSession({
    principal_id: 'seller_a',
    thread_id: 'thread-1',
    participant_side: 'seller',
    created_at: '2026-07-21T12:00:00.000Z',
  });

  const t1 = appendConversationTurn(session, {
    turn_id: 'turn-1',
    actor: 'seller_a',
    intent: 'They offered $35 for my $41 listing.',
    created_at: '2026-07-21T12:00:01.000Z',
  });
  ingestConversationFacts(
    session,
    [
      { key: 'offer_amount_usd', value: 35, authority: 'CURRENT_EXPLICIT_CUSTOMER_STATEMENT' },
      { key: 'listing_price_usd', value: 41, authority: 'CURRENT_EXPLICIT_CUSTOMER_STATEMENT' },
    ],
    { source_turn_id: t1.turn_id, at: '2026-07-21T12:00:01.000Z' },
  );

  const t2 = appendConversationTurn(session, {
    turn_id: 'turn-2',
    actor: 'seller_a',
    intent: 'Sleeve seam split; shipping $6.',
    created_at: '2026-07-21T12:00:02.000Z',
  });
  ingestConversationFacts(
    session,
    [
      { key: 'condition', value: 'VG', authority: 'CURRENT_EXPLICIT_CUSTOMER_STATEMENT' },
      { key: 'seam_split', value: true, authority: 'CURRENT_EXPLICIT_CUSTOMER_STATEMENT' },
      { key: 'shipping_cost_usd', value: 6, authority: 'CURRENT_EXPLICIT_CUSTOMER_STATEMENT' },
    ],
    { source_turn_id: t2.turn_id, at: '2026-07-21T12:00:02.000Z' },
  );

  const values = activeFactsMap(session);
  assert.equal(values.offer_amount_usd, 35);
  assert.equal(values.listing_price_usd, 41);
  assert.equal(values.shipping_cost_usd, 6);
  assert.equal(values.seam_split, true);

  const shipping = resolveActiveFacts(session).shipping_cost_usd;
  assert.equal(shipping.source_turn_id, 'turn-2');
  assert.equal(shipping.source_actor, 'seller_a');
  assert.equal(shipping.authority, 'CURRENT_EXPLICIT_CUSTOMER_STATEMENT');
  assert.ok(shipping.timestamp);
  assert.equal(shipping.active, true);
  assert.equal(shipping.privacy_scope, MEMORY_SCOPE.SESSION);

  const json = serializeSession(session);
  const restored = hydrateSession(json);
  assert.equal(activeFactsMap(restored).shipping_cost_usd, 6);
  assert.equal(restored.conversation_turns.length, 2);
  assert.ok(sessionStateVersion(restored).includes('phase34-conversation-memory-v1'));
});

test('D2: correction supersession shipping $6 → $5 with recompute', () => {
  const session = createConversationSession({
    principal_id: 'seller_a',
    thread_id: 'thread-1',
    created_at: '2026-07-21T12:00:00.000Z',
  });
  ingestConversationFacts(
    session,
    [
      { key: 'offer_amount_usd', value: 35 },
      { key: 'listing_price_usd', value: 41 },
      { key: 'shipping_cost_usd', value: 6 },
      { key: 'seller_floor_usd', value: 37 },
    ],
    { at: '2026-07-21T12:00:01.000Z' },
  );

  const { fact, superseded } = applyCorrection(session, {
    key: 'shipping_cost_usd',
    value: 5,
    source_turn_id: 'turn-5',
    source_actor: 'seller_a',
    timestamp: '2026-07-21T12:00:05.000Z',
    authority: 'CURRENT_EXPLICIT_CUSTOMER_CORRECTION',
  });

  assert.equal(fact.value, 5);
  assert.equal(superseded.value, 6);
  assert.equal(superseded.active, false);
  assert.equal(superseded.deletion_state, 'SUPERSEDED');
  assert.equal(fact.supersedes_fact_id, superseded.fact_id);
  assert.equal(activeFactsMap(session).shipping_cost_usd, 5);

  const recomputed = recomputeAfterCorrection(session, {
    correction_fact: fact,
    turn_id: 'turn-5',
    at: '2026-07-21T12:00:05.000Z',
  });
  assert.equal(recomputed.material_correction, true);
  assert.equal(recomputed.must_rewrite_draft, true);
  assert.equal(recomputed.must_recompute_economics, true);
  assert.ok(recomputed.retrieval_checkpoint);
  assert.equal(recomputed.retrieval_checkpoint.reason, 'material_correction');
  assert.equal(recomputed.values.shipping_cost_usd, 5);
  assert.ok(session.fact_revisions.some((r) => r.reason === 'correction_supersession'));
});

test('D2: illegal authority override rejected (inference cannot beat correction)', () => {
  const session = createConversationSession({ principal_id: 'seller_a', thread_id: 't1' });
  applyCorrection(session, {
    key: 'shipping_cost_usd',
    value: 5,
    authority: 'CURRENT_EXPLICIT_CUSTOMER_CORRECTION',
    timestamp: '2026-07-21T12:00:05.000Z',
  });
  const active = resolveActiveFacts(session).shipping_cost_usd;
  assert.throws(
    () => assertAuthorityMayOverride(active, 'MODEL_INFERENCE'),
    (err) => err.code === 'ILLEGAL_AUTHORITY_OVERRIDE',
  );
  assert.throws(
    () =>
      applyCorrection(session, {
        key: 'shipping_cost_usd',
        value: 99,
        authority: 'MODEL_INFERENCE',
        timestamp: '2026-07-21T12:00:06.000Z',
      }),
    (err) => err.code === 'ILLEGAL_AUTHORITY_OVERRIDE',
  );
  assert.equal(activeFactsMap(session).shipping_cost_usd, 5);
  assert.deepEqual(AUTHORITY_ORDER[0], 'CURRENT_EXPLICIT_CUSTOMER_CORRECTION');
  assert.equal(FACT_AUTHORITY.MODEL_INFERENCE, 6);
});

test('D3: context assembly tiers respect 4k/8k/16k/32k budgets', () => {
  const session = createConversationSession({ principal_id: 'u1', thread_id: 't1' });
  for (let i = 0; i < 20; i += 1) {
    appendConversationTurn(session, {
      turn_id: `turn-${i}`,
      actor: 'u1',
      intent: `Clarification turn ${i} with enough text to estimate tokens for budgeting.`,
      created_at: `2026-07-21T12:00:${String(i).padStart(2, '0')}.000Z`,
    });
  }
  ingestConversationFacts(session, {
    offer_amount_usd: 35,
    listing_price_usd: 41,
    shipping_cost_usd: 5,
  });

  const helpers = buildContextBudgetHelpers();
  const c4 = helpers.assemble4k(session, {
    retrieved_memories: Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, text: 'x'.repeat(200) })),
    evidence_excerpts: Array.from({ length: 40 }, (_, i) => ({ id: `e${i}`, text: 'y'.repeat(200) })),
  });
  assert.equal(c4.budget_tokens, CONTEXT_BUDGETS['4k']);
  assert.ok(c4.input_token_estimate <= c4.budget_tokens + 50);
  assert.ok(c4.tiers.active_facts.length >= 1);
  assert.ok(c4.tiers.recent_turns.length <= 8);

  const c32 = helpers.assemble32k(session);
  assert.equal(c32.budget_tokens, 32_000);
  assert.equal(c32.truncation_status, 'WITHIN_BUDGET');
});

test('D4: forget/delete propagates; cross-user isolation holds', () => {
  const session = createConversationSession({
    principal_id: 'seller_a',
    thread_id: 'thread-1',
  });
  grantConsent(session, {
    durable_memory: true,
    scopes_allowed: [MEMORY_SCOPE.SESSION, MEMORY_SCOPE.THREAD, MEMORY_SCOPE.USER_PRIVATE],
  });
  ingestConversationFacts(session, [
    { key: 'shipping_cost_usd', value: 5, privacy_scope: MEMORY_SCOPE.USER_PRIVATE },
    { key: 'offer_amount_usd', value: 35 },
  ]);
  const shippingFact = resolveActiveFacts(session).shipping_cost_usd;
  applyCorrection(session, {
    key: 'net_hint',
    value: 32,
    authority: 'GROUNDED_INFERENCE',
    timestamp: '2026-07-21T12:01:00.000Z',
    metadata: { derived_from_fact_id: shippingFact.fact_id },
  });
  // Propagation stub follows supersedes_fact_id for inference facts.
  const netHint = resolveActiveFacts(session).net_hint;
  netHint.supersedes_fact_id = shippingFact.fact_id;

  const forgotten = forgetFacts(session, {
    fact_keys: ['shipping_cost_usd'],
    propagate: true,
  });
  assert.ok(forgotten.forgotten_fact_ids.length >= 1);
  assert.equal(forgotten.active_values.shipping_cost_usd, undefined);
  assert.ok(forgotten.forgotten_fact_ids.includes(netHint.fact_id));
  assert.equal(forgotten.deletion_propagation, 'stub_applied');

  const isolation = assertMemoryIsolation(session, {
    requesting_principal_id: 'other_user',
    requesting_thread_id: 'thread-1',
  });
  assert.equal(isolation.ok, false);
  assert.ok(isolation.diagnostics.reason_codes.includes('CROSS_USER_REFUSED'));
  assert.equal(isolation.visible_facts.length, 0);

  const otherThread = assertMemoryIsolation(session, {
    requesting_principal_id: 'seller_a',
    requesting_thread_id: 'thread-OTHER',
  });
  assert.equal(otherThread.ok, false);
  assert.ok(otherThread.diagnostics.reason_codes.includes('CROSS_THREAD_REFUSED'));
});

test('D5: draft insert is never send; confirmation required for side effects', () => {
  const session = createConversationSession({ principal_id: 'seller_a', thread_id: 't1' });
  const draft = createDraft(session, {
    body: 'Thanks for the offer — shipping is $5.',
    status: DRAFT_STATUS.GENERATED,
  });
  assert.equal(draft.message_sent, false);

  transitionDraft(session, draft.draft_id, DRAFT_STATUS.EDITED, {
    body: 'Thanks — with $5 shipping I can meet near $37.',
  });
  transitionDraft(session, draft.draft_id, DRAFT_STATUS.INSERTED);
  assert.equal(draft.status, DRAFT_STATUS.INSERTED);
  assert.equal(draft.message_sent, false);
  assert.ok(draft.inserted_at);

  assert.throws(
    () => transitionDraft(session, draft.draft_id, DRAFT_STATUS.SENT),
    (err) => err.code === 'ILLEGAL_DRAFT_TRANSITION',
  );

  assert.throws(
    () =>
      requireActionConfirmation(session, {
        action_type: 'send_message',
        draft_id: draft.draft_id,
        confirmed: false,
      }),
    (err) => err.code === 'ACTION_CONFIRMATION_REQUIRED',
  );

  transitionDraft(session, draft.draft_id, DRAFT_STATUS.CONFIRMED);
  requireActionConfirmation(session, {
    action_type: 'send_message',
    draft_id: draft.draft_id,
    confirmed: true,
    actor: 'seller_a',
  });
  transitionDraft(session, draft.draft_id, DRAFT_STATUS.SENT);
  assert.equal(draft.status, DRAFT_STATUS.SENT);
  assert.equal(draft.message_sent, true);
});

test('negotiation wiring: session_state / conversation_facts use memory supersession', () => {
  const session = createConversationSession({
    session_id: 'sess-neg-1',
    principal_id: 'seller_b',
    thread_id: 't1',
    participant_side: 'seller',
  });
  ingestConversationFacts(session, [
    { key: 'offer_amount_usd', value: 35 },
    { key: 'listing_price_usd', value: 41 },
    { key: 'shipping_cost_usd', value: 6 },
    { key: 'seller_floor_usd', value: 37 },
    { key: 'condition_notes', value: 'sleeve seam split' },
  ]);

  const out = analyzeNegotiation({
    requesting_principal_fixture: 'seller_b',
    participant_side: 'seller',
    authorized_thread_id: 't1',
    session_id: 'sess-neg-1',
    subject: { listing_id: 'L1', release_id: 'r1', pressing_id: 'p1' },
    thread: { thread_id: 't1', participant_principals: ['seller_b', 'buyer_a'] },
    messages: [],
    market_candidates: market(),
    session_state: serializeSession(session),
    fact_corrections: [{ key: 'shipping_cost_usd', value: 5 }],
    user_intent: 'Actually shipping is $5, not $6. Draft the reply.',
  });

  assert.equal(out.result.structured_facts.shipping_cost_usd, 5);
  assert.ok(out.result.session_state_version);
  assert.match(out.result.session_state_version, /phase34-conversation-memory-v1/);
  assert.equal(out.result.draft_lifecycle.message_sent, false);
  assert.equal(out.result.automatic_send_allowed, false);
  assert.ok(out.result.retrieval_checkpoint);
  assert.ok(out.diagnostics.session_state_version);
  assert.ok(String(out.result.draft_reply || '').includes('$5') || out.result.market_context.shipping_cost_usd === 5);
});

test('negotiation remains backward compatible without session memory', () => {
  const out = analyzeNegotiation({
    requesting_principal_fixture: 'seller_b',
    participant_side: 'seller',
    authorized_thread_id: 't1',
    asking_price: 41,
    subject: { listing_id: 'L1', release_id: 'r1', pressing_id: 'p1' },
    thread: { thread_id: 't1', participant_principals: ['seller_b', 'buyer_a'] },
    messages: [],
    market_candidates: market(),
    user_intent: 'They offered $35 for my $41 listing. What should I do?',
  });
  assert.equal(out.result.session_state_version, null);
  assert.equal(out.result.session_state, null);
  assert.equal(out.result.automatic_send_allowed, false);
  assert.equal(out.result.structured_facts.offer_amount_usd, 35);
});

test('ConversationMemoryStore round-trip', () => {
  const store = new ConversationMemoryStore();
  const session = createConversationSession({ principal_id: 'u1', thread_id: 't1' });
  store.put(session);
  assert.equal(store.get(session.conversation_session.session_id).conversation_session.principal_id, 'u1');
  assert.equal(store.toJSON().length, 1);
});

test('assembleContext does not dump full history', () => {
  const session = createConversationSession({ principal_id: 'u1', thread_id: 't1' });
  for (let i = 0; i < 30; i += 1) {
    appendConversationTurn(session, {
      actor: 'u1',
      intent: `turn ${i}`,
    });
  }
  const ctx = assembleContext(session, { budget: '8k', recent_turn_limit: 8 });
  assert.ok(ctx.tiers.recent_turns.length <= 8);
  assert.ok(ctx.tiers.compact_summary);
  assert.ok(!JSON.stringify(ctx).includes('"turn_index":0') || ctx.tiers.recent_turns[0].turn_index >= 22);
});
