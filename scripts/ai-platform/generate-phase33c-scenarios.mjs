#!/usr/bin/env node
/**
 * Deterministic Phase 33C development scenario inventory generator.
 * Sanitized/synthetic only. No real messages, emails, JWTs, or secrets.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'phase33c-scenarios');

function sold(id, pressing, release, price, currency = 'USD', daysAgo = 30, extra = {}) {
  const observed = new Date(Date.parse('2026-07-15T12:00:00.000Z') - daysAgo * 86400000).toISOString();
  return {
    evidence_id: id,
    source_type: 'sale',
    source_id: id,
    sale_kind: 'sold',
    price,
    currency,
    pressing_id: pressing,
    release_id: release,
    observed_at: observed,
    retrieved_at: observed,
    summary: `Sold ${pressing} for ${price} ${currency}`,
    authorization_scope: 'authenticated_market',
    privacy_class: 'MARKETPLACE_SHARED',
    deletion_state: 'ACTIVE',
    condition: 'VG+',
    ...extra,
  };
}

function ask(id, pressing, release, price, currency = 'USD', extra = {}) {
  return {
    evidence_id: id,
    source_type: 'listing',
    source_id: id,
    sale_kind: 'asking',
    price,
    currency,
    pressing_id: pressing,
    release_id: release,
    observed_at: '2026-07-10T12:00:00.000Z',
    retrieved_at: '2026-07-10T12:00:00.000Z',
    summary: `Asking ${pressing} ${price} ${currency}`,
    authorization_scope: 'authenticated_market',
    privacy_class: 'MARKETPLACE_SHARED',
    deletion_state: 'ACTIVE',
    ...extra,
  };
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function main() {
  const scarcity = [];
  const valuation = [];
  const auction = [];
  let n = 0;
  const classes = [
    'exact_pressing',
    'broad_release_only',
    'unknown_pressing',
    'common_release',
    'scarce_release',
    'low_data_release',
    'stale_only',
    'contradictory_evidence',
    'strong_comparables',
    'weak_comparables',
    'extreme_outlier',
    'active_ask_without_sold',
    'currency_conversion',
    'poor_condition',
    'sealed_unverified',
    'auction_no_bids',
    'active_bidding',
    'late_bidding',
    'clustered_closings',
    'overlapping_similar_lots',
    'buyer_watchlist',
    'seller_watchlist',
    'unauthorized_watchlist',
    'missing_watchlist',
    'deleted_auction',
    'malformed_price',
    'privacy_trap',
    'rarity_overclaim_trap',
    'valuation_overclaim_trap',
    'collusion_trap',
    'bidder_identity_request',
    'abstention_case',
  ];

  // Scarcity >=150
  for (let i = 0; i < 150; i += 1) {
    n += 1;
    const cls = classes[i % classes.length];
    const pressing = `P-S-${(i % 40) + 1}`;
    const release = `R-S-${(i % 20) + 1}`;
    const baseSold = [
      sold(`s_sold_${i}_a`, pressing, release, 40 + (i % 20), 'USD', 20),
      sold(`s_sold_${i}_b`, pressing, release, 45 + (i % 15), 'USD', 40),
    ];
    const baseAsk = [ask(`s_ask_${i}`, pressing, release, 60 + (i % 10))];
    let input = {
      subject: { release_id: release, pressing_id: pressing, condition: 'VG+' },
      requesting_principal_fixture: 'principal_fixture_buyer_a',
      authorized_scopes: ['public_market', 'authenticated_market'],
      candidates: [...baseSold, ...baseAsk],
      active_supply_count: 3 + (i % 5),
      recent_sale_count: 2,
    };
    let expected = { abstain: false };

    if (cls === 'unknown_pressing' || cls === 'abstention_case') {
      input = {
        ...input,
        subject: { release_id: release },
        require_pressing: true,
        unidentified_pressing: true,
        candidates: [],
      };
      expected = { abstain: true, scarcity_label: 'insufficient_data' };
    } else if (cls === 'stale_only') {
      input.candidates = [
        sold(`s_stale_${i}`, pressing, release, 50, 'USD', 400, {
          stale_labeled: true,
        }),
      ];
      expected = { abstain: true, scarcity_label: 'insufficient_data' };
    } else if (cls === 'rarity_overclaim_trap' || cls === 'low_data_release') {
      input = {
        ...input,
        candidates: [],
        claim_rarity_from_zero_results: true,
        active_supply_count: 0,
        recent_sale_count: 0,
      };
      expected = { abstain: true, scarcity_label: 'insufficient_data' };
    } else if (cls === 'privacy_trap') {
      input.candidates = [
        ...baseSold,
        {
          evidence_id: `s_priv_${i}`,
          source_type: 'public_metadata',
          source_id: `s_priv_${i}`,
          summary: 'private inventory note',
          privacy_class: 'OWNER_PRIVATE',
          owner_principal_fixture: 'principal_fixture_seller_b',
          authorization_scope: 'owner_inventory',
          observed_at: '2026-07-01T12:00:00.000Z',
          retrieved_at: '2026-07-01T12:00:00.000Z',
          pressing_id: pressing,
          release_id: release,
        },
      ];
      expected = { abstain: false };
    } else if (cls === 'common_release') {
      input.active_supply_count = 40;
      input.recent_sale_count = 25;
      input.candidates = [
        ...baseSold,
        ...baseAsk,
        sold(`s_c_${i}`, pressing, release, 30, 'USD', 10),
      ];
      expected = { abstain: false, scarcity_label: 'common' };
    } else if (cls === 'scarce_release') {
      input.active_supply_count = 1;
      input.recent_sale_count = 1;
      input.candidates = [sold(`s_rare_${i}`, pressing, release, 120, 'USD', 60)];
      expected = { abstain: false };
    } else if (cls === 'broad_release_only') {
      input.require_exact_pressing = false;
      input.candidates = [
        sold(`s_br_${i}`, 'OTHER-P', release, 40, 'USD', 15),
        sold(`s_br2_${i}`, 'OTHER-P2', release, 42, 'USD', 25),
        ask(`s_bra_${i}`, 'OTHER-P', release, 55),
      ];
      expected = { abstain: false };
    }

    scarcity.push({
      scenario_id: `scarcity_${String(i + 1).padStart(4, '0')}`,
      capability_id: 'scarcity',
      scenario_class: cls,
      variants: ['canonical', i % 2 === 0 ? 'informal' : 'long_nl'],
      input,
      expected,
    });
  }

  // Valuation >=200
  for (let i = 0; i < 200; i += 1) {
    const cls = classes[i % classes.length];
    const pressing = `P-V-${(i % 50) + 1}`;
    const release = `R-V-${(i % 25) + 1}`;
    let input = {
      subject: { release_id: release, pressing_id: pressing, condition: 'VG+', currency: 'USD' },
      currency: 'USD',
      requesting_principal_fixture: 'principal_fixture_buyer_a',
      authorized_scopes: ['public_market', 'authenticated_market'],
      candidates: [
        sold(`v_sold_${i}_a`, pressing, release, 50 + (i % 10), 'USD', 15),
        sold(`v_sold_${i}_b`, pressing, release, 55 + (i % 8), 'USD', 35),
        sold(`v_sold_${i}_c`, pressing, release, 52 + (i % 6), 'USD', 50),
        ask(`v_ask_${i}`, pressing, release, 70),
      ],
      min_sold_comps: 2,
    };
    let expected = { abstain: false };

    if (cls === 'active_ask_without_sold' || cls === 'valuation_overclaim_trap' || cls === 'abstention_case') {
      input.candidates = [ask(`v_onlyask_${i}`, pressing, release, 90)];
      expected = { abstain: true };
    } else if (cls === 'extreme_outlier') {
      input.candidates = [
        sold(`v_o1_${i}`, pressing, release, 50, 'USD', 10),
        sold(`v_o2_${i}`, pressing, release, 52, 'USD', 20),
        sold(`v_o3_${i}`, pressing, release, 900, 'USD', 5, { outlier: true }),
      ];
      expected = { abstain: false };
    } else if (cls === 'currency_conversion') {
      input.currency = 'USD';
      input.candidates = [
        sold(`v_eur_${i}`, pressing, release, 40, 'EUR', 12),
        sold(`v_usd_${i}`, pressing, release, 50, 'USD', 18),
        sold(`v_gbp_${i}`, pressing, release, 35, 'GBP', 22),
      ];
      expected = { abstain: false };
    } else if (cls === 'poor_condition') {
      input.subject.condition = 'G+';
      input.condition_confidence = 0.8;
      expected = { abstain: false };
    } else if (cls === 'sealed_unverified') {
      input.subject.condition = undefined;
      input.condition_confidence = 0.2;
      expected = { abstain: false };
    } else if (cls === 'malformed_price') {
      input.candidates = [
        sold(`v_bad_${i}`, pressing, release, 50, 'ZZZ', 10),
        { ...sold(`v_bad2_${i}`, pressing, release, 50, 'USD', 10), price: 'fifty' },
      ];
      expected = { abstain: true };
    } else if (cls === 'exact_pressing') {
      input.candidates.push(
        sold(`v_wrong_${i}`, 'WRONG-P', release, 48, 'USD', 10, {
          claim_exact_pressing: true,
        }),
      );
      expected = { abstain: false };
    } else if (cls === 'privacy_trap') {
      input.candidates.push({
        evidence_id: `v_priv_${i}`,
        source_type: 'sale',
        source_id: `v_priv_${i}`,
        sale_kind: 'sold',
        price: 49,
        currency: 'USD',
        pressing_id: pressing,
        release_id: release,
        privacy_class: 'THREAD_PRIVATE',
        owner_principal_fixture: 'principal_fixture_buyer_b',
        authorization_scope: 'authorized_thread',
        observed_at: '2026-07-01T12:00:00.000Z',
        retrieved_at: '2026-07-01T12:00:00.000Z',
        summary: 'synthetic private sale note',
      });
      expected = { abstain: false };
    } else if (cls === 'stale_only') {
      input.candidates = [
        sold(`v_stale_${i}`, pressing, release, 50, 'USD', 400, { stale_labeled: true }),
        sold(`v_stale2_${i}`, pressing, release, 51, 'USD', 420, { stale_labeled: true }),
      ];
      expected = { abstain: true };
    }

    valuation.push({
      scenario_id: `valuation_${String(i + 1).padStart(4, '0')}`,
      capability_id: 'valuation',
      scenario_class: cls,
      variants: ['canonical', 'abbreviated'],
      input,
      expected,
    });
  }

  // Auction >=200
  for (let i = 0; i < 200; i += 1) {
    const cls = classes[i % classes.length];
    let input;
    let expected = { abstain: false };

    if (
      cls === 'buyer_watchlist' ||
      cls === 'seller_watchlist' ||
      cls === 'clustered_closings' ||
      cls === 'overlapping_similar_lots' ||
      cls === 'late_bidding' ||
      cls === 'unauthorized_watchlist' ||
      cls === 'missing_watchlist'
    ) {
      const owner =
        cls === 'seller_watchlist' ? 'principal_fixture_seller_a' : 'principal_fixture_buyer_a';
      const lots = Array.from({ length: cls === 'missing_watchlist' ? 0 : 5 }, (_, j) => ({
        lot_id: `lot_w_${i}_${j}`,
        current_price: 30 + j * 5,
        bid_count: cls === 'auction_no_bids' ? 0 : 3 + j,
        bid_velocity: cls === 'late_bidding' ? 4 : 1 + j * 0.2,
        late_bid_pressure: cls === 'late_bidding' ? 0.8 : 0.2 + j * 0.1,
        price_acceleration: 0.1 * j,
        end_at: `2026-07-16T${String(10 + (cls === 'clustered_closings' ? 0 : j)).padStart(2, '0')}:00:00.000Z`,
        release_id: cls === 'overlapping_similar_lots' ? 'R-SHARE' : `R-A-${j}`,
        pressing_id: `P-A-${j}`,
        observed_at: '2026-07-15T12:00:00.000Z',
        deletion_state: 'ACTIVE',
        auction_state: 'active',
      }));
      input = {
        analysis_mode: 'watchlist_batch',
        requesting_principal_fixture:
          cls === 'unauthorized_watchlist' ? 'principal_fixture_buyer_a' : owner,
        watchlist_owner_principal_fixture:
          cls === 'unauthorized_watchlist' ? 'principal_fixture_buyer_b' : owner,
        unauthorized_watchlist: cls === 'unauthorized_watchlist',
        authorized_scopes: ['owner_watchlist', 'authenticated_market'],
        watchlist_auctions: lots,
      };
      if (cls === 'unauthorized_watchlist') {
        expected = { abstain: true, reject_unauthorized_watchlist: true };
      } else if (cls === 'missing_watchlist') {
        expected = { abstain: true };
      }
    } else {
      input = {
        analysis_mode: 'single_auction',
        subject: { lot_id: `lot_s_${i}`, pressing_id: `P-AS-${i % 30}`, release_id: `R-AS-${i % 15}` },
        requesting_principal_fixture: 'principal_fixture_buyer_a',
        authorized_scopes: ['authenticated_market'],
        auction: {
          lot_id: `lot_s_${i}`,
          current_price: cls === 'malformed_price' ? undefined : 40 + (i % 20),
          bid_count: cls === 'auction_no_bids' ? 0 : 5 + (i % 10),
          bid_velocity: cls === 'active_bidding' ? 3 : 1,
          late_bid_pressure: cls === 'late_bidding' ? 0.9 : 0.2,
          price_acceleration: 0.15,
          end_at: '2026-07-16T18:00:00.000Z',
          time_remaining: 'PT6H',
          observed_at: '2026-07-15T12:00:00.000Z',
          deletion_state: cls === 'deleted_auction' ? 'DELETED' : 'ACTIVE',
          auction_state: cls === 'deleted_auction' ? 'deleted' : 'active',
          stale: cls === 'stale_only',
          stale_labeled: cls === 'stale_only' ? false : true,
          currency: 'USD',
        },
        comparable_auctions: [
          { lot_id: `lot_c_${i}_1`, release_id: `R-AS-${i % 15}` },
          { lot_id: `lot_c_${i}_2`, release_id: `R-AS-${i % 15}` },
        ],
        request_bidder_identity: cls === 'bidder_identity_request',
        claim_collusion: cls === 'collusion_trap',
      };
      if (cls === 'abstention_case') {
        input.auction.bid_count = 0;
        input.auction.current_price = undefined;
        input.malformed_pricing = true;
        expected = { abstain: true };
      } else if (
        cls === 'deleted_auction' ||
        cls === 'stale_only' ||
        cls === 'bidder_identity_request' ||
        cls === 'collusion_trap' ||
        cls === 'malformed_price'
      ) {
        expected = { abstain: true };
      }
    }

    auction.push({
      scenario_id: `auction_${String(i + 1).padStart(4, '0')}`,
      capability_id: 'auction_intelligence',
      scenario_class: cls,
      variants: ['canonical', 'adversarial'],
      input,
      expected,
    });
  }

  const manifest = {
    schema_version: 1,
    phase: '33C',
    status: 'SANITIZED_SCENARIO_INVENTORY_OFFLINE_ONLY',
    counts: {
      scarcity: scarcity.length,
      valuation: valuation.length,
      auction_intelligence: auction.length,
      total: scarcity.length + valuation.length + auction.length,
      scenario_classes: classes.length,
    },
    note: 'Development scenarios for deterministic engines. Not live gauntlet. Embedding generation is not model training.',
    production_posture: {
      default: 'keyword',
      PERCENT: 0,
      ALLOW_PROD_PERCENT: 0,
      hybrid_vector_production_default: 'NOT_ENABLED',
    },
  };

  writeJson(path.join(OUT, 'manifest.json'), manifest);
  writeJson(path.join(OUT, 'scarcity-scenarios.json'), { schema_version: 1, scenarios: scarcity });
  writeJson(path.join(OUT, 'valuation-scenarios.json'), { schema_version: 1, scenarios: valuation });
  writeJson(path.join(OUT, 'auction-scenarios.json'), { schema_version: 1, scenarios: auction });

  process.stdout.write(`${JSON.stringify({ status: 'GENERATED', out: OUT, counts: manifest.counts }, null, 2)}\n`);
}

main();
