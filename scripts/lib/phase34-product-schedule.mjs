/**
 * Phase 34 product gauntlet — deterministic stratified interleaved schedule.
 * Limits and split counts come only from phase34-product-schedule-config.mjs.
 */
import crypto from 'node:crypto';
import { CAPABILITIES } from './phase33f-manifest.mjs';
import {
  PRODUCT_SCHEDULE_CONFIG_VERSION,
  MAX_CAPABILITY_RUN,
  MAX_SPLIT_RUN,
  MAX_PARTICIPANT_SIDE_RUN,
  MAX_AUTHORIZATION_RUN,
  MAX_SIDE_RUN,
  DATASET_SPLITS,
  SPLIT_INTERLEAVE_PATTERN,
  PRODUCT_SCALE,
  DEFAULT_SCHEDULE_SEED,
} from './phase34-product-schedule-config.mjs';

export {
  PRODUCT_SCHEDULE_CONFIG_VERSION,
  MAX_CAPABILITY_RUN,
  MAX_SPLIT_RUN,
  MAX_PARTICIPANT_SIDE_RUN,
  MAX_AUTHORIZATION_RUN,
  MAX_SIDE_RUN,
  DATASET_SPLITS,
  PRODUCT_SCALE,
  DEFAULT_SCHEDULE_SEED,
};

export const PRODUCT_GAUNTLET_SCHEDULE_VERSION = 'phase34-product-schedule-v2';
export const PRODUCT_CAPABILITIES = Object.freeze([...CAPABILITIES]);
export const PARTICIPANT_SIDES = Object.freeze(['buyer', 'seller']);
export const MULTI_TURN_CLASSES = Object.freeze(['single', 'multi_4_12']);
export const EVIDENCE_STRENGTHS = Object.freeze(['strong', 'weak', 'stale', 'ambiguous']);
export const AUTHORIZATION_STATES = Object.freeze(['authorized', 'unauthorized']);

export const SCENARIO_CLASSES_BY_CAPABILITY = Object.freeze({
  scarcity: [
    'record_detail_exact_pressing',
    'ambiguous_release',
    'seller_inventory',
    'buyer_watchlist',
    'zero_inventory_no_false_rarity',
    'weak_data_abstention',
    'stale_evidence',
  ],
  valuation: [
    'record_detail',
    'listing_creation',
    'listing_editing',
    'buyer_offer_context',
    'quick_fair_patient_ranges',
    'sold_vs_asking_separation',
    'condition_correction',
    'ambiguous_pressing',
  ],
  auction_intelligence: [
    'individual_auction',
    'buyer_watchlist',
    'seller_dashboard',
    'watchlist_temperature_batch',
    'underpriced_lots',
    'overheated_lots',
    'ending_time_clustering',
    'weak_data_state',
  ],
  embeddings: [
    'current_embedding',
    'stale_embedding',
    'deleted_source_propagation',
    'reembedding_required',
    'owner_scope_restriction',
    'lineage_admin_diagnostics',
  ],
  semantic_search: [
    'keyword',
    'semantic',
    'hybrid',
    'owner_scoped',
    'exact_pressing',
    'ambiguous_pressing',
    'misspelling',
    'abbreviation',
    'negative_filter',
    'contradiction_filter',
    'visible_fallback_failure',
    'dense_result_list',
  ],
  negotiation_assistance: [
    'authorized_buyer_thread',
    'authorized_seller_thread',
    'unauthorized_thread',
    'message_correction',
    'deleted_message_exclusion',
    'offer_history_change',
    'evidence_backed_strategy',
    'editable_ai_draft',
    'insert_not_send',
    'fabricated_leverage_refusal',
    'unsafe_tactic_refusal',
  ],
  recommendations: [
    'personalized_feed',
    'record_detail',
    'collection_gap',
    'watchlist_relation',
    'price_condition_fit',
    'budget_constraint',
    'negative_preference',
    'diversity',
    'cold_start',
    'deleted_unavailable_exclusion',
  ],
  market_analytics: [
    'buyer_dashboard',
    'seller_dashboard',
    'collection_analytics',
    'auction_watchlist_report',
    'twelve_month_trend',
    'sample_size_warning',
    'stale_data_warning',
    'currency_handling',
    'methodology_expansion',
  ],
});

export function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromText(seedText) {
  const hex = crypto.createHash('sha256').update(String(seedText)).digest('hex').slice(0, 8);
  return Number.parseInt(hex, 16) >>> 0;
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

export function maxContiguousRun(rows, keyFn) {
  if (rows.length === 0) return 0;
  let max = 1;
  let cur = 1;
  for (let i = 1; i < rows.length; i += 1) {
    if (keyFn(rows[i]) === keyFn(rows[i - 1])) {
      cur += 1;
      max = Math.max(max, cur);
    } else {
      cur = 1;
    }
  }
  return max;
}

function assignSplit(index) {
  return SPLIT_INTERLEAVE_PATTERN[index % SPLIT_INTERLEAVE_PATTERN.length];
}

function stableRow(r) {
  return {
    schedule_index: r.schedule_index,
    session_ordinal: r.session_ordinal,
    capability: r.capability,
    scenario_id: r.scenario_id,
    scenario_class: r.scenario_class,
    participant_side: r.participant_side,
    dataset_split: r.dataset_split,
    evidence_strength: r.evidence_strength,
    authorization_state: r.authorization_state,
    multi_turn_class: r.multi_turn_class,
    prompt_slot: r.prompt_slot,
    prompt_configuration_id: r.prompt_configuration_id,
    model_tier: r.model_tier,
    coordinate: r.coordinate,
  };
}

/**
 * @param {object} opts
 * @param {'canary'|'full'} [opts.scale]
 * @param {string} [opts.seed]
 */
export function buildInterleavedProductSchedule(opts = {}) {
  const scaleName = opts.scale === 'full' ? 'full' : 'canary';
  const scale = PRODUCT_SCALE[scaleName];
  const seed = opts.seed || DEFAULT_SCHEDULE_SEED[scaleName];
  const rngSeed = seedFromText(seed);
  const rng = mulberry32(rngSeed);
  const perCap = scale.perCapability;
  const total = scale.logicalSessions;
  const multiPerCap = Math.ceil(scale.minMultiTurnSessions / PRODUCT_CAPABILITIES.length);

  /** @type {Record<string, object[]>} */
  const queues = Object.fromEntries(PRODUCT_CAPABILITIES.map((c) => [c, []]));

  for (const capability of PRODUCT_CAPABILITIES) {
    const scenarios = SCENARIO_CLASSES_BY_CAPABILITY[capability];
    for (let i = 0; i < perCap; i += 1) {
      const scenario_class = scenarios[i % scenarios.length];
      const participant_side = PARTICIPANT_SIDES[i % PARTICIPANT_SIDES.length];
      const evidence_strength = EVIDENCE_STRENGTHS[i % EVIDENCE_STRENGTHS.length];
      const multi_turn_class = i < multiPerCap ? 'multi_4_12' : 'single';
      const prompt_slot = (i % 12) + 1;
      queues[capability].push({
        capability,
        scenario_id: `${capability}__${scenario_class}__${i}`,
        scenario_class,
        participant_side,
        evidence_strength,
        multi_turn_class,
        prompt_slot,
        prompt_configuration_id: `${capability}-c${String(prompt_slot).padStart(2, '0')}`,
        model_tier: prompt_slot <= 4 ? 'deterministic' : prompt_slot <= 8 ? 'local' : 'frontier',
        _cap_index: i,
      });
    }
    shuffleInPlace(queues[capability], rng);
    const buyers = queues[capability].filter((r) => r.participant_side === 'buyer');
    const sellers = queues[capability].filter((r) => r.participant_side === 'seller');
    const zigzag = [];
    while (buyers.length || sellers.length) {
      if (buyers.length) zigzag.push(buyers.shift());
      if (sellers.length) zigzag.push(sellers.shift());
    }
    queues[capability] = zigzag;
  }

  const capOrder = [...PRODUCT_CAPABILITIES];
  const start = rngSeed % capOrder.length;
  const rotated = [...capOrder.slice(start), ...capOrder.slice(0, start)];
  /** @type {object[]} */
  const rows = [];
  for (let i = 0; i < perCap; i += 1) {
    for (const capability of rotated) {
      const base = queues[capability][i];
      const schedule_index = rows.length;
      const dataset_split = assignSplit(schedule_index);
      // 7 authorized + 1 unauthorized repeating ⇒ max contiguous auth run ≤ 7
      const authorization_state = schedule_index % 8 === 7 ? 'unauthorized' : 'authorized';
      const coordinate = [
        capability,
        base.scenario_class,
        base.participant_side,
        dataset_split,
        base.evidence_strength,
        authorization_state,
        base.multi_turn_class,
        String(base.prompt_slot),
        String(base._cap_index),
      ].join('|');
      rows.push({
        capability: base.capability,
        scenario_id: base.scenario_id,
        scenario_class: base.scenario_class,
        participant_side: base.participant_side,
        dataset_split,
        evidence_strength: base.evidence_strength,
        authorization_state,
        multi_turn_class: base.multi_turn_class,
        prompt_slot: base.prompt_slot,
        prompt_configuration_id: base.prompt_configuration_id,
        model_tier: base.model_tier,
        coordinate,
        schedule_index,
        session_ordinal: schedule_index + 1,
      });
    }
  }

  if (rows.length !== total) {
    const err = new Error(`schedule size ${rows.length} != expected ${total}`);
    err.code = 'PHASE34_PRODUCT_SCHEDULE_INVALID';
    throw err;
  }

  const coords = new Set(rows.map((r) => r.coordinate));
  if (coords.size !== rows.length) {
    const err = new Error('duplicate schedule coordinates');
    err.code = 'PHASE34_PRODUCT_SCHEDULE_DUPLICATE';
    throw err;
  }

  const splitCounts = Object.fromEntries(DATASET_SPLITS.map((s) => [s, 0]));
  for (const r of rows) splitCounts[r.dataset_split] += 1;
  for (const [k, expected] of Object.entries(scale.splitCounts)) {
    if (splitCounts[k] !== expected) {
      const err = new Error(`split ${k} count ${splitCounts[k]} != ${expected}`);
      err.code = 'PHASE34_PRODUCT_SCHEDULE_SPLIT_COUNT';
      throw err;
    }
  }

  const capRun = maxContiguousRun(rows, (r) => r.capability);
  const splitRun = maxContiguousRun(rows, (r) => r.dataset_split);
  const sideRun = maxContiguousRun(rows, (r) => r.participant_side);
  const authRun = maxContiguousRun(rows, (r) => r.authorization_state);
  if (
    capRun > MAX_CAPABILITY_RUN ||
    splitRun > MAX_SPLIT_RUN ||
    sideRun > MAX_PARTICIPANT_SIDE_RUN ||
    authRun > MAX_AUTHORIZATION_RUN
  ) {
    const err = new Error(
      `interleave run limits exceeded (cap=${capRun}, split=${splitRun}, side=${sideRun}, auth=${authRun})`,
    );
    err.code = 'PHASE34_PRODUCT_SCHEDULE_INTERLEAVE_FAILED';
    err.details = { capRun, splitRun, sideRun, authRun };
    throw err;
  }

  // Reject any 2500-row capability block.
  for (let i = 0; i + 2500 <= rows.length; i += 1) {
    const windowCaps = new Set(rows.slice(i, i + 2500).map((r) => r.capability));
    if (windowCaps.size === 1) {
      const err = new Error(`capability block of 2500 detected at index ${i}`);
      err.code = 'PHASE34_PRODUCT_SCHEDULE_CAPABILITY_BLOCK';
      throw err;
    }
  }

  const multiTurnCount = rows.filter((r) => r.multi_turn_class === 'multi_4_12').length;
  const body = {
    schema_version: PRODUCT_GAUNTLET_SCHEDULE_VERSION,
    config_version: PRODUCT_SCHEDULE_CONFIG_VERSION,
    scale: scaleName,
    seed,
    seed_u32: rngSeed,
    interleave: 'round_robin_per_capability',
    logical_sessions: rows.length,
    per_capability: Object.fromEntries(
      PRODUCT_CAPABILITIES.map((c) => [c, rows.filter((r) => r.capability === c).length]),
    ),
    split_counts: splitCounts,
    multi_turn_sessions: multiTurnCount,
    max_runs: {
      capability: capRun,
      dataset_split: splitRun,
      participant_side: sideRun,
      authorization_state: authRun,
      limits: {
        capability: MAX_CAPABILITY_RUN,
        dataset_split: MAX_SPLIT_RUN,
        participant_side: MAX_PARTICIPANT_SIDE_RUN,
        authorization_state: MAX_AUTHORIZATION_RUN,
      },
    },
    CAPABILITY_SCHEDULING: 'DETERMINISTIC_STRATIFIED_INTERLEAVE',
    rows,
  };

  body.schedule_sha256 = crypto
    .createHash('sha256')
    .update(JSON.stringify({ ...body, rows: body.rows.map(stableRow) }))
    .digest('hex');
  return body;
}

export function validateProductSchedule(schedule) {
  const violations = [];
  const scale = PRODUCT_SCALE[schedule.scale];
  if (schedule.rows.length !== scale.logicalSessions) {
    violations.push(`logical_sessions ${schedule.rows.length} != ${scale.logicalSessions}`);
  }
  for (const c of PRODUCT_CAPABILITIES) {
    if (schedule.per_capability[c] !== scale.perCapability) {
      violations.push(`${c} count ${schedule.per_capability[c]} != ${scale.perCapability}`);
    }
  }
  for (const [k, expected] of Object.entries(scale.splitCounts)) {
    if (schedule.split_counts?.[k] !== expected) {
      violations.push(`split ${k} ${schedule.split_counts?.[k]} != ${expected}`);
    }
  }
  if (schedule.multi_turn_sessions < scale.minMultiTurnSessions) {
    violations.push(`multi_turn ${schedule.multi_turn_sessions} < ${scale.minMultiTurnSessions}`);
  }
  if (schedule.max_runs.capability > MAX_CAPABILITY_RUN) {
    violations.push(`capability run ${schedule.max_runs.capability} > ${MAX_CAPABILITY_RUN}`);
  }
  if (schedule.max_runs.dataset_split > MAX_SPLIT_RUN) {
    violations.push(`split run ${schedule.max_runs.dataset_split} > ${MAX_SPLIT_RUN}`);
  }
  if (schedule.max_runs.participant_side > MAX_PARTICIPANT_SIDE_RUN) {
    violations.push(`side run ${schedule.max_runs.participant_side} > ${MAX_PARTICIPANT_SIDE_RUN}`);
  }
  if ((schedule.max_runs.authorization_state ?? 0) > MAX_AUTHORIZATION_RUN) {
    violations.push(`auth run ${schedule.max_runs.authorization_state} > ${MAX_AUTHORIZATION_RUN}`);
  }
  if (schedule.CAPABILITY_SCHEDULING !== 'DETERMINISTIC_STRATIFIED_INTERLEAVE') {
    violations.push('CAPABILITY_SCHEDULING must be DETERMINISTIC_STRATIFIED_INTERLEAVE');
  }
  const coords = new Set(schedule.rows.map((r) => r.coordinate));
  if (coords.size !== schedule.rows.length) violations.push('duplicate coordinates');
  const sessionIds = new Set(schedule.rows.map((r) => r.scenario_id + '|' + r.schedule_index));
  if (sessionIds.size !== schedule.rows.length) violations.push('duplicate session keys');

  // Exactly one MAX_SPLIT_RUN export in config module (compile-time contract checked in tests).
  if (MAX_SPLIT_RUN !== 16) {
    violations.push(`MAX_SPLIT_RUN must remain 16 (got ${MAX_SPLIT_RUN})`);
  }

  return { status: violations.length === 0 ? 'PASS' : 'BLOCKED', violations };
}
