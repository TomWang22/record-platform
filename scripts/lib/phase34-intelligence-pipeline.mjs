/**
 * Phase E7 — intelligence pipeline wiring.
 * plan → retrieve → snapshot → deterministic analyze (caller) → synthesize
 * → invention guard → claim ledger → envelope (finalizeCapabilityResponse).
 *
 * MODEL_WEIGHT_TRAINING remains NO.
 */
import { planQuery } from './phase34-query-planner.mjs';
import { retrieveForPlan, createRetrievalStores } from './phase34-retrieval.mjs';
import {
  buildPlatformEvidenceSnapshot,
  buildClaimLedger,
} from './phase34-claim-ledger.mjs';
import { finalizeCapabilityResponse } from './phase34-capability-response.mjs';
import { synthesizeGrounded, synthesizeDeterministic } from './phase34-grounded-synthesis.mjs';
import { guardWithRetry, guardInvention, assertInventionGuardPass } from './phase34-invention-guard.mjs';
import { runCalculations, calcClaimSupport } from './phase34-deterministic-analytics.mjs';

export const INTELLIGENCE_PIPELINE_VERSION = 'phase34-intelligence-pipeline-v1';

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function candidatesFromRetrieval(retrieval, extraCandidates = []) {
  const fromRetrieval = asArray(retrieval?.candidates).map((c) => {
    const doc = c.doc || c;
    return {
      ...doc,
      market_event_id: doc.market_event_id || doc.id || c.id,
      evidence_id: doc.evidence_id || doc.market_event_id || doc.id || c.id,
    };
  });
  return [...fromRetrieval, ...asArray(extraCandidates)];
}

function defaultAnalyze({ plan, snapshot, retrieval, structured_result }) {
  if (structured_result) return structured_result;
  const included = snapshot?.eligibility?.included || [];
  const sold = included.filter(
    (e) => e.event_type === 'SALE_COMPLETED' || e.sale_kind === 'sold',
  );
  const prices = sold.map((e) => e.price ?? e.final_price).filter((n) => typeof n === 'number');
  const calcs = runCalculations(plan.calculations || ['calc:count', 'calc:median'], {
    values: prices,
    items: sold,
  });
  const medianVal = calcs.find((c) => c.deterministic_calculation_id === 'calc:median')?.value;
  const sold_count = sold.length;
  const honest_empty = sold_count === 0;
  return {
    sold_count,
    sample_size: sold_count,
    completed_sale_sample_size: sold_count,
    sold_median: medianVal,
    median: medianVal,
    currency: plan.constraints?.currency || 'USD',
    conclusion: honest_empty
      ? 'I do not have enough eligible evidence to answer this with grounded market figures.'
      : `Completed-sale median is ${medianVal} ${plan.constraints?.currency || 'USD'} across ${sold_count} sales.`,
    limitations: honest_empty ? ['INSUFFICIENT_EVIDENCE'] : [],
    calculations: calcs,
    retrieval_executed_mode: retrieval?.executed_mode || null,
  };
}

/**
 * Run the full Phase E intelligence pipeline.
 *
 * @param {object} input
 * @param {string} [input.request_text]
 * @param {string} [input.capability]
 * @param {object} [input.stores] retrieval stores
 * @param {Array} [input.candidates] pre-normalized market events (optional)
 * @param {Array} [input.session_facts]
 * @param {object} [input.prior_plan]
 * @param {Function} [input.analyze] async/sync (ctx) => structured_result
 * @param {string} [input.synthesis_tier]
 * @param {object} [input.modelGateway]
 * @param {object} [input.request]
 * @param {object} [input.vectorIndex]
 * @param {Function} [input.vectorSearch]
 * @param {Function} [input.retrySynthesis] invention-guard retry-once
 * @param {object} [input.structured_result] skip analyze when provided
 */
export async function runIntelligencePipeline(input = {}) {
  const plan = planQuery({
    request_text: input.request_text || input.user_intent || input.prompt,
    capability: input.capability,
    subject: input.subject,
    constraints: input.constraints,
    session_facts: input.session_facts,
    prior_plan: input.prior_plan,
    is_follow_up: input.is_follow_up,
    response_depth: input.response_depth,
  });

  const stores = input.stores || createRetrievalStores();
  const retrieval = retrieveForPlan(plan, stores, {
    requested_mode: input.requested_mode,
    limit: input.retrieval_limit || 20,
    vectorIndex: input.vectorIndex || null,
    vectorSearch: input.vectorSearch || null,
  });

  const candidates = candidatesFromRetrieval(retrieval, input.candidates);

  const snapshot = buildPlatformEvidenceSnapshot({
    capability: plan.capability,
    subject: plan.subject,
    candidates,
    requestId: input.request?.request_id || null,
    sessionId: input.request?.session_id || null,
    turnId: input.request?.turn_id || null,
    requestedConstraints: {
      ...(input.request?.constraints || {}),
      ...plan.constraints,
      exact_pressing: plan.constraints.exact_pressing === true,
    },
    requireExactPressing: plan.constraints.exact_pressing === true,
    queryPlan: plan,
    retrievalExecution: {
      version: retrieval.version,
      requested_mode: retrieval.requested_mode,
      executed_mode: retrieval.executed_mode,
      fallback_reason: retrieval.fallback_reason,
      candidate_ids: retrieval.candidate_ids,
      scores: retrieval.scores,
      filters: retrieval.filters,
      vector_executed: retrieval.vector_executed,
    },
    limitations: [],
  });

  const analyze = typeof input.analyze === 'function' ? input.analyze : defaultAnalyze;
  const structured_result = await analyze({
    plan,
    snapshot,
    retrieval,
    candidates,
    structured_result: input.structured_result || null,
  });

  const honest_limit =
    input.honest_limit === true ||
    (structured_result?.sold_count === 0 &&
      (!snapshot.included_event_ids || snapshot.included_event_ids.length === 0));

  const synthesis = await synthesizeGrounded({
    capability: plan.capability,
    tier: input.synthesis_tier || 'deterministic-only',
    structured_result,
    snapshot,
    evidence_summary: {
      included: snapshot.included_event_ids.length,
      excluded: snapshot.excluded_event_ids.length,
    },
    limitations: [
      ...asArray(structured_result?.limitations),
      ...(honest_limit ? ['INSUFFICIENT_EVIDENCE'] : []),
      ...(retrieval.fallback_reason ? [`RETRIEVAL_FALLBACK:${retrieval.fallback_reason}`] : []),
    ],
    refinements: plan.refinements,
    what_changed: input.what_changed,
    modelGateway: input.modelGateway || null,
    honest_limit,
    response_depth: plan.response_depth,
  });

  // Provisional claims from structured result + calc support
  const calcClaims = calcClaimSupport(asArray(structured_result?.calculations));
  const provisionalClaims = [
    ...asArray(input.claims),
    ...calcClaims,
  ];
  if (
    typeof structured_result?.sold_count === 'number' &&
    !provisionalClaims.some((c) => c.claim_type === 'sold_count')
  ) {
    const soldIds = (snapshot.eligibility?.included || [])
      .filter((e) => e.event_type === 'SALE_COMPLETED' || e.sale_kind === 'sold')
      .map((e) => e.market_event_id || e.evidence_id)
      .filter(Boolean);
    if (soldIds.length === structured_result.sold_count || structured_result.sold_count === 0) {
      provisionalClaims.push({
        claim_type: 'sold_count',
        normalized_claim_value: structured_result.sold_count,
        expected_count: structured_result.sold_count,
        supporting_snapshot_item_ids: soldIds,
        material: true,
        synthesis_path: 'structured_result.sold_count',
      });
    }
  }

  const response_id =
    input.request?.response_id ||
    `resp-${plan.capability}-${snapshot.evidence_snapshot_hash.slice(0, 12)}`;

  // Build ledger before guard so guard can see verification; for empty honest
  // limit with no material claims, ledger passes.
  let claimLedger = buildClaimLedger({
    responseId: response_id,
    snapshot,
    claims: provisionalClaims,
  });

  const guardResult = await guardWithRetry({
    text: synthesis.direct_answer,
    structured_result,
    claim_ledger: claimLedger,
    snapshot,
    subject_resolution: snapshot.subject_resolution,
    constraints: plan.constraints,
    calc_values: asArray(structured_result?.calculations)
      .map((c) => c.value)
      .filter((v) => typeof v === 'number'),
    retryOnce: input.retrySynthesis || null,
    synthesisInput: {
      capability: plan.capability,
      structured_result,
      snapshot,
      honest_limit,
      limitations: synthesis.limitations,
    },
  });

  let finalSynthesis = synthesis;
  if (guardResult.used_fallback && guardResult.fallback_synthesis) {
    finalSynthesis = guardResult.fallback_synthesis;
  } else if (!guardResult.ok) {
    assertInventionGuardPass(guardResult);
  } else {
    // Re-check final text
    const finalGuard = guardInvention({
      text: guardResult.guarded_text || finalSynthesis.direct_answer,
      structured_result,
      claim_ledger: claimLedger,
      snapshot,
      subject_resolution: snapshot.subject_resolution,
      constraints: plan.constraints,
    });
    assertInventionGuardPass(finalGuard);
    if (guardResult.guarded_text && guardResult.guarded_text !== finalSynthesis.direct_answer) {
      finalSynthesis = {
        ...finalSynthesis,
        direct_answer: guardResult.guarded_text,
        customer_summary: guardResult.guarded_text,
      };
    }
  }

  const envelope = finalizeCapabilityResponse({
    capability: plan.capability,
    subject: plan.subject,
    candidates,
    structured_result,
    answer: finalSynthesis.direct_answer,
    customer_summary: finalSynthesis.customer_summary,
    key_values: finalSynthesis.key_values,
    claims: provisionalClaims,
    limitations: finalSynthesis.limitations,
    next_actions: finalSynthesis.next_actions,
    confidence: finalSynthesis.confidence,
    request: {
      ...(input.request || {}),
      response_id,
      query_plan: plan,
      constraints: plan.constraints,
    },
    requireExactPressing: plan.constraints.exact_pressing === true,
    what_changed: finalSynthesis.what_changed,
    evidence_summary: {
      included: snapshot.included_event_ids.length,
      excluded: snapshot.excluded_event_ids.length,
      text: finalSynthesis.evidence_summary,
    },
    session_state_version: input.session_state_version ?? null,
    model_execution: {
      tier: finalSynthesis.tier,
      model_invoked: finalSynthesis.model_invoked === true,
      model_gateway: finalSynthesis.model_gateway || null,
      fallback_tier: finalSynthesis.fallback_tier || null,
      invention_guard: {
        ok: guardResult.ok,
        attempts: guardResult.attempts,
        used_fallback: guardResult.used_fallback === true,
        violations: guardResult.prior_violations || guardResult.violations || [],
      },
    },
    retrieval_execution: {
      requested_mode: retrieval.requested_mode,
      executed_mode: retrieval.executed_mode,
      fallback_reason: retrieval.fallback_reason,
      candidate_ids: retrieval.candidate_ids,
      vector_executed: retrieval.vector_executed,
    },
    safety: {
      invention_guard_passed: true,
      model_weight_training: 'NO',
    },
    telemetry: {
      pipeline_version: INTELLIGENCE_PIPELINE_VERSION,
      query_plan_version: plan.query_plan_version,
      response_depth: plan.response_depth,
    },
  });

  return Object.freeze({
    pipeline_version: INTELLIGENCE_PIPELINE_VERSION,
    plan,
    retrieval,
    snapshot,
    structured_result,
    synthesis: finalSynthesis,
    invention_guard: {
      ok: guardResult.ok || guardResult.used_fallback,
      attempts: guardResult.attempts,
      used_fallback: guardResult.used_fallback === true,
      violations: guardResult.prior_violations || [],
    },
    claim_ledger_id: envelope.claim_ledger_id,
    envelope,
  });
}

export {
  planQuery,
  retrieveForPlan,
  createRetrievalStores,
  synthesizeGrounded,
  synthesizeDeterministic,
  guardInvention,
  guardWithRetry,
};

export default runIntelligencePipeline;
