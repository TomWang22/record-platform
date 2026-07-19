/**
 * Phase 34 negotiation context depth unit coverage.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNegotiationContextPack,
  evaluateNegotiationContextTiers,
  CONTEXT_TIERS,
} from '../scripts/lib/phase34-negotiation-context.mjs';

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
  const rows = evaluateNegotiationContextTiers({ thread_id: 't1' });
  assert.equal(rows.length, 4);
  for (const row of rows) {
    assert.ok(row.input_token_estimate > 0);
    assert.ok(row.context_truncation_status);
  }
});
