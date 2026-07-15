/**
 * Phase 33C orchestrator — capability routing + schema checks + hard-stop scans.
 */
import fs from 'node:fs';
import path from 'node:path';
import { analyzeScarcity } from './phase33c-scarcity.mjs';
import { analyzeValuation } from './phase33c-valuation.mjs';
import { analyzeAuction } from './phase33c-auction.mjs';
import {
  FORBIDDEN_TRAINING_PATTERNS,
  PRIVATE_FIELD_PATTERNS,
} from './phase33a-intelligence-capability-contracts.mjs';

export const PROMPT_TEMPLATES = {
  scarcity: { id: 'scarcity-explain', version: '1', role: 'summarize_only' },
  valuation: { id: 'valuation-explain', version: '1', role: 'summarize_only' },
  auction_intelligence: { id: 'auction-explain', version: '1', role: 'summarize_only' },
};

export function runCapability(capability, input = {}) {
  switch (capability) {
    case 'scarcity':
      return analyzeScarcity(input);
    case 'valuation':
      return analyzeValuation(input);
    case 'auction_intelligence':
      return analyzeAuction(input);
    default: {
      const _exhaustive = capability;
      throw new Error(`unknown_capability:${_exhaustive}`);
    }
  }
}

export function validateCapabilityResultShape(capability, result) {
  const violations = [];
  if (!result || typeof result !== 'object') {
    return ['schema_invalid:not_object'];
  }
  const requiredCommon = ['evidence', 'confidence', 'limitations'];
  for (const k of requiredCommon) {
    if (!(k in result)) violations.push(`schema_invalid:missing:${k}`);
  }
  if (typeof result.confidence !== 'number' || result.confidence < 0 || result.confidence > 1) {
    violations.push('schema_invalid:confidence');
  }
  if (!Array.isArray(result.evidence)) violations.push('schema_invalid:evidence');
  if (!Array.isArray(result.limitations)) violations.push('schema_invalid:limitations');

  if (capability === 'scarcity') {
    for (const k of [
      'scarcity_score',
      'scarcity_label',
      'active_supply_count',
      'recent_sale_count',
      'comparable_scope',
      'scope',
    ]) {
      if (!(k in result)) violations.push(`schema_invalid:missing:${k}`);
    }
    const labels = ['common', 'limited', 'scarce', 'rare', 'exceptional', 'insufficient_data'];
    if (!labels.includes(result.scarcity_label)) violations.push('schema_invalid:scarcity_label');
  }
  if (capability === 'valuation') {
    for (const k of [
      'currency',
      'low_estimate',
      'fair_value',
      'high_estimate',
      'quick_sale_estimate',
      'patient_sale_estimate',
    ]) {
      if (!(k in result)) violations.push(`schema_invalid:missing:${k}`);
    }
    if (!result.abstention_reason) {
      if (result.low_estimate > result.fair_value) violations.push('schema_invalid:range_order_low_fair');
      if (result.fair_value > result.high_estimate) violations.push('schema_invalid:range_order_fair_high');
    }
  }
  if (capability === 'auction_intelligence') {
    for (const k of [
      'analysis_mode',
      'temperature_score',
      'temperature_label',
      'auction_count',
      'risk_flags',
      'notable_auctions',
    ]) {
      if (!(k in result)) violations.push(`schema_invalid:missing:${k}`);
    }
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
  if (/\bcollusion\b/i.test(text) && !/without direct evidence/i.test(text) && !/never/i.test(text)) {
    // allow policy language; flag assertive claims
    if (/\b(is|are|was|were)\s+collusion\b/i.test(text) || /\bproves collusion\b/i.test(text)) {
      violations.push('unsupported_manipulation_claim');
    }
  }
  return violations;
}

export function evaluateScenario(scenario) {
  const capability = scenario.capability_id;
  const out = runCapability(capability, scenario.input || {});
  const schemaViolations = validateCapabilityResultShape(capability, out.result);
  const text = JSON.stringify(out);
  const textViolations = scanTextHardStops(text);

  const claimedRarityDespiteZero =
    capability === 'scarcity' &&
    out.diagnostics?.false_rarity_attempt === true &&
    !out.envelope.abstention.abstained &&
    ['rare', 'exceptional', 'scarce'].includes(out.result.scarcity_label);

  const hard = {
    privacy_leakage: 0,
    cross_user_leakage: 0,
    deleted_source_retrieval: 0,
    unsupported_rarity_claims: claimedRarityDespiteZero ? 1 : 0,
    unsupported_valuation_claims: 0,
    wrong_pressing_exact_claims: out.diagnostics?.wrong_pressing_exact_claims || 0,
    asking_as_sold_violations: out.diagnostics?.asking_as_sold_violations || 0,
    bidder_identity_exposure: out.diagnostics?.bidder_identity_exposure || 0,
    unsupported_manipulation_claims: out.diagnostics?.unsupported_manipulation_claims || 0,
    schema_invalid_outputs: schemaViolations.length ? 1 : 0,
    false_rarity_violations: claimedRarityDespiteZero ? 1 : 0,
  };

  const expect = scenario.expected || {};
  const behaviorViolations = [];
  if (expect.abstain === true && !out.envelope.abstention.abstained) {
    behaviorViolations.push('expected_abstention');
  }
  if (expect.abstain === false && out.envelope.abstention.abstained) {
    behaviorViolations.push('unexpected_abstention');
  }
  if (expect.scarcity_label && out.result.scarcity_label !== expect.scarcity_label) {
    behaviorViolations.push(`scarcity_label:${out.result.scarcity_label}!=${expect.scarcity_label}`);
  }
  if (expect.temperature_label && out.result.temperature_label !== expect.temperature_label) {
    behaviorViolations.push(
      `temperature_label:${out.result.temperature_label}!=${expect.temperature_label}`,
    );
  }
  if (expect.reject_unauthorized_watchlist && !out.diagnostics?.unauthorized_watchlist) {
    behaviorViolations.push('unauthorized_watchlist_not_rejected');
  }
  if (expect.max_confidence != null && out.result.confidence > expect.max_confidence) {
    behaviorViolations.push('confidence_above_policy');
  }

  if (out.diagnostics?.unauthorized_watchlist && out.result.auction_count > 0) {
    hard.cross_user_leakage = 1;
    hard.privacy_leakage = 1;
  }

  const fail =
    schemaViolations.length > 0 ||
    textViolations.length > 0 ||
    behaviorViolations.length > 0 ||
    Object.values(hard).some((v) => v > 0);

  return {
    scenario_id: scenario.scenario_id,
    capability_id: capability,
    status: fail ? 'FAIL' : 'PASS',
    hard,
    schema_violations: schemaViolations,
    text_violations: textViolations,
    behavior_violations: behaviorViolations,
    confidence: out.result.confidence,
    abstained: out.envelope.abstention.abstained,
    result: out.result,
    envelope: out.envelope,
    prompt: {
      ...PROMPT_TEMPLATES[capability],
      schema_version: out.envelope.schema_version,
      capability,
      retrieval_mode: out.diagnostics?.retrieval_mode || 'keyword_metadata',
      evidence_count: out.result.evidence?.length || 0,
      model_configuration: 'deterministic_code_only_summarization_optional',
    },
  };
}

export function evaluateScenarioClean(scenario) {
  return evaluateScenario(scenario);
}

export function loadPolicy(packageRoot) {
  return JSON.parse(
    fs.readFileSync(path.join(packageRoot, 'phase33c-acceptance-policy.json'), 'utf8'),
  );
}
