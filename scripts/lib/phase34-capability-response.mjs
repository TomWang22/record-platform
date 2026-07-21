/**
 * Phase B — shared capability response path.
 * All eight capabilities must build snapshot → claim ledger → envelope.
 */
import {
  buildPlatformEvidenceSnapshot,
  buildClaimLedger,
  buildResponseEnvelope,
  assertClaimLedgerPass,
} from './phase34-claim-ledger.mjs';

export const EIGHT_CAPABILITIES = Object.freeze([
  'scarcity',
  'valuation',
  'auction_intelligence',
  'embeddings',
  'semantic_search',
  'negotiation_assistance',
  'recommendations',
  'market_analytics',
]);

/**
 * Wrap a deterministic structured result into the shared envelope.
 * Rejects delivery without snapshot id/hash and passing claim ledger.
 */
export function finalizeCapabilityResponse({
  capability,
  subject = {},
  candidates = [],
  structured_result = null,
  answer = null,
  customer_summary = null,
  key_values = {},
  claims = [],
  limitations = [],
  next_actions = [],
  confidence = null,
  request = {},
  requireExactPressing = false,
  what_changed = null,
  evidence_summary = null,
  session_state_version = null,
  model_execution = null,
  retrieval_execution = null,
  safety = {},
  telemetry = {},
} = {}) {
  if (!EIGHT_CAPABILITIES.includes(capability)) {
    const err = new Error(`UNKNOWN_CAPABILITY:${capability}`);
    err.code = 'UNKNOWN_CAPABILITY';
    throw err;
  }

  const snapshot = buildPlatformEvidenceSnapshot({
    capability,
    subject,
    candidates,
    requestId: request.request_id || null,
    sessionId: request.session_id || null,
    turnId: request.turn_id || null,
    requestedConstraints: request.constraints || {},
    requireExactPressing,
    queryPlan: request.query_plan || null,
    retrievalExecution: retrieval_execution || {},
    limitations,
  });

  // Auto-derive sold_count claim when structured result provides it.
  const derivedClaims = [...claims];
  if (
    structured_result &&
    typeof structured_result.sold_count === 'number' &&
    !derivedClaims.some((c) => c.claim_type === 'sold_count')
  ) {
    const soldIds = snapshot.included_event_ids.filter((id, idx) => {
      const item = snapshot.eligibility.included[idx];
      return item && (item.event_type === 'SALE_COMPLETED' || item.sale_kind === 'sold');
    });
    // Prefer filtering by type from included list
    const soldEventIds = snapshot.eligibility.included
      .filter((e) => e.event_type === 'SALE_COMPLETED' || e.sale_kind === 'sold')
      .map((e) => e.market_event_id || e.evidence_id)
      .filter(Boolean);
    derivedClaims.push({
      claim_type: 'sold_count',
      normalized_claim_value: structured_result.sold_count,
      expected_count: structured_result.sold_count,
      supporting_snapshot_item_ids: soldEventIds.slice(0, structured_result.sold_count),
      synthesis_path: 'structured_result.sold_count',
      material: true,
    });
  }

  const response_id =
    request.response_id ||
    `resp-${capability}-${snapshot.evidence_snapshot_hash.slice(0, 12)}`;

  const claimLedger = buildClaimLedger({
    responseId: response_id,
    snapshot,
    claims: derivedClaims,
  });

  assertClaimLedgerPass(claimLedger);

  return buildResponseEnvelope({
    capability,
    request: { ...request, response_id },
    answer,
    structured_result,
    customer_summary,
    key_values,
    what_changed,
    evidence_summary: evidence_summary || {
      included: snapshot.included_event_ids.length,
      excluded: snapshot.excluded_event_ids.length,
    },
    limitations,
    next_actions,
    confidence,
    snapshot,
    claimLedger,
    session_state_version,
    model_execution,
    retrieval_execution,
    safety,
    telemetry: {
      ...telemetry,
      evidence_snapshot_id: snapshot.evidence_snapshot_id,
      claim_ledger_id: claimLedger.claim_ledger_id,
    },
  });
}
