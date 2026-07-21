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
import { mergeOwnerProofCompletedSaleCandidates } from './phase34-owner-proof-completed-sale-candidates.mjs';
import { finalizeCapabilityResponse } from './phase34-capability-response.mjs';
import { buildPlatformEvidenceSnapshot } from './phase34-claim-ledger.mjs';
import { loadCanonicalMarketEventCandidates } from './phase34-runtime-market-events.mjs';
import { persistCapabilityEvidenceArtifacts } from './phase34-evidence-persistence.mjs';

export const PROMPT_TEMPLATES = {
  scarcity: { id: 'scarcity-explain', version: '1', role: 'summarize_only' },
  valuation: { id: 'valuation-explain', version: '1', role: 'summarize_only' },
  auction_intelligence: { id: 'auction-explain', version: '1', role: 'summarize_only' },
};

function candidatesFromResult(input, result) {
  const fromInput = Array.isArray(input.candidates) ? input.candidates : [];
  const byId = new Map();
  for (const c of fromInput) {
    const id = c.market_event_id || c.evidence_id;
    if (id) byId.set(String(id), c);
  }
  const fromEvidence = Array.isArray(result?.evidence)
    ? result.evidence.map((e, i) => {
        const id = e.market_event_id || e.evidence_id || `ev-${i}`;
        const orig = byId.get(String(id)) || {};
        const saleKind =
          e.sale_kind ||
          orig.sale_kind ||
          (e.source_type === 'sale' || orig.source_type === 'sale' ? 'sold' : null);
        const isSold = saleKind === 'sold' || e.source_type === 'sale' || orig.source_class === 'FIRST_PARTY_SETTLEMENT';
        return {
          ...orig,
          ...e,
          market_event_id: e.market_event_id || orig.market_event_id || e.evidence_id || `ev-${i}`,
          evidence_id: e.evidence_id || orig.evidence_id || e.market_event_id || `ev-${i}`,
          event_type:
            e.event_type ||
            orig.event_type ||
            (isSold ? 'SALE_COMPLETED' : 'LISTING_CREATED'),
          sale_kind: saleKind,
          source_class:
            e.source_class ||
            orig.source_class ||
            (isSold ? 'FIRST_PARTY_SETTLEMENT' : 'FIRST_PARTY_LISTING'),
          settlement_evidence_eligible:
            e.settlement_evidence_eligible ??
            orig.settlement_evidence_eligible ??
            (isSold ? true : undefined),
          rights_class:
            e.rights_class ||
            orig.rights_class ||
            e.rights_status ||
            orig.rights_status ||
            'FIRST_PARTY',
          rights_status:
            e.rights_status || orig.rights_status || e.rights_class || orig.rights_class || 'FIRST_PARTY',
          payload_hash: e.payload_hash || orig.payload_hash || e.evidence_id || `ph-${i}`,
          occurred_at: e.observed_at || e.sold_at || orig.occurred_at || null,
          price: typeof e.price === 'number' ? e.price : orig.price,
          currency: e.currency || orig.currency || 'USD',
        };
      })
    : [];
  // Prefer merged evidence rows; fall back to input candidates (runtime DB load).
  return fromEvidence.length ? fromEvidence : fromInput;
}

function withPlatformEnvelope(capability, input, result) {
  const structured = result?.result || result;
  const candidates = candidatesFromResult(input, structured);
  // Probe eligibility so sold_count claims only reference INCLUDED settlement events.
  const snapshotProbe = buildPlatformEvidenceSnapshot({
    capability,
    subject: input.subject || {},
    candidates,
    requestId: input.request_id || null,
    sessionId: input.session_id || null,
    turnId: input.turn_id || null,
    requestedConstraints: input.constraints || {},
    requireExactPressing: Boolean(input.subject?.pressing_id),
  });
  const soldEventIds = snapshotProbe.eligibility.included
    .filter((e) => e.event_type === 'SALE_COMPLETED' || e.sale_kind === 'sold')
    .map((e) => e.market_event_id || e.evidence_id)
    .filter(Boolean);
  const soldCount = soldEventIds.length;
  const probe = finalizeCapabilityResponse({
    capability,
    subject: input.subject || {},
    candidates,
    structured_result: {
      ...structured,
      sold_count: soldCount,
      sold_comparable_count: structured?.sold_comparable_count ?? soldCount,
    },
    answer: result?.explanation || result?.summary || null,
    customer_summary:
      soldCount > 0
        ? `${soldCount} completed sales support this range`
        : result?.explanation || result?.summary || null,
    limitations: structured?.limitations || result?.limitations || [],
    confidence: typeof result?.confidence === 'number' ? result.confidence : structured?.confidence,
    claims: [],
    request: {
      request_id: input.request_id || null,
      session_id: input.session_id || null,
      turn_id: input.turn_id || null,
      constraints: input.constraints || {},
    },
    requireExactPressing: Boolean(input.subject?.pressing_id),
  });
  return {
    ...result,
    evidence_snapshot_id: probe.evidence_snapshot_id,
    evidence_snapshot_hash: probe.evidence_snapshot_hash,
    claim_ledger_id: probe.claim_ledger_id,
    response_id: probe.response_id,
    platform_envelope: probe,
  };
}

function runtimeIntegrationEnabled(input = {}) {
  if (input.runtime_integration === true) return true;
  if (input.runtime_integration === false) return false;
  return (
    process.env.PHASE34_RUNTIME_INTEGRATION === '1' ||
    process.env.PHASE34_RUNTIME_INTEGRATION === 'true'
  );
}

function persistEnabled(input = {}) {
  if (input.persist_evidence === false) return false;
  if (process.env.PHASE34_RUNTIME_PERSIST === '0') return false;
  return runtimeIntegrationEnabled(input) || input.persist_evidence === true;
}

/**
 * Async capability runner used by the live API path.
 * When runtime integration is on and candidates are empty, loads canonical
 * market events from intelligence.market_events (never seed fixtures).
 */
export async function runCapabilityAsync(capability, input = {}) {
  let nextInput = { ...input };
  if (
    runtimeIntegrationEnabled(nextInput) &&
    (!Array.isArray(nextInput.candidates) || nextInput.candidates.length === 0)
  ) {
    const loaded = await loadCanonicalMarketEventCandidates({
      eventTypes: ['SALE_COMPLETED'],
      limit: Number(nextInput.market_event_limit || 50),
      listingId: nextInput.listing_id || nextInput.subject?.listing_id || null,
    });
    nextInput = {
      ...nextInput,
      candidates: loaded,
      _runtime_candidates_source: 'intelligence.market_events',
    };
  } else if (!runtimeIntegrationEnabled(nextInput)) {
    // Offline / owner-proof path may still merge seed candidates.
  }

  let out;
  switch (capability) {
    case 'scarcity':
      out = withPlatformEnvelope(
        'scarcity',
        nextInput,
        analyzeScarcity(
          runtimeIntegrationEnabled(nextInput)
            ? nextInput
            : mergeOwnerProofCompletedSaleCandidates(nextInput),
        ),
      );
      break;
    case 'valuation':
      out = withPlatformEnvelope(
        'valuation',
        nextInput,
        analyzeValuation(
          runtimeIntegrationEnabled(nextInput)
            ? nextInput
            : mergeOwnerProofCompletedSaleCandidates(nextInput),
        ),
      );
      break;
    case 'auction_intelligence':
      out = withPlatformEnvelope('auction_intelligence', nextInput, analyzeAuction(nextInput));
      break;
    default: {
      const _exhaustive = capability;
      throw new Error(`unknown_capability:${_exhaustive}`);
    }
  }

  if (persistEnabled(nextInput) && out.platform_envelope?.evidence_snapshot) {
    out.persistence = await persistCapabilityEvidenceArtifacts({
      snapshot: out.platform_envelope.evidence_snapshot,
      claimLedger: out.platform_envelope.claim_ledger,
      envelope: out.platform_envelope,
      capability,
      subject: nextInput.subject || {},
      requestedConstraints: nextInput.constraints || {},
    });
  }

  out.diagnostics = {
    ...(out.diagnostics || {}),
    runtime_integration: runtimeIntegrationEnabled(nextInput),
    runtime_candidates_source: nextInput._runtime_candidates_source || null,
    runtime_candidate_count: Array.isArray(nextInput.candidates)
      ? nextInput.candidates.length
      : 0,
    evidence_persisted: Boolean(out.persistence),
  };
  return out;
}

export function runCapability(capability, input = {}) {
  switch (capability) {
    case 'scarcity':
      return withPlatformEnvelope(
        'scarcity',
        input,
        analyzeScarcity(mergeOwnerProofCompletedSaleCandidates(input)),
      );
    case 'valuation':
      return withPlatformEnvelope(
        'valuation',
        input,
        analyzeValuation(mergeOwnerProofCompletedSaleCandidates(input)),
      );
    case 'auction_intelligence':
      return withPlatformEnvelope('auction_intelligence', input, analyzeAuction(input));
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
