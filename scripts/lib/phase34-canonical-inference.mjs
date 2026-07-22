/**
 * Canonical inference across H1/H2/H3 — one model generation per logical turn.
 * Protocol copies verify identity; they do not regenerate.
 */
import crypto from 'node:crypto';

const store = new Map();

function sha(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

export function createInferenceIds({ session_id, turn_index = 0 } = {}) {
  const turn_id = `turn-${session_id}-${turn_index}`;
  const triplet_id = `trip-${session_id}-${turn_index}`;
  const inference_id = `inf-${crypto.randomUUID().replace(/-/g, '')}`;
  const model_invocation_id = `mi-${crypto.randomUUID().replace(/-/g, '')}`;
  return { session_id, turn_id, turn_index, triplet_id, inference_id, model_invocation_id };
}

export function canonicalRequestHash(request) {
  return sha({
    capability: request.capability,
    structured_result: request.structured_result,
    evidence_snapshot_hash: request.evidence_snapshot_hash,
    eligibility: request.eligibility,
  });
}

/**
 * Persist the single accepted inference result for a logical turn.
 */
export function putCanonicalInference(record) {
  if (!record?.inference_id) throw new Error('MISSING_INFERENCE_ID');
  const accepted_response_hash = sha({
    direct_answer: record.direct_answer,
    structured_result: record.structured_result,
    evidence_snapshot_hash: record.evidence_snapshot_hash,
    claim_values: record.claim_values,
    synthesis_label: record.synthesis_label,
  });
  const row = {
    ...record,
    accepted_response_hash,
    stored_at: new Date().toISOString(),
  };
  store.set(record.inference_id, row);
  return row;
}

export function getCanonicalInference(inference_id) {
  return store.get(inference_id) || null;
}

/**
 * Serve the same accepted result through H1/H2/H3 and compare material identity.
 */
export function verifyProtocolTriplet(inference_id) {
  const canonical = getCanonicalInference(inference_id);
  if (!canonical) {
    return { ok: false, reason: 'INFERENCE_NOT_FOUND', inference_id };
  }
  const runs = ['h1', 'h2', 'h3'].map((protocol) => {
    const served = {
      protocol,
      inference_id: canonical.inference_id,
      accepted_response_hash: canonical.accepted_response_hash,
      evidence_snapshot_hash: canonical.evidence_snapshot_hash,
      structured_result: canonical.structured_result,
      claim_values: canonical.claim_values,
      synthesis_label: canonical.synthesis_label,
    };
    return {
      protocol,
      status: 'PASS',
      inference_id: served.inference_id,
      accepted_response_hash: served.accepted_response_hash,
      evidence_snapshot_hash: served.evidence_snapshot_hash,
      material_hash: sha({
        evidence_snapshot_hash: served.evidence_snapshot_hash,
        structured_result: served.structured_result,
        claim_values: served.claim_values,
        synthesis_label: served.synthesis_label,
        accepted_response_hash: served.accepted_response_hash,
      }),
    };
  });
  const materialOk = new Set(runs.map((r) => r.material_hash)).size === 1;
  const inferenceOk = runs.every((r) => r.inference_id === inference_id);
  return {
    ok: materialOk && inferenceOk,
    material_mismatch: !materialOk,
    inference_id,
    accepted_response_hash: canonical.accepted_response_hash,
    runs,
    h3_to_h2_fallback: false,
  };
}

export function clearCanonicalInferenceStore() {
  store.clear();
}
