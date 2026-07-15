/**
 * Phase 33E orchestrator — market analytics + memory routing and hard stops.
 */
import { analyzeMarketAnalytics } from './phase33e-analytics.mjs';
import { analyzeMemory } from './phase33e-memory.mjs';
import {
  FORBIDDEN_TRAINING_PATTERNS,
  PRIVATE_FIELD_PATTERNS,
} from './phase33a-intelligence-capability-contracts.mjs';

export const PROMPT_TEMPLATES = {
  market_analytics: { id: 'analytics-explain', version: '1', role: 'explain_after_facts' },
  multi_turn_memory: { id: 'memory-summarize', version: '1', role: 'explain_after_recall' },
};

export function runCapability(capability, input = {}) {
  switch (capability) {
    case 'market_analytics':
      return analyzeMarketAnalytics(input);
    case 'multi_turn_memory':
    case 'memory':
      return analyzeMemory(input);
    default: {
      const _exhaustive = capability;
      throw new Error(`unknown_capability:${_exhaustive}`);
    }
  }
}

export function validateCapabilityResultShape(capability, result) {
  const violations = [];
  if (!result || typeof result !== 'object') return ['schema_invalid:not_object'];
  for (const k of ['evidence', 'confidence', 'limitations']) {
    if (!(k in result)) violations.push(`schema_invalid:missing:${k}`);
  }
  if (typeof result.confidence !== 'number' || result.confidence < 0 || result.confidence > 1) {
    violations.push('schema_invalid:confidence');
  }
  const cap = capability === 'memory' ? 'multi_turn_memory' : capability;
  if (cap === 'market_analytics') {
    for (const k of [
      'analytics_mode',
      'time_range',
      'population_size',
      'sample_size',
      'pricing',
      'liquidity',
      'sold_count',
    ]) {
      if (!(k in result)) violations.push(`schema_invalid:missing:${k}`);
    }
    if (result.sample_size == null) violations.push('hard:missing_sample_size');
    if (!result.time_range?.start || !result.time_range?.end) violations.push('hard:missing_time_range');
  }
  if (cap === 'multi_turn_memory') {
    for (const k of [
      'operation',
      'recalled_items',
      'excluded_items',
      'current_facts',
      'false_memory_claims',
      'unauthorized_durable_write',
    ]) {
      if (!(k in result)) violations.push(`schema_invalid:missing:${k}`);
    }
    if (result.false_memory_claims !== 0) violations.push('hard:false_memory');
    if (result.unauthorized_durable_write !== false) violations.push('hard:unauthorized_durable_write');
  }
  return violations;
}

export function scanTextHardStops(text) {
  const violations = [];
  for (const re of PRIVATE_FIELD_PATTERNS) {
    if (re.test(text)) violations.push('private_field');
  }
  const stripped = text
    .replace(/embedding generation is not model training/gi, '')
    .replace(/not model training/gi, '')
    .replace(/is not foundation-model training/gi, '');
  for (const re of FORBIDDEN_TRAINING_PATTERNS) {
    if (re.test(stripped)) violations.push('unsupported_training_claim');
  }
  if (/\bwill (definitely|certainly) (appreciate|rise|crash)\b/i.test(text)) {
    violations.push('unsupported_prediction_claim');
  }
  if (/\bcaused by\b/i.test(text) && !/\b(not|never|do not|don't|unsupported)\b/i.test(text)) {
    // allow refusal language
    if (/\b(this|that|it)\s+caused\b/i.test(text)) violations.push('unsupported_causal_claim');
  }
  return violations;
}

export function evaluateScenario(scenario) {
  const capability = scenario.capability_id;
  const out = runCapability(capability, scenario.input || {});
  const schemaViolations = validateCapabilityResultShape(capability, out.result);
  const text = JSON.stringify(out);
  const hardStops = scanTextHardStops(text);
  const expected = scenario.expected || {};
  const failures = [];
  const hard = [];

  if (schemaViolations.length) {
    failures.push(...schemaViolations);
    hard.push(...schemaViolations.filter((v) => v.startsWith('hard:') || v.startsWith('schema_invalid')));
  }
  hardStops.forEach((v) => {
    hard.push(v);
    failures.push(v);
  });

  if (expected.abstain === true && !out.envelope.abstention.abstained) failures.push('expected_abstention');
  if (expected.abstain === false && out.envelope.abstention.abstained) failures.push('unexpected_abstention');
  if (expected.mode && out.result.analytics_mode !== expected.mode) failures.push('mode_mismatch');
  if (expected.operation && out.result.operation !== expected.operation) failures.push('operation_mismatch');
  if (expected.fact_key && expected.fact_value != null) {
    if (out.result.current_facts?.[expected.fact_key] !== expected.fact_value) {
      failures.push('correction_precedence_miss');
    }
  }
  if (expected.no_deleted_recall === true) {
    for (const r of out.result.recalled_items || []) {
      if (r.deletion_state === 'DELETED') {
        hard.push('deleted_memory_recall');
        failures.push('deleted_memory_recall');
      }
    }
  }
  if (expected.cross_user_blocked === true && !out.envelope.abstention.abstained) {
    hard.push('cross_user_leakage');
    failures.push('cross_user_leakage');
  }
  if (expected.sample_size_present === true && out.result.sample_size == null) {
    hard.push('missing_sample_size');
    failures.push('missing_sample_size');
  }
  if (expected.sold_not_asking === true && out.result.pricing) {
    // if diagnostics claim asking-as-sold it's a hard fail
    if (out.diagnostics?.asking_as_sold) {
      hard.push('asking_as_sold');
      failures.push('asking_as_sold');
    }
  }
  if (expected.false_memory_zero === true && out.result.false_memory_claims !== 0) {
    hard.push('false_memory');
    failures.push('false_memory');
  }

  return {
    scenario_id: scenario.scenario_id,
    capability_id: capability,
    status: failures.length || hard.length ? 'FAIL' : 'PASS',
    failures,
    hard_violations: hard,
    envelope: out.envelope,
    result: out.result,
    diagnostics: out.diagnostics,
  };
}
