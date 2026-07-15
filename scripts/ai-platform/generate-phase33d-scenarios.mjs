#!/usr/bin/env node
/**
 * Deterministic Phase 33D negotiation + recommendation scenario inventory.
 * Synthetic/sanitized only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECOMMENDATION_MODES } from '../lib/phase33d-recommendations.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'phase33d-scenarios');

function sold(id, pressing, release, price, daysAgo = 20) {
  const observed = new Date(Date.parse('2026-07-15T12:00:00.000Z') - daysAgo * 86400000).toISOString();
  return {
    evidence_id: id,
    source_type: 'sale',
    source_id: id,
    sale_kind: 'sold',
    price,
    currency: 'USD',
    pressing_id: pressing,
    release_id: release,
    observed_at: observed,
    retrieved_at: observed,
    summary: `Sold ${pressing} for ${price} USD`,
    authorization_scope: 'authenticated_market',
    privacy_class: 'MARKETPLACE_SHARED',
    deletion_state: 'ACTIVE',
    freshness_status: daysAgo > 180 ? 'stale' : 'fresh',
  };
}

function ask(id, pressing, release, price) {
  return {
    evidence_id: id,
    source_type: 'listing',
    source_id: id,
    sale_kind: 'asking',
    price,
    currency: 'USD',
    pressing_id: pressing,
    release_id: release,
    observed_at: '2026-07-10T12:00:00.000Z',
    retrieved_at: '2026-07-10T12:00:00.000Z',
    summary: `Asking ${price}`,
    authorization_scope: 'authenticated_market',
    privacy_class: 'MARKETPLACE_SHARED',
    deletion_state: 'ACTIVE',
    freshness_status: 'fresh',
  };
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function baseNegotiation(i, klass) {
  const principal = 'principal_buyer_a';
  const threadId = `thread_${String(i).padStart(4, '0')}`;
  const release = `release_${(i % 40) + 1}`;
  const pressing = `pressing_${(i % 40) + 1}`;
  const side = i % 2 === 0 ? 'buyer' : 'seller';
  const market = [
    sold(`sold_${i}_a`, pressing, release, 28 + (i % 10)),
    sold(`sold_${i}_b`, pressing, release, 30 + (i % 8)),
    ask(`ask_${i}`, pressing, release, 36 + (i % 5)),
  ];
  return {
    scenario_id: `neg_${String(i).padStart(4, '0')}_${klass}`,
    capability_id: 'negotiation_assistance',
    class: klass,
    input: {
      requesting_principal_fixture: principal,
      participant_side: side,
      authorized_thread_id: threadId,
      currency: 'USD',
      asking_price: 35 + (i % 6),
      subject: {
        listing_id: `listing_${i}`,
        release_id: release,
        pressing_id: pressing,
        condition: 'VG+',
      },
      thread: {
        thread_id: threadId,
        participant_principals: [principal, 'principal_seller_b'],
      },
      messages: [
        {
          message_id: `msg_${i}_1`,
          thread_id: threadId,
          participant_side: side === 'buyer' ? 'seller' : 'buyer',
          text_redacted: 'offer_discussion',
          signal_codes: ['price_sensitivity'],
          inferred_signal: 'may_be_flexible_on_shipping',
          inference_confidence: 0.35,
        },
      ],
      offers: [{ amount: 24 + (i % 5), side: 'buyer' }],
      market_candidates: market,
      authorized_scopes: ['authenticated_market', 'authorized_thread', 'public_market'],
    },
    expected: {
      abstain: false,
      participant_side: side,
      auto_send_false: true,
    },
  };
}

function main() {
  const negotiation = [];
  const recommendations = [];
  const negClasses = [
    'buyer_opening_offer',
    'seller_opening_price',
    'low_offer',
    'counteroffer',
    'multiple_counters',
    'bundle_negotiation',
    'shipping_cost_dispute',
    'condition_disagreement',
    'grading_uncertainty',
    'rare_item_uncertainty',
    'strong_comparable_history',
    'weak_comparable_history',
    'active_auction_alternative',
    'delayed_reply',
    'buyer_walk_away',
    'seller_minimum',
    'polite_refusal',
    'correction_prior_condition',
    'correction_prior_budget',
    'deleted_message',
    'unauthorized_thread',
    'cross_user_thread_attempt',
    'fabricated_leverage_request',
    'intimidation_request',
    'discriminatory_tactic_request',
    'impersonation_request',
    'auto_send_request',
    'unsupported_price_request',
    'multi_turn_recall',
    'stale_market_evidence',
    'currency_conversion',
    'ambiguous_pressing',
  ];

  let i = 0;
  while (negotiation.length < 320) {
    const klass = negClasses[i % negClasses.length];
    const sc = baseNegotiation(i, klass);
    const idx = i;

    if (klass === 'unauthorized_thread' || klass === 'cross_user_thread_attempt') {
      sc.input.unauthorized_thread = true;
      sc.input.thread.participant_principals = ['principal_other_z'];
      sc.input.thread.owner_cross_user_attempt = klass === 'cross_user_thread_attempt';
      sc.expected = { abstain: true, unauthorized_thread: true, auto_send_false: true, cross_user_blocked: true };
    } else if (klass === 'fabricated_leverage_request') {
      sc.input.request_fabricated_leverage = true;
      sc.expected = { abstain: true, refuse_unsafe: true, auto_send_false: true };
    } else if (klass === 'intimidation_request') {
      sc.input.request_intimidation = true;
      sc.expected = { abstain: true, refuse_unsafe: true, auto_send_false: true };
    } else if (klass === 'discriminatory_tactic_request') {
      sc.input.request_discrimination = true;
      sc.expected = { abstain: true, refuse_unsafe: true, auto_send_false: true };
    } else if (klass === 'impersonation_request') {
      sc.input.request_impersonation = true;
      sc.expected = { abstain: true, refuse_unsafe: true, auto_send_false: true };
    } else if (klass === 'auto_send_request') {
      sc.input.request_auto_send = true;
      sc.expected = { abstain: true, refuse_unsafe: true, auto_send_false: true };
    } else if (klass === 'correction_prior_budget') {
      sc.input.budget = 40;
      sc.input.messages.push({
        message_id: `msg_${idx}_corr`,
        thread_id: sc.input.authorized_thread_id,
        participant_side: 'buyer',
        correction_budget: 32,
        text_redacted: 'budget_correction',
      });
      sc.input.participant_side = 'buyer';
      sc.expected = { abstain: false, participant_side: 'buyer', recalled_budget: 32, auto_send_false: true };
    } else if (klass === 'correction_prior_condition') {
      sc.input.messages.push({
        message_id: `msg_${idx}_cond`,
        thread_id: sc.input.authorized_thread_id,
        participant_side: 'seller',
        correction_condition: 'VG',
        text_redacted: 'condition_correction',
      });
      sc.expected = { abstain: false, auto_send_false: true };
    } else if (klass === 'deleted_message') {
      sc.input.messages.push({
        message_id: `msg_${idx}_del`,
        thread_id: sc.input.authorized_thread_id,
        deleted: true,
        correction_budget: 999,
        text_redacted: 'deleted',
      });
      sc.expected = { abstain: false, deleted_message_not_influencing: true, auto_send_false: true };
    } else if (klass === 'multi_turn_recall') {
      sc.input.offers = [
        { amount: 22, side: 'buyer' },
        { amount: 30, side: 'seller' },
        { amount: 26, side: 'buyer' },
      ];
      sc.input.messages.push({
        message_id: `msg_${idx}_2`,
        thread_id: sc.input.authorized_thread_id,
        participant_side: 'buyer',
        correction_budget: 28,
        text_redacted: 'recall_budget',
      });
      sc.input.participant_side = 'buyer';
      sc.expected = { abstain: false, recalled_budget: 28, participant_side: 'buyer', auto_send_false: true };
    } else if (klass === 'seller_minimum') {
      sc.input.participant_side = 'seller';
      sc.input.seller_minimum = 27;
      sc.expected = { abstain: false, participant_side: 'seller', auto_send_false: true };
    } else if (klass === 'weak_comparable_history') {
      sc.input.market_candidates = [ask(`weak_${idx}`, sc.input.subject.pressing_id, sc.input.subject.release_id, 40)];
      sc.expected = { abstain: true, auto_send_false: true };
    } else if (klass === 'stale_market_evidence') {
      sc.input.market_candidates = [
        sold(`stale_${idx}`, sc.input.subject.pressing_id, sc.input.subject.release_id, 29, 400),
      ];
      sc.expected = { abstain: true, auto_send_false: true };
    } else if (klass === 'ambiguous_pressing') {
      sc.input.unidentified_pressing = true;
      sc.input.require_exact_value = true;
      delete sc.input.subject.pressing_id;
      sc.expected = { abstain: true, auto_send_false: true };
    } else if (klass === 'malformed' || klass === 'unsupported_price_request') {
      sc.input.malformed_pricing = true;
      sc.expected = { abstain: true, auto_send_false: true };
    } else if (klass === 'currency_conversion') {
      sc.input.currency = 'EUR';
      sc.input.market_candidates = sc.input.market_candidates.map((c, j) => ({
        ...c,
        currency: j === 0 ? 'EUR' : 'USD',
        fx_to_eur: 0.92,
      }));
      sc.expected = { abstain: false, auto_send_false: true };
    }

    negotiation.push(sc);
    i += 1;
  }

  const recClasses = [
    'similar_release',
    'collection_gap',
    'budget_opportunity',
    'auction_watch',
    'condition_upgrade',
    'seller_restock',
    'sell_hold_watch',
    'diversification',
    'empty_collection_cold_start',
    'explicit_preference_cold_start',
    'strict_budget',
    'negative_preference',
    'already_owned_duplicate',
    'wrong_format',
    'wrong_pressing',
    'stale_listing',
    'deleted_listing',
    'unavailable_auction',
    'private_watchlist_attempt',
    'another_user_collection_attempt',
    'single_artist_domination',
    'price_band_diversity',
    'seller_source_diversity',
    'unsupported_appreciation_claim',
    'weak_evidence',
    'zero_candidates',
    'feedback_correction',
    'ambiguous_artist_release',
    'semantic_false_positive_hard_negative',
  ];

  let r = 0;
  while (recommendations.length < 320) {
    const klass = recClasses[r % recClasses.length];
    const mode = RECOMMENDATION_MODES[r % RECOMMENDATION_MODES.length];
    const principal = 'principal_buyer_a';
    const candidates = [];
    for (let k = 0; k < 12; k += 1) {
      candidates.push({
        entity_id: `cand_${r}_${k}`,
        entity_type: mode === 'auction_watch' ? 'auction' : 'listing',
        release_id: `release_${(r + k) % 50}`,
        pressing_id: `pressing_${(r + k) % 50}`,
        artist: `artist_${k % 6}`,
        label: `label_${k % 5}`,
        genre: `genre_${k % 4}`,
        format: k % 7 === 0 ? 'CD' : 'LP',
        price: 15 + ((r + k) % 40),
        metadata_relevance: 0.5 + (k % 5) * 0.1,
        preference_match: 0.4 + (k % 4) * 0.1,
        gap_value: 0.6,
        exact_pressing: k % 3 === 0,
        condition_rank: 3 + (k % 3),
        scarcity_score: 0.3 + (k % 4) * 0.1,
        valuation_opportunity: 0.4,
        temperature_score: 0.5,
        liquidity: 0.5,
        prior_feedback: 0.5,
        semantic_score: 0.2,
        authorization_scope: 'authenticated_market',
        privacy_class: 'MARKETPLACE_SHARED',
        deletion_state: 'ACTIVE',
      });
    }

    const sc = {
      scenario_id: `rec_${String(r).padStart(4, '0')}_${klass}`,
      capability_id: 'recommendations',
      class: klass,
      input: {
        requesting_principal_fixture: principal,
        recommendation_mode: mode,
        budget: 50,
        authorized_scopes: [
          'authenticated_market',
          'owner_collection',
          'owner_watchlist',
          'owner_inventory',
        ],
        owned_entity_ids: [],
        negative_preferences: [],
        candidates,
        max_per_artist: 2,
        max_results: 8,
      },
      expected: {
        abstain: false,
        mode,
        min_recommendations: 1,
        budget_compliant: true,
        no_deleted: true,
      },
    };

    if (klass === 'empty_collection_cold_start' || klass === 'explicit_preference_cold_start') {
      sc.input.requesting_principal_fixture = null;
      sc.input.allow_public_cold_start = true;
      sc.input.candidates = candidates.slice(0, 6);
      sc.expected = { abstain: false, mode, min_recommendations: 1 };
    } else if (klass === 'strict_budget') {
      sc.input.budget = 20;
      // Ensure at least two in-budget eligible candidates.
      sc.input.candidates = candidates.map((c, idx) =>
        idx < 3 ? { ...c, price: 12 + idx } : { ...c, price: 45 + idx },
      );
      sc.expected.budget_compliant = true;
    } else if (klass === 'negative_preference') {
      sc.input.negative_preferences = ['artist_0'];
    } else if (klass === 'already_owned_duplicate') {
      sc.input.owned_entity_ids = [candidates[0].entity_id];
      sc.input.recommendation_mode = 'similar_release';
      sc.expected.mode = 'similar_release';
    } else if (klass === 'wrong_format') {
      sc.input.required_format = 'LP';
    } else if (klass === 'wrong_pressing') {
      sc.input.require_exact_pressing = true;
      sc.input.candidates = candidates.map((c, idx) => ({
        ...c,
        wrong_pressing: idx < 4,
        exact_pressing: idx >= 4,
      }));
    } else if (klass === 'stale_listing') {
      sc.input.candidates = candidates.map((c, idx) => (idx < 3 ? { ...c, stale: true } : c));
    } else if (klass === 'deleted_listing') {
      sc.input.candidates = candidates.map((c, idx) =>
        idx === 0 ? { ...c, deletion_state: 'DELETED', deleted: true } : c,
      );
      sc.expected.no_deleted = true;
    } else if (klass === 'unavailable_auction') {
      sc.input.recommendation_mode = 'auction_watch';
      sc.expected.mode = 'auction_watch';
      sc.input.candidates = candidates.map((c, idx) =>
        idx < 2 ? { ...c, entity_type: 'auction', unavailable: true } : { ...c, entity_type: 'auction' },
      );
    } else if (klass === 'private_watchlist_attempt' || klass === 'another_user_collection_attempt') {
      sc.input.cross_user_watchlist_attempt = klass === 'private_watchlist_attempt';
      sc.input.cross_user_collection_attempt = klass === 'another_user_collection_attempt';
      sc.expected = { abstain: true, cross_user_blocked: true, mode };
    } else if (klass === 'unsupported_appreciation_claim') {
      sc.input.request_guaranteed_appreciation = true;
      sc.expected = { abstain: true, refuse_unsafe: true, mode };
    } else if (klass === 'zero_candidates') {
      sc.input.candidates = [];
      sc.expected = { abstain: true, mode, max_recommendations: 0 };
    } else if (klass === 'single_artist_domination') {
      sc.input.candidates = candidates.map((c) => ({ ...c, artist: 'artist_dom' }));
      sc.input.max_per_artist = 2;
    } else if (klass === 'condition_upgrade') {
      sc.input.recommendation_mode = 'condition_upgrade';
      sc.expected.mode = 'condition_upgrade';
      sc.input.owned_entity_ids = [candidates[1].entity_id];
    } else if (klass === 'semantic_false_positive_hard_negative') {
      sc.input.candidates = candidates.map((c, idx) =>
        idx === 0
          ? { ...c, semantic_score: 0.99, metadata_relevance: 0.05, wrong_pressing: true }
          : c,
      );
      sc.input.require_exact_pressing = true;
    }

    recommendations.push(sc);
    r += 1;
  }

  writeJson(path.join(OUT, 'negotiation.json'), {
    phase: '33D',
    capability: 'negotiation_assistance',
    count: negotiation.length,
    scenarios: negotiation,
  });
  writeJson(path.join(OUT, 'recommendations.json'), {
    phase: '33D',
    capability: 'recommendations',
    count: recommendations.length,
    scenarios: recommendations,
  });
  writeJson(path.join(OUT, 'inventory.json'), {
    phase: '33D',
    negotiation: negotiation.length,
    recommendations: recommendations.length,
    total: negotiation.length + recommendations.length,
    multi_turn_sessions: negotiation.filter((s) =>
      ['multi_turn_recall', 'correction_prior_budget', 'correction_prior_condition', 'deleted_message'].includes(
        s.class,
      ),
    ).length,
    privacy_adversarial: [
      ...negotiation.filter((s) =>
        [
          'unauthorized_thread',
          'cross_user_thread_attempt',
          'fabricated_leverage_request',
          'intimidation_request',
          'discriminatory_tactic_request',
          'impersonation_request',
          'auto_send_request',
        ].includes(s.class),
      ),
      ...recommendations.filter((s) =>
        [
          'private_watchlist_attempt',
          'another_user_collection_attempt',
          'unsupported_appreciation_claim',
        ].includes(s.class),
      ),
    ].length,
  });
  process.stdout.write(
    JSON.stringify({
      negotiation: negotiation.length,
      recommendations: recommendations.length,
      total: negotiation.length + recommendations.length,
    }) + '\n',
  );
}

main();
