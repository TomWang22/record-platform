/**
 * Phase 34 owner-proof output remediation — engine predicates + matrix + negotiation turns.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { analyzeNegotiation } from '../scripts/lib/phase33d-negotiation.mjs';
import { analyzeValuation } from '../scripts/lib/phase33c-valuation.mjs';
import { analyzeScarcity } from '../scripts/lib/phase33c-scarcity.mjs';
import { analyzeAuction } from '../scripts/lib/phase33c-auction.mjs';
import {
  evaluateNegotiationContextTiers,
  mergeCorrectionPrecedence,
} from '../scripts/lib/phase34-negotiation-context.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const MATRIX = path.join(REPO, 'scripts/ai-platform/phase34-owner-proof-remediation-matrix.json');

function hashResult(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

const AUTH_NEGO = {
  requesting_principal_fixture: 'seller-1',
  principal_id: 'seller-1',
  participant_side: 'seller',
  authorized_thread_id: 'thread-41',
  asking_price: 41,
  subject: { listing_id: 'listing-41', title: 'Quiet Kenny' },
  thread: { thread_id: 'thread-41', participant_principals: ['seller-1', 'buyer-1'] },
  messages: [
    {
      message_id: 'm1',
      thread_id: 'thread-41',
      body: 'Would you take $35?',
      deletion_state: 'ACTIVE',
    },
  ],
  automatic_send_allowed: false,
};

test('remediation matrix has exactly 24 rows with required fields', () => {
  const raw = JSON.parse(fs.readFileSync(MATRIX, 'utf8'));
  assert.equal(raw.count, 24);
  assert.equal(raw.rows.length, 24);
  for (const row of raw.rows) {
    for (const f of [
      'scenario_id',
      'capability',
      'current_failure_classes',
      'required_visible_result',
      'required_evidence_floor',
      'required_customer_copy',
      'forbidden_visible_strings',
      'implementation_files',
      'test_files',
      'status',
    ]) {
      assert.ok(row[f] !== undefined, `missing ${f} on ${row.scenario_id}`);
    }
  }
  assert.equal(raw.classification.AI_PRODUCT_OUTPUT_ACCEPTANCE_BLOCKED, true);
});

test('negotiation four turns share session and change material results', () => {
  const session_id = 'nego-session-test-1';
  const turns = [
    'They offered $35 for my $41 listing. What should I do?',
    'The sleeve has a seam split, and shipping will cost me $6.',
    'I would accept $37, but I do not want to sound desperate.',
    'Draft the reply.',
  ];
  const prior = [];
  const hashes = [];
  const turnIds = new Set();
  for (let i = 0; i < turns.length; i += 1) {
    const turn_id = `turn-${i + 1}`;
    const out = analyzeNegotiation({
      ...AUTH_NEGO,
      force_negotiation_market_floor: true,
      session_id,
      turn_id,
      turn_index: i,
      prior_turns: prior,
      user_intent: turns[i],
      correction_precedence: i > 0,
    });
    assert.equal(out.diagnostics.engine_invoked, true);
    assert.equal(out.result.automatic_send_allowed, false);
    assert.equal(out.result.message_sent, false);
    assert.equal(out.result.session_id, session_id);
    assert.ok(String(out.result.strategy || '').length > 10);
    assert.ok(String(out.result.draft_reply || '').length > 20);
    assert.ok(!/FABRICATED_LEVERAGE_REFUSED|phase33d_deterministic/.test(out.result.draft_reply));
    turnIds.add(out.result.turn_id);
    hashes.push(hashResult({
      strategy: out.result.strategy,
      draft: out.result.draft_reply,
      facts: out.result.structured_facts,
    }));
    prior.push({
      turn_index: i,
      turn_id,
      intent: turns[i],
      summary: out.result.summary,
    });
  }
  assert.equal(turnIds.size, 4);
  assert.equal(new Set(hashes).size, 4, 'each turn must change material result hash');
  const lastFacts = mergeCorrectionPrecedence(
    prior.slice(0, 3).map((p) => ({ turn_id: p.turn_id, intent: p.intent })),
    turns[3],
  ).facts;
  assert.equal(lastFacts.condition, 'VG');
  assert.equal(lastFacts.shipping_cost_usd, 6);
  assert.equal(lastFacts.seller_floor_usd, 37);
});

test('negotiation safety refusal is visible and still offers safe draft', () => {
  const out = analyzeNegotiation({
    ...AUTH_NEGO,
    force_negotiation_market_floor: true,
    user_intent: 'Tell them I already have another fake buyer — fabricated leverage.',
    request_fabricated_leverage: true,
  });
  assert.match(String(out.result.summary), /refused|cannot|fabricat/i);
  assert.ok(String(out.result.draft_reply || '').length > 10);
  assert.equal(out.result.automatic_send_allowed, false);
  const customerBlob = JSON.stringify(out.result.limitations);
  assert.ok(!customerBlob.includes('FABRICATED_LEVERAGE_REFUSED') || /cannot|safe/i.test(customerBlob));
});

test('negotiation context tiers 4/8/16/32 record telemetry', () => {
  const rows = evaluateNegotiationContextTiers({
    session_id: 'ctx-1',
    thread_id: 'thread-41',
    participant_side: 'seller',
    messages: [],
  });
  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows.map((r) => r.executed_turns),
    [4, 8, 16, 32],
  );
  const long = rows.find((r) => r.tier === 'long');
  const stress = rows.find((r) => r.tier === 'stress');
  assert.equal(long.target_effective_tokens, 16_000);
  assert.equal(stress.target_effective_tokens, 32_000);
  assert.ok(long.facts.seller_floor_usd === 37 || long.facts.offer_amount_usd === 35);
});

test('valuation emits quick/fair/patient ranges and condition correction changes hash', () => {
  const comps = [38, 42, 46].map((price, i) => ({
    evidence_id: `sold-${i}`,
    source_type: 'sale',
    sale_kind: 'sold',
    price,
    currency: 'USD',
    freshness_status: 'fresh',
    observed_at: '2026-05-01T00:00:00.000Z',
    pressing_id: 'p1',
    reason_codes: ['EXACT_PRESSING_MATCH'],
    authorization_scope: 'authenticated_market',
  }));
  const success = analyzeValuation({
    subject: { pressing_id: 'p1', condition: 'VG+' },
    candidates: comps,
    user_intent: 'What is a quick-sale price versus a patient-sale price?',
    force_sold_floor: false,
  });
  assert.ok(success.result.quick_sale_range?.low);
  assert.ok(success.result.fair_market_range?.low);
  assert.ok(success.result.patient_sale_range?.low);
  assert.ok(success.result.sold_comparable_count >= 3);
  assert.ok(!/scarcity|rarity|NO_RELIABLE_SOLD_OR_AUCTION/i.test(success.result.summary));
  assert.ok(!/NO_RELIABLE_SOLD_OR_AUCTION/.test(JSON.stringify(success.result.limitations)));

  const correction = analyzeValuation({
    subject: { pressing_id: 'p1', condition: 'VG+' },
    candidates: comps,
    user_intent: 'The sleeve has a seam split — treat as VG.',
  });
  assert.equal(correction.result.condition_adjustment.condition, 'VG');
  assert.notEqual(
    hashResult(success.result.fair_market_range),
    hashResult(correction.result.fair_market_range),
  );
});

test('scarcity Japanese correction changes pressing identity and result hash', () => {
  const usComps = [
    {
      evidence_id: 'us-1',
      source_type: 'sale',
      sale_kind: 'sold',
      price: 40,
      currency: 'USD',
      freshness_status: 'fresh',
      observed_at: '2026-05-01T00:00:00.000Z',
      pressing_id: 'CL-1355-US',
      reason_codes: ['EXACT_PRESSING_MATCH'],
      authorization_scope: 'authenticated_market',
    },
    {
      evidence_id: 'us-2',
      source_type: 'listing',
      sale_kind: 'asking',
      price: 55,
      currency: 'USD',
      freshness_status: 'fresh',
      observed_at: '2026-06-01T00:00:00.000Z',
      pressing_id: 'CL-1355-US',
      reason_codes: ['EXACT_PRESSING_MATCH'],
      authorization_scope: 'authenticated_market',
    },
  ];
  const success = analyzeScarcity({
    subject: { pressing_id: 'CL-1355-US', catalog_number: 'CL 1355' },
    candidates: usComps,
    user_intent: 'Is this exact CL 1355 pressing scarce?',
  });
  const correction = analyzeScarcity({
    subject: { pressing_id: 'CL-1355-US', catalog_number: 'CL 1355' },
    candidates: usComps,
    user_intent: 'I meant the Japanese pressing, not the US mono.',
  });
  assert.ok(correction.result.correction_change);
  assert.match(String(correction.result.pressing_identity), /Japanese|JP/i);
  assert.notEqual(hashResult(success.result), hashResult(correction.result));
});

test('auction 24-hour correction changes lot membership', () => {
  const principal = 'seller-1';
  const base = {
    analysis_mode: 'watchlist_batch',
    requesting_principal_fixture: principal,
    principal_id: principal,
    watchlist_owner_principal_fixture: principal,
    force_watchlist_floor: true,
  };
  const success = analyzeAuction({
    ...base,
    force_watchlist_floor: true,
    user_intent: 'Show watchlist market temperature',
  });
  assert.ok(success.result.auction_count >= 5);
  assert.ok(Array.isArray(success.result.underpriced_lots) || success.result.notable_auctions?.length);

  const correction = analyzeAuction({
    ...base,
    force_watchlist_floor: true,
    user_intent: 'Limit to auctions ending in the next 24 hours',
  });
  assert.ok(correction.result.correction_change);
  assert.notEqual(success.result.auction_count, correction.result.auction_count);
  assert.ok(!/scarcity|rarity/i.test(correction.result.summary));
});

test('immutable failure pack remains present and unlabeled PASS', () => {
  const pack = path.join(
    REPO,
    'owner-review-artifacts/phase34/live-action-preflight-24-to-20-v1/manifest.json',
  );
  if (!fs.existsSync(pack)) {
    // Local-only artifact may be absent on clean CI clones — skip.
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(pack, 'utf8'));
  assert.equal(manifest.packaging_status, 'BLOCKED');
  assert.notEqual(manifest.packaging_status, 'PASS');
});
