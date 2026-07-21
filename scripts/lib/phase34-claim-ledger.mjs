/**
 * Phase B5/B6 — immutable evidence snapshot + claim-to-evidence ledger.
 */
import crypto from 'node:crypto';
import { buildEvidenceSnapshot, SUPPORT_STATUSES } from './phase34-evidence-snapshot.mjs';
import { evaluateEligibility } from './phase34-eligibility-engine.mjs';
import { resolveEntity } from './phase34-entity-resolution.mjs';

export const PLATFORM_SNAPSHOT_VERSION = 'phase34-evidence-snapshot-v2';
export const RESPONSE_ENVELOPE_VERSION = 'phase34-response-envelope-v1';

function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function sha256(obj) {
  return crypto.createHash('sha256').update(stableStringify(obj)).digest('hex');
}

/**
 * Build a platform evidence snapshot from candidate events.
 * Every intelligence response must carry evidence_snapshot_id + hash.
 */
export function buildPlatformEvidenceSnapshot({
  capability,
  subject = {},
  candidates = [],
  requestId = null,
  sessionId = null,
  turnId = null,
  requestedConstraints = {},
  requireExactPressing = false,
  queryPlan = null,
  retrievalExecution = {},
  limitations = [],
  createdAt = null,
} = {}) {
  if (!capability) {
    const err = new Error('EVIDENCE_SNAPSHOT_REQUIRES_CAPABILITY');
    err.code = 'EVIDENCE_SNAPSHOT_REQUIRES_CAPABILITY';
    throw err;
  }

  const resolution = resolveEntity(subject, requestedConstraints.catalog_candidates || []);
  const eligibility = evaluateEligibility(candidates, {
    resolution,
    requireExactPressing:
      requireExactPressing || requestedConstraints.exact_pressing === true,
  });

  const evidence_items = [
    ...eligibility.included.map((e) => ({
      ...e,
      included: true,
      evidence_id: e.evidence_id || e.market_event_id,
    })),
    ...eligibility.exclusions.map((x) => ({
      ...(x.event || {}),
      included: false,
      evidence_id: x.evidence_id,
      exclusion_decision: x.decision,
      exclusion_reason: x.reason_detail,
    })),
  ];

  const base = buildEvidenceSnapshot({
    capability,
    subject,
    authorized_scope: requestedConstraints.authorization_scope || null,
    evidence_items,
    limitations,
    created_at: createdAt,
  });

  const source_rights_distribution = {};
  const event_type_distribution = {};
  for (const e of eligibility.included) {
    const rights = e.rights_status || e.source_class || 'unknown';
    source_rights_distribution[rights] = (source_rights_distribution[rights] || 0) + 1;
    const et = e.event_type || 'unknown';
    event_type_distribution[et] = (event_type_distribution[et] || 0) + 1;
  }

  const times = eligibility.included
    .map((e) => Date.parse(e.occurred_at || e.sold_at || e.observed_at || ''))
    .filter((n) => Number.isFinite(n));

  const platformPayload = {
    ...base,
    evidence_snapshot_version: PLATFORM_SNAPSHOT_VERSION,
    request_id: requestId,
    session_id: sessionId,
    turn_id: turnId,
    subject_resolution: resolution,
    requested_constraints: requestedConstraints,
    included_event_ids: eligibility.included.map((e) => e.market_event_id || e.evidence_id).filter(Boolean),
    excluded_event_ids: eligibility.exclusions.map((x) => ({
      id: x.market_event_id || x.evidence_id,
      decision: x.decision,
      reason: x.reason_detail,
    })),
    source_rights_distribution,
    event_type_distribution,
    data_time_range: {
      start: times.length ? new Date(Math.min(...times)).toISOString() : null,
      end: times.length ? new Date(Math.max(...times)).toISOString() : null,
    },
    dedupe_version: 'phase34-dedupe-v1',
    eligibility_version: eligibility.eligibility_version,
    retrieval_version: retrievalExecution.version || 'phase34-retrieval-v1',
    query_plan: queryPlan,
    retrieval_execution: retrievalExecution,
  };

  const evidence_snapshot_hash = sha256(platformPayload);
  const evidence_snapshot_id = `es-${evidence_snapshot_hash.slice(0, 20)}`;

  return Object.freeze({
    ...platformPayload,
    evidence_snapshot_id,
    evidence_snapshot_hash,
    eligibility,
  });
}

/**
 * Build claim ledger entries and verify material claims against the snapshot.
 */
export function buildClaimLedger({
  responseId,
  snapshot,
  claims = [],
} = {}) {
  if (!snapshot?.evidence_snapshot_id || !snapshot?.evidence_snapshot_hash) {
    const err = new Error('CLAIM_LEDGER_REQUIRES_SNAPSHOT');
    err.code = 'CLAIM_LEDGER_REQUIRES_SNAPSHOT';
    throw err;
  }
  if (!responseId) {
    const err = new Error('CLAIM_LEDGER_REQUIRES_RESPONSE_ID');
    err.code = 'CLAIM_LEDGER_REQUIRES_RESPONSE_ID';
    throw err;
  }

  const includedIds = new Set(snapshot.included_event_ids || []);
  const entries = [];
  let verification_status = 'PASS';

  for (let i = 0; i < claims.length; i += 1) {
    const claim = claims[i];
    const supporting = Array.isArray(claim.supporting_snapshot_item_ids)
      ? claim.supporting_snapshot_item_ids
      : [];
    let verification_result = 'SUPPORTED';

    if (claim.material !== false) {
      if (claim.expected_count === 0 && supporting.length === 0) {
        verification_result = 'SUPPORTED';
      } else if (supporting.length === 0) {
        verification_result = 'UNSUPPORTED';
      } else if (!supporting.every((id) => includedIds.has(id) || id.startsWith('calc:'))) {
        verification_result = 'UNSUPPORTED';
      }
      if (
        claim.expected_count != null &&
        claim.expected_count !== 0 &&
        supporting.filter((id) => includedIds.has(id)).length !== claim.expected_count
      ) {
        verification_result = 'CONTRADICTED';
      }
      if (claim.expected_count === 0 && supporting.length === 0) {
        verification_result = 'SUPPORTED';
      }
    }

    if (verification_result === 'UNSUPPORTED' || verification_result === 'CONTRADICTED') {
      verification_status = 'FAIL';
    }

    entries.push({
      claim_id: claim.claim_id || `claim-${responseId}-${i + 1}`,
      response_id: responseId,
      claim_type: claim.claim_type || 'unknown',
      normalized_claim_value: claim.normalized_claim_value ?? claim.value ?? null,
      supporting_snapshot_item_ids: supporting,
      deterministic_calculation_id: claim.deterministic_calculation_id || null,
      synthesis_path: claim.synthesis_path || null,
      verification_result,
    });
  }

  const claim_ledger_id = `cl-${sha256({ responseId, snapshot: snapshot.evidence_snapshot_hash, entries }).slice(0, 20)}`;

  return Object.freeze({
    claim_ledger_id,
    response_id: responseId,
    evidence_snapshot_id: snapshot.evidence_snapshot_id,
    evidence_snapshot_hash: snapshot.evidence_snapshot_hash,
    verification_status,
    entries,
    support_statuses: SUPPORT_STATUSES,
  });
}

/**
 * Fail closed: material unsupported claims block customer delivery.
 */
export function assertClaimLedgerPass(ledger) {
  if (!ledger || ledger.verification_status !== 'PASS') {
    const err = new Error('CLAIM_LEDGER_VERIFICATION_FAILED');
    err.code = 'CLAIM_LEDGER_VERIFICATION_FAILED';
    err.ledger = ledger;
    throw err;
  }
  return ledger;
}

/**
 * Shared versioned response envelope (B7).
 */
export function buildResponseEnvelope({
  capability,
  request = {},
  answer = null,
  structured_result = null,
  customer_summary = null,
  key_values = {},
  what_changed = null,
  evidence_summary = null,
  limitations = [],
  next_actions = [],
  confidence = null,
  snapshot,
  claimLedger,
  session_state_version = null,
  model_execution = null,
  retrieval_execution = null,
  safety = {},
  telemetry = {},
} = {}) {
  if (!snapshot?.evidence_snapshot_id || !snapshot?.evidence_snapshot_hash) {
    const err = new Error('RESPONSE_ENVELOPE_REQUIRES_SNAPSHOT');
    err.code = 'RESPONSE_ENVELOPE_REQUIRES_SNAPSHOT';
    throw err;
  }
  assertClaimLedgerPass(claimLedger);

  const response_id =
    request.response_id ||
    `resp-${sha256({ capability, snapshot: snapshot.evidence_snapshot_hash, t: Date.now() }).slice(0, 20)}`;

  return Object.freeze({
    response_id,
    capability,
    request,
    answer,
    structured_result,
    customer_summary,
    key_values,
    what_changed,
    evidence_summary,
    limitations,
    next_actions,
    confidence,
    evidence_snapshot_id: snapshot.evidence_snapshot_id,
    evidence_snapshot_hash: snapshot.evidence_snapshot_hash,
    claim_ledger_id: claimLedger.claim_ledger_id,
    session_state_version,
    model_execution,
    retrieval_execution,
    safety,
    telemetry,
    envelope_version: RESPONSE_ENVELOPE_VERSION,
  });
}
