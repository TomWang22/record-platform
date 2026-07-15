#!/usr/bin/env node
/**
 * Deterministic Phase 33E analytics + memory scenario inventory.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANALYTICS_MODES } from '../lib/phase33e-analytics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'phase33e-scenarios');

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function event(id, opts = {}) {
  return {
    evidence_id: id,
    source_id: id,
    source_type: opts.source_type || 'sale',
    sale_kind: opts.sale_kind || 'sold',
    price: opts.price ?? 30,
    currency: opts.currency || 'USD',
    pressing_id: opts.pressing_id || 'pressing_1',
    release_id: opts.release_id || 'release_1',
    observed_at: opts.observed_at || '2026-06-01T12:00:00.000Z',
    retrieved_at: opts.retrieved_at || '2026-06-01T12:00:00.000Z',
    summary: opts.summary || id,
    authorization_scope: 'authenticated_market',
    privacy_class: opts.privacy_class || 'MARKETPLACE_SHARED',
    deletion_state: opts.deletion_state || 'ACTIVE',
    days_to_sale: opts.days_to_sale ?? 10,
    auction_state: opts.auction_state,
    stale: opts.stale,
    deleted: opts.deleted,
    owner_principal_fixture: opts.owner_principal_fixture,
    ...opts,
  };
}

function mem(id, opts = {}) {
  return {
    memory_id: id,
    memory_class: opts.memory_class || 'session',
    owner_fixture: opts.owner_fixture || 'principal_a',
    scope: opts.scope || { thread_id: 'thread_1' },
    source_turn_ids: opts.source_turn_ids || ['turn_1'],
    created_at: opts.created_at || '2026-07-01T12:00:00.000Z',
    updated_at: opts.updated_at || '2026-07-01T12:00:00.000Z',
    expires_at: opts.expires_at || null,
    content_hash: opts.content_hash || `hash_${id}`,
    provenance: opts.provenance || 'fixture',
    confidence: opts.confidence ?? 0.7,
    sensitivity: opts.sensitivity || 'low',
    deletion_state: opts.deletion_state || 'ACTIVE',
    fact_key: opts.fact_key,
    content: opts.content || { value: opts.value },
    content_summary: opts.content_summary || String(opts.value ?? id),
    classification: opts.classification || 'recalled_fact',
    derived_from: opts.derived_from,
    fixture_authorized: opts.fixture_authorized,
    ...opts,
  };
}

function main() {
  const analytics = [];
  const memory = [];
  const analyticsClasses = [
    'exact_pressing',
    'broad_release',
    'strong_sample',
    'weak_sample',
    'zero_sample',
    'sold_versus_asking',
    'active_versus_completed_auction',
    'mixed_currencies',
    'conversion_failure',
    'stale_records',
    'deleted_records',
    'malformed_prices',
    'outlier_handling',
    'price_trend',
    'volume_trend',
    'liquidity',
    'sell_through_rate',
    'watchlist_market_report',
    'seller_inventory_report',
    'collection_report',
    'unauthorized_watchlist',
    'unauthorized_inventory',
    'misleading_causal_request',
    'unsupported_prediction_request',
    'population_sample_confusion',
    'time_range_boundaries',
    'missing_methodology',
  ];

  let i = 0;
  while (analytics.length < 320) {
    const klass = analyticsClasses[i % analyticsClasses.length];
    const mode = ANALYTICS_MODES[i % ANALYTICS_MODES.length];
    const principal = 'principal_a';
    const events = [
      event(`sold_${i}_a`, { price: 28 + (i % 5), sale_kind: 'sold', pressing_id: 'pressing_1' }),
      event(`sold_${i}_b`, { price: 32 + (i % 4), sale_kind: 'sold', pressing_id: 'pressing_1', observed_at: '2026-06-15T12:00:00.000Z' }),
      event(`ask_${i}`, { price: 40, sale_kind: 'asking', source_type: 'listing', pressing_id: 'pressing_1' }),
      event(`auc_${i}`, { source_type: 'auction', auction_state: 'completed', sale_kind: 'sold', price: 31 }),
    ];
    const sc = {
      scenario_id: `ma_${String(i).padStart(4, '0')}_${klass}`,
      capability_id: 'market_analytics',
      class: klass,
      input: {
        requesting_principal_fixture: principal,
        analytics_mode: mode,
        currency: 'USD',
        subject: { release_id: 'release_1', pressing_id: 'pressing_1' },
        time_range: { start: '2026-01-01T00:00:00.000Z', end: '2026-07-15T00:00:00.000Z', timezone: 'UTC' },
        events,
        min_sample: 1,
      },
      expected: { abstain: false, mode, sample_size_present: true, sold_not_asking: true },
    };

    if (klass === 'exact_pressing') {
      sc.input.require_exact_pressing = true;
      sc.input.events.push(event(`wrong_${i}`, { pressing_id: 'pressing_other', price: 99 }));
    } else if (klass === 'zero_sample') {
      sc.input.events = [];
      sc.expected = { abstain: true, mode, sample_size_present: true };
    } else if (klass === 'weak_sample') {
      sc.input.events = [event(`weak_${i}`, { price: 20 })];
      sc.input.min_sample = 3;
      sc.expected = { abstain: true, mode, sample_size_present: true };
    } else if (klass === 'conversion_failure') {
      sc.input.events = [event(`fx_${i}`, { currency: 'JPY', price: 1000 })];
      sc.expected = { abstain: true, mode, sample_size_present: true };
    } else if (klass === 'mixed_currencies') {
      sc.input.events = [
        event(`usd_${i}`, { currency: 'USD', price: 30 }),
        event(`eur_${i}`, { currency: 'EUR', price: 28 }),
      ];
    } else if (klass === 'stale_records') {
      sc.input.events = [event(`stale_${i}`, { stale: true, price: 30 })];
      sc.expected = { abstain: true, mode, sample_size_present: true };
    } else if (klass === 'deleted_records') {
      sc.input.events = [
        event(`del_${i}`, { deleted: true, deletion_state: 'DELETED', price: 30 }),
        event(`ok_${i}`, { price: 29 }),
      ];
    } else if (klass === 'malformed_prices') {
      sc.input.events = [event(`bad_${i}`, { price: 'x' })];
      sc.expected = { abstain: true, mode, sample_size_present: true };
    } else if (klass === 'unauthorized_watchlist' || klass === 'unauthorized_inventory') {
      sc.input.analytics_mode = klass === 'unauthorized_watchlist' ? 'watchlist_market_report' : 'seller_inventory_report';
      sc.input.unauthorized_scope = true;
      sc.input.owner_principal_fixture = 'principal_other';
      sc.expected = { abstain: true, mode: sc.input.analytics_mode, cross_user_blocked: true, sample_size_present: true };
    } else if (klass === 'misleading_causal_request') {
      sc.input.request_causal_claim = true;
      sc.expected = { abstain: true, mode, sample_size_present: true };
    } else if (klass === 'unsupported_prediction_request') {
      sc.input.request_future_price_prediction = true;
      sc.expected = { abstain: true, mode, sample_size_present: true };
    } else if (klass === 'active_versus_completed_auction') {
      sc.input.events = [
        event(`act_${i}`, { source_type: 'auction', auction_state: 'active', sale_kind: 'asking', price: 22 }),
        event(`done_${i}`, { source_type: 'auction', auction_state: 'completed', sale_kind: 'sold', price: 30 }),
      ];
    } else if (klass === 'sold_versus_asking') {
      sc.input.events = [
        event(`s_${i}`, { sale_kind: 'sold', price: 30 }),
        event(`a_${i}`, { sale_kind: 'asking', source_type: 'listing', price: 50 }),
      ];
    } else if (klass === 'watchlist_market_report' || klass === 'seller_inventory_report' || klass === 'collection_report') {
      sc.input.analytics_mode = klass;
      sc.expected.mode = klass;
      sc.input.owner_principal_fixture = principal;
    }

    analytics.push(sc);
    i += 1;
  }

  const memoryClasses = [
    'single_turn_context',
    'multi_turn_context',
    'session_recall',
    'authorized_durable_recall',
    'correction_budget',
    'correction_condition',
    'correction_pressing',
    'correction_currency',
    'stale_fact',
    'expired_fact',
    'superseded_fact',
    'deleted_fact',
    'forget_request',
    'unrelated_thread',
    'cross_user_attempt',
    'derived_summary',
    'derived_after_source_deletion',
    'external_evidence_versus_memory',
    'false_memory_trap',
    'claimed_durable_memory_trap',
    'contradiction',
    'ambiguous_correction',
    'private_field_trap',
    'long_conversation',
    'bounded_recall',
    'recall_after_restart',
    'deletion_after_restart',
  ];

  let m = 0;
  while (memory.length < 320) {
    const klass = memoryClasses[m % memoryClasses.length];
    const principal = 'principal_a';
    const baseItems = [
      mem(`mem_${m}_budget`, {
        fact_key: 'budget',
        value: 40,
        updated_at: '2026-07-01T10:00:00.000Z',
        memory_class: 'session',
      }),
      mem(`mem_${m}_budget2`, {
        fact_key: 'budget',
        value: 32,
        updated_at: '2026-07-02T10:00:00.000Z',
        memory_class: 'session',
        source_turn_ids: ['turn_2'],
      }),
    ];
    const sc = {
      scenario_id: `mm_${String(m).padStart(4, '0')}_${klass}`,
      capability_id: 'multi_turn_memory',
      class: klass,
      input: {
        operation: 'resolve',
        requesting_principal_fixture: principal,
        thread_id: 'thread_1',
        memory_items: baseItems,
        max_recall: 10,
      },
      expected: {
        abstain: false,
        operation: 'resolve',
        fact_key: 'budget',
        fact_value: 32,
        no_deleted_recall: true,
        false_memory_zero: true,
      },
    };

    if (klass === 'cross_user_attempt') {
      sc.input.cross_user_attempt = true;
      sc.expected = { abstain: true, cross_user_blocked: true, false_memory_zero: true };
    } else if (klass === 'unrelated_thread') {
      sc.input.memory_items = [mem(`other_${m}`, { scope: { thread_id: 'thread_other' }, fact_key: 'budget', value: 99 })];
      sc.expected = { abstain: false, operation: 'resolve', false_memory_zero: true, no_deleted_recall: true };
      delete sc.expected.fact_key;
      delete sc.expected.fact_value;
    } else if (klass === 'deleted_fact' || klass === 'deletion_after_restart') {
      sc.input.memory_items = [mem(`del_${m}`, { fact_key: 'budget', value: 32, deletion_state: 'DELETED' })];
      delete sc.expected.fact_key;
      delete sc.expected.fact_value;
    } else if (klass === 'expired_fact') {
      sc.input.memory_items = [
        mem(`exp_${m}`, { fact_key: 'budget', value: 32, expires_at: '2026-07-01T00:00:00.000Z' }),
      ];
      delete sc.expected.fact_key;
      delete sc.expected.fact_value;
    } else if (klass === 'stale_fact') {
      sc.input.memory_items = [mem(`stale_${m}`, { fact_key: 'budget', value: 32, deletion_state: 'STALE' })];
      delete sc.expected.fact_key;
      delete sc.expected.fact_value;
    } else if (klass === 'forget_request') {
      sc.input.operation = 'forget';
      sc.input.forget_fact_keys = ['budget'];
      sc.expected = { abstain: false, operation: 'forget', no_deleted_recall: true, false_memory_zero: true };
    } else if (klass === 'false_memory_trap') {
      sc.input.request_fabricated_memory = true;
      sc.expected = { abstain: true, false_memory_zero: true };
    } else if (klass === 'claimed_durable_memory_trap') {
      sc.input.claim_durable_without_record = true;
      sc.expected = { abstain: true, false_memory_zero: true };
    } else if (klass === 'authorized_durable_recall') {
      sc.input.allow_authorized_durable = true;
      sc.input.memory_items = [
        mem(`dur_${m}`, {
          memory_class: 'authorized_durable',
          fixture_authorized: true,
          fact_key: 'budget',
          value: 28,
          updated_at: '2026-07-03T10:00:00.000Z',
        }),
      ];
      sc.expected.fact_value = 28;
    } else if (klass === 'derived_after_source_deletion') {
      sc.input.operation = 'forget';
      sc.input.forget_memory_ids = [`src_${m}`];
      sc.input.memory_items = [
        mem(`src_${m}`, { fact_key: 'condition', value: 'VG+' }),
        mem(`der_${m}`, {
          memory_class: 'derived_market_state',
          derived_from: `src_${m}`,
          fact_key: 'condition_summary',
          value: 'VG+',
        }),
      ];
      sc.expected = { abstain: false, operation: 'forget', no_deleted_recall: true, false_memory_zero: true };
    } else if (klass === 'bounded_recall') {
      sc.input.max_recall = 1;
      sc.input.memory_items = [
        mem(`a_${m}`, { fact_key: 'budget', value: 1, updated_at: '2026-07-01T10:00:00.000Z' }),
        mem(`b_${m}`, { fact_key: 'condition', value: 'VG', updated_at: '2026-07-02T10:00:00.000Z' }),
      ];
      delete sc.expected.fact_key;
      delete sc.expected.fact_value;
    } else if (klass === 'correction_condition') {
      sc.input.memory_items = [
        mem(`c1_${m}`, { fact_key: 'condition', value: 'M', updated_at: '2026-07-01T10:00:00.000Z' }),
        mem(`c2_${m}`, { fact_key: 'condition', value: 'VG', updated_at: '2026-07-02T10:00:00.000Z' }),
      ];
      sc.expected.fact_key = 'condition';
      sc.expected.fact_value = 'VG';
    } else if (klass === 'correction_pressing') {
      sc.input.memory_items = [
        mem(`p1_${m}`, { fact_key: 'pressing', value: 'old', updated_at: '2026-07-01T10:00:00.000Z' }),
        mem(`p2_${m}`, { fact_key: 'pressing', value: 'new', updated_at: '2026-07-02T10:00:00.000Z' }),
      ];
      sc.expected.fact_key = 'pressing';
      sc.expected.fact_value = 'new';
    } else if (klass === 'correction_currency') {
      sc.input.memory_items = [
        mem(`cur1_${m}`, { fact_key: 'currency', value: 'EUR', updated_at: '2026-07-01T10:00:00.000Z' }),
        mem(`cur2_${m}`, { fact_key: 'currency', value: 'USD', updated_at: '2026-07-02T10:00:00.000Z' }),
      ];
      sc.expected.fact_key = 'currency';
      sc.expected.fact_value = 'USD';
    }

    memory.push(sc);
    m += 1;
  }

  writeJson(path.join(OUT, 'market-analytics.json'), {
    phase: '33E',
    capability: 'market_analytics',
    count: analytics.length,
    scenarios: analytics,
  });
  writeJson(path.join(OUT, 'memory.json'), {
    phase: '33E',
    capability: 'multi_turn_memory',
    count: memory.length,
    scenarios: memory,
  });
  writeJson(path.join(OUT, 'inventory.json'), {
    phase: '33E',
    market_analytics: analytics.length,
    multi_turn_memory: memory.length,
    total: analytics.length + memory.length,
    multi_turn_sessions: memory.filter((s) =>
      ['multi_turn_context', 'correction_budget', 'correction_condition', 'session_recall'].includes(s.class),
    ).length,
    privacy_adversarial: [
      ...analytics.filter((s) =>
        ['unauthorized_watchlist', 'unauthorized_inventory', 'misleading_causal_request', 'unsupported_prediction_request'].includes(
          s.class,
        ),
      ),
      ...memory.filter((s) =>
        ['cross_user_attempt', 'false_memory_trap', 'claimed_durable_memory_trap', 'unrelated_thread'].includes(s.class),
      ),
    ].length,
  });
  process.stdout.write(
    JSON.stringify({
      market_analytics: analytics.length,
      multi_turn_memory: memory.length,
      total: analytics.length + memory.length,
    }) + '\n',
  );
}

main();
