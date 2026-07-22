/**
 * Phase 34 model-eligible turn policy.
 * model_invoked must equal model_eligible except recorded refusals/safety.
 * Unexpected rule fallback must be zero.
 */
import { EIGHT_CAPABILITIES } from './phase34-capability-response.mjs';

/** Caps that require grounded model prose for customer-facing synthesis. */
export const MODEL_SYNTHESIS_CAPABILITIES = Object.freeze([
  'scarcity',
  'valuation',
  'auction_intelligence',
  'semantic_search',
  'negotiation_assistance',
  'recommendations',
  'market_analytics',
]);

/** Caps that stay deterministic unless an explanatory summary is requested. */
export const DETERMINISTIC_LINEAGE_CAPABILITIES = Object.freeze(['embeddings']);

export const MODEL_ELIGIBILITY = Object.freeze({
  REQUIRED: 'MODEL_SYNTHESIS_REQUIRED',
  DETERMINISTIC_ONLY_BY_POLICY: 'DETERMINISTIC_ONLY_BY_POLICY',
  AUTHORIZATION_REFUSAL: 'AUTHORIZATION_REFUSAL',
  SAFETY_REFUSAL: 'SAFETY_REFUSAL',
  HARD_ABSTENTION: 'HARD_ABSTENTION',
});

export const FALLBACK_CLASS = Object.freeze({
  NONE: 'NONE',
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
  MODEL_TIMEOUT: 'MODEL_TIMEOUT',
  MODEL_REFUSED: 'MODEL_REFUSED',
  MODEL_GUARD_REJECTED: 'MODEL_GUARD_REJECTED',
  DETERMINISTIC_ONLY_BY_POLICY: 'DETERMINISTIC_ONLY_BY_POLICY',
  UNEXPECTED_RULE_FALLBACK: 'UNEXPECTED_RULE_FALLBACK',
});

/**
 * Decide model eligibility for one logical turn.
 * @returns {{ eligible: boolean, reason: string, fallback_class: string|null }}
 */
export function decideModelEligibility({
  capability,
  scenario_class = 'success',
  explanatory_summary_requested = false,
  authorization_refused = false,
  safety_refused = false,
  hard_abstention = false,
} = {}) {
  if (!EIGHT_CAPABILITIES.includes(capability)) {
    return {
      eligible: false,
      reason: MODEL_ELIGIBILITY.DETERMINISTIC_ONLY_BY_POLICY,
      fallback_class: FALLBACK_CLASS.DETERMINISTIC_ONLY_BY_POLICY,
    };
  }
  if (authorization_refused) {
    return {
      eligible: false,
      reason: MODEL_ELIGIBILITY.AUTHORIZATION_REFUSAL,
      fallback_class: FALLBACK_CLASS.DETERMINISTIC_ONLY_BY_POLICY,
    };
  }
  if (safety_refused) {
    return {
      eligible: false,
      reason: MODEL_ELIGIBILITY.SAFETY_REFUSAL,
      fallback_class: FALLBACK_CLASS.DETERMINISTIC_ONLY_BY_POLICY,
    };
  }
  if (hard_abstention || scenario_class === 'honest_limit') {
    return {
      eligible: false,
      reason: MODEL_ELIGIBILITY.HARD_ABSTENTION,
      fallback_class: FALLBACK_CLASS.DETERMINISTIC_ONLY_BY_POLICY,
    };
  }
  if (scenario_class === 'adversarial') {
    // Adversarial sessions exercise refusal/isolation; not customer synthesis.
    return {
      eligible: false,
      reason: MODEL_ELIGIBILITY.AUTHORIZATION_REFUSAL,
      fallback_class: FALLBACK_CLASS.DETERMINISTIC_ONLY_BY_POLICY,
    };
  }
  if (DETERMINISTIC_LINEAGE_CAPABILITIES.includes(capability) && !explanatory_summary_requested) {
    return {
      eligible: false,
      reason: MODEL_ELIGIBILITY.DETERMINISTIC_ONLY_BY_POLICY,
      fallback_class: FALLBACK_CLASS.DETERMINISTIC_ONLY_BY_POLICY,
    };
  }
  if (MODEL_SYNTHESIS_CAPABILITIES.includes(capability)) {
    return {
      eligible: true,
      reason: MODEL_ELIGIBILITY.REQUIRED,
      fallback_class: null,
    };
  }
  return {
    eligible: false,
    reason: MODEL_ELIGIBILITY.DETERMINISTIC_ONLY_BY_POLICY,
    fallback_class: FALLBACK_CLASS.DETERMINISTIC_ONLY_BY_POLICY,
  };
}

/**
 * Expected eligible-turn count for a canary with SESSIONS_PER_CAP and CLASSES cycling.
 * Default: 30/cap × 8 caps, class = j % 4 → 8 success + 8 correction per cap for 7 synthesis caps = 112.
 */
export function expectedEligibleTurnsForCanary({
  sessionsPerCap = 30,
  capabilities = EIGHT_CAPABILITIES,
  classes = ['success', 'correction', 'honest_limit', 'adversarial'],
} = {}) {
  let n = 0;
  for (const capability of capabilities) {
    for (let j = 0; j < sessionsPerCap; j += 1) {
      const scenario_class = classes[j % classes.length];
      const d = decideModelEligibility({ capability, scenario_class });
      if (d.eligible) n += 1;
    }
  }
  return n;
}

export function emptyEligibilityCounters() {
  return {
    total_turns: 0,
    model_eligible_turns: 0,
    model_invoked_turns: 0,
    model_success_turns: 0,
    model_refused_turns: 0,
    model_timeout_turns: 0,
    deterministic_only_policy_turns: 0,
    unexpected_rule_fallback_turns: 0,
    guard_rejected_turns: 0,
  };
}

export function recordEligibilityOutcome(counters, { eligibility, invoked, success, fallback_class }) {
  counters.total_turns += 1;
  if (eligibility.eligible) counters.model_eligible_turns += 1;
  else counters.deterministic_only_policy_turns += 1;

  if (invoked) counters.model_invoked_turns += 1;
  if (success) counters.model_success_turns += 1;

  switch (fallback_class) {
    case FALLBACK_CLASS.MODEL_REFUSED:
      counters.model_refused_turns += 1;
      break;
    case FALLBACK_CLASS.MODEL_TIMEOUT:
    case FALLBACK_CLASS.MODEL_UNAVAILABLE:
      counters.model_timeout_turns += 1;
      break;
    case FALLBACK_CLASS.MODEL_GUARD_REJECTED:
      counters.guard_rejected_turns += 1;
      break;
    case FALLBACK_CLASS.UNEXPECTED_RULE_FALLBACK:
      counters.unexpected_rule_fallback_turns += 1;
      break;
    case FALLBACK_CLASS.NONE:
    case FALLBACK_CLASS.DETERMINISTIC_ONLY_BY_POLICY:
    case null:
    case undefined:
      break;
    default: {
      const _exhaustive = fallback_class;
      void _exhaustive;
      break;
    }
  }
  return counters;
}

/**
 * Acceptance: invoked == eligible except recorded refusals; unexpected fallback == 0.
 */
export function assertEligibilityCoverage(counters) {
  const allowedGap =
    counters.model_refused_turns + counters.model_timeout_turns + counters.guard_rejected_turns;
  const ok =
    counters.unexpected_rule_fallback_turns === 0 &&
    counters.model_invoked_turns + allowedGap >= counters.model_eligible_turns &&
    counters.model_invoked_turns <= counters.model_eligible_turns &&
    // Every eligible turn must either invoke successfully or have an explicit recorded failure class
    counters.model_success_turns + allowedGap === counters.model_eligible_turns;
  return {
    ok,
    model_eligible_turns: counters.model_eligible_turns,
    model_invoked_turns: counters.model_invoked_turns,
    model_success_turns: counters.model_success_turns,
    unexpected_rule_fallback_turns: counters.unexpected_rule_fallback_turns,
  };
}
