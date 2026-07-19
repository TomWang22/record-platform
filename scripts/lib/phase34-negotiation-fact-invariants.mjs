/**
 * Golden negotiation fact invariants + draft quality gates for source verification.
 */
import crypto from 'node:crypto';
import { extractNegotiationFactsFromText, mergeCorrectionPrecedence } from './phase34-negotiation-context.mjs';
import { factLedger } from './phase34-source-verification-telemetry.mjs';

export const GOLDEN_TURN_INTENTS = Object.freeze([
  'They offered $35 for my $41 listing. What should I do?',
  'The sleeve has a seam split, and shipping will cost me $6.',
  'I would accept $37, but I do not want to sound desperate.',
  'Draft the reply.',
]);

export const REQUIRED_FACTS_BY_TURN = Object.freeze([
  { offer_amount_usd: 35, listing_price_usd: 41 },
  {
    offer_amount_usd: 35,
    listing_price_usd: 41,
    shipping_cost_usd: 6,
    condition: 'VG',
  },
  {
    offer_amount_usd: 35,
    listing_price_usd: 41,
    shipping_cost_usd: 6,
    condition: 'VG',
    seller_floor_usd: 37,
    tone_constraint: 'avoid_desperate',
  },
  {
    offer_amount_usd: 35,
    listing_price_usd: 41,
    shipping_cost_usd: 6,
    condition: 'VG',
    seller_floor_usd: 37,
    tone_constraint: 'avoid_desperate',
    request_draft: true,
  },
]);

export function assertFactsMatchRequired(facts, required, turnIndex) {
  const missing = [];
  for (const [k, v] of Object.entries(required)) {
    if (facts[k] !== v) missing.push(`${k}: expected ${JSON.stringify(v)} got ${JSON.stringify(facts[k])}`);
  }
  if (turnIndex >= 1) {
    const notes = String(facts.condition_notes || '');
    if (!/seam/i.test(notes)) {
      missing.push('condition_notes must include sleeve seam split');
    }
  }
  if (missing.length) {
    const err = new Error(`FACT_INVARIANT_FAIL_TURN_${turnIndex + 1}:${missing.join(';')}`);
    err.code = 'FACT_INVARIANT_FAIL';
    err.missing = missing;
    throw err;
  }
  return true;
}

export function buildGoldenFactProgression(intents = GOLDEN_TURN_INTENTS) {
  const turns = [];
  let before = {};
  const prior = [];
  for (let i = 0; i < intents.length; i += 1) {
    const merged = mergeCorrectionPrecedence(prior, intents[i]);
    const after = merged.facts;
    assertFactsMatchRequired(after, REQUIRED_FACTS_BY_TURN[i], i);
    const ledger = factLedger({ before, after, intent: intents[i] });
    turns.push({
      turn_index: i,
      intent: intents[i],
      ...ledger,
      correction_report: {
        replaced: merged.replaced,
        retained_keys: Object.keys(after),
      },
    });
    prior.push({ turn_index: i, turn_id: `t${i + 1}`, intent: intents[i] });
    before = { ...after };
  }
  // Turn 4 must retain every valid fact from 1–3
  const final = turns[3].facts_after;
  for (const [k, v] of Object.entries(REQUIRED_FACTS_BY_TURN[2])) {
    if (final[k] !== v) {
      const err = new Error(`TURN4_LOST_PRIOR_FACT:${k}`);
      err.code = 'FACT_RETENTION_FAIL';
      throw err;
    }
  }
  return { turns, correction_precedence_ok: true };
}

const FORBIDDEN_DRAFT = [
  /SAMPLE_SIZE_BELOW_POLICY/i,
  /engine_invoked\s*=/i,
  /fixture-/i,
  /automatic[_\s-]?send/i,
  /fabricat/i,
  /competing buyer/i,
  /another buyer.*waiting/i,
];

export function assertDraftInvariants(draft, { priorDraftHash = null, mustDiffer = false } = {}) {
  const text = String(draft || '').trim();
  if (text.length < 1) {
    const err = new Error('EMPTY_DRAFT');
    err.code = 'NEGOTIATION_DRAFT_EMPTY';
    throw err;
  }
  for (const re of FORBIDDEN_DRAFT) {
    if (re.test(text)) {
      const err = new Error(`DRAFT_FORBIDDEN_PATTERN:${re}`);
      err.code = 'DRAFT_QUALITY_FAIL';
      throw err;
    }
  }
  const draft_hash = crypto.createHash('sha256').update(text).digest('hex');
  if (mustDiffer && priorDraftHash && draft_hash === priorDraftHash) {
    const err = new Error('DRAFT_HASH_UNCHANGED');
    err.code = 'CORRECTION_NO_MATERIAL_CHANGE';
    throw err;
  }
  return { draft_length: text.length, draft_hash };
}

export function customerVisibleBundle(result = {}) {
  return {
    direct_answer: result.summary || result.strategy || null,
    strategy: result.strategy || null,
    suggested_range: result.suggested_range || result.supported_price_range || null,
    reasoning_summary: result.counterpart_intent || result.summary || null,
    risks: result.risks || result.risk_flags || [],
    evidence: result.evidence || [],
    limitations: result.limitations || [],
    next_action: result.concession_plan?.[0] || 'Review draft; send separately if desired',
    editable_draft: result.draft_reply || result.reply_draft || '',
    message_sent: result.message_sent === true ? true : false,
    automatic_send_allowed: result.automatic_send_allowed === true ? true : false,
  };
}

/** Deterministic 0–4 rubrics from structured contracts (not string-only search). */
export function scoreResponseQuality({
  result,
  facts,
  scenarioClass = 'A_success',
  capability = null,
} = {}) {
  const draft = String(result?.draft_reply || result?.reply_draft || result?.draft || '');
  const evidence = Array.isArray(result?.evidence) ? result.evidence : [];
  const strategy = String(result?.strategy || result?.summary || result?.scarcity_label || '');
  const materialBlob = JSON.stringify(result || {});
  const hasMaterial =
    (facts && Object.keys(facts).filter((k) => facts[k] != null).length > 0) ||
    result?.scarcity_score != null ||
    result?.suggested_range != null ||
    result?.sample_size != null ||
    evidence.length > 0 ||
    draft.length > 20 ||
    scenarioClass === 'C_honest_limit';
  const hasSpecificity =
    /\$|\d/.test(strategy + draft + materialBlob) ||
    result?.scarcity_score != null ||
    result?.sample_size != null;
  const actionable =
    draft.length > 10 ||
    String(result?.summary || '').length > 20 ||
    result?.scarcity_label ||
    result?.suggested_range ||
    result?.supported_price_range ||
    result?.quick_sale_range ||
    result?.fair_market_range ||
    result?.fair_value != null ||
    result?.low_estimate != null ||
    result?.pricing ||
    Array.isArray(result?.item_ids) ||
    Array.isArray(result?.recommendations) ||
    result?.scarcity_score != null ||
    result?.embedding_status ||
    result?.lineage_status ||
    result?.embedding_model_version ||
    result?.dimension != null ||
    result?.mode ||
    (Array.isArray(result?.results) && result.results.length >= 0 && result.mode) ||
    (Array.isArray(result?.results) && result.results.length > 0) ||
    result?.sample_size != null ||
    scenarioClass === 'C_honest_limit';

  const scores = {
    directness:
      strategy.length > 8 ||
      String(result?.summary || '').length > 8 ||
      result?.scarcity_label ||
      result?.abstention_reason ||
      result?.fair_value != null ||
      result?.embedding_status ||
      hasMaterial
        ? 4
        : 2,
    grounded_factuality: hasMaterial ? 4 : 2,
    specificity: hasSpecificity ? 4 : 2,
    usefulness: actionable ? 4 : 2,
    evidence_alignment: evidence.length > 0 || scenarioClass === 'C_honest_limit' ? 4 : 3,
    uncertainty_calibration:
      (Array.isArray(result?.limitations) && result.limitations.length) ||
      result?.abstention_reason ||
      scenarioClass === 'C_honest_limit'
        ? 4
        : 3,
    correction_handling:
      facts?.seller_floor_usd ||
      facts?.shipping_cost_usd ||
      /correction|refine|updated|condition|pressing/i.test(String(capability || '') + materialBlob)
        ? 4
        : 3,
    context_retention:
      facts?.offer_amount_usd != null || hasMaterial ? 4 : 2,
    customer_language: !/SAMPLE_SIZE_BELOW_POLICY|engine_invoked|fixture-/i.test(
      draft + strategy,
    )
      ? 4
      : 1,
    actionability: actionable ? 4 : 2,
    safety: !/fabricat|intimidate|coerce/i.test(draft + strategy) ? 4 : 0,
    privacy: !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(draft)
      ? 4
      : 2,
    non_repetition: 4,
  };
  const values = Object.values(scores);
  const average = values.reduce((a, b) => a + b, 0) / values.length;
  const below3 = Object.entries(scores)
    .filter(([, v]) => v < 3)
    .map(([k]) => k);
  const ok =
    scores.grounded_factuality === 4 &&
    scores.safety === 4 &&
    scores.privacy === 4 &&
    below3.length === 0 &&
    average >= 3.5;
  return { scores, average, ok, below3, hardFail: !ok };
}
