/**
 * Phase 33F normalized cross-protocol parity comparison.
 * Compares structured values, not prose bytes.
 */

export const DIFF_CLASSES = [
  'PRESENTATION_ONLY',
  'ALLOWED_NUMERIC_TOLERANCE',
  'EVIDENCE_ORDER_ONLY',
  'MATERIAL_CONCLUSION_MISMATCH',
  'SCHEMA_MISMATCH',
  'SAFETY_MISMATCH',
  'PRIVACY_MISMATCH',
  'RANKING_MISMATCH',
  'RETRIEVAL_MISMATCH',
  'MEMORY_MISMATCH',
  'PROTOCOL_MISMATCH',
];

const MATERIAL = new Set([
  'MATERIAL_CONCLUSION_MISMATCH',
  'SCHEMA_MISMATCH',
  'SAFETY_MISMATCH',
  'PRIVACY_MISMATCH',
  'RANKING_MISMATCH',
  'RETRIEVAL_MISMATCH',
  'MEMORY_MISMATCH',
  'PROTOCOL_MISMATCH',
]);

function almostEqual(a, b, tol = 1e-6) {
  if (a == null && b == null) return true;
  if (typeof a !== 'number' || typeof b !== 'number') return a === b;
  return Math.abs(a - b) <= tol;
}

function sortEvidenceIds(list) {
  return [...(list || [])]
    .map((e) => (typeof e === 'string' ? e : e?.evidence_id || e?.source_id || JSON.stringify(e)))
    .sort();
}

/**
 * @param {object} a normalized H1/H2/H3 structured outputs for one batch
 * @param {object} b
 * @param {{ numericTolerance?: number }} [opts]
 */
export function compareNormalizedCapabilityOutputs(a, b, opts = {}) {
  const tol = opts.numericTolerance ?? 1e-6;
  const diffs = [];

  if (!a || !b) {
    diffs.push({ class: 'SCHEMA_MISMATCH', field: 'root', detail: 'missing_side' });
    return summarize(diffs);
  }

  for (const field of ['capability', 'capability_mode', 'schema_version']) {
    if (a[field] !== b[field]) {
      diffs.push({ class: 'SCHEMA_MISMATCH', field, left: a[field], right: b[field] });
    }
  }

  if (JSON.stringify(a.subject || {}) !== JSON.stringify(b.subject || {})) {
    diffs.push({ class: 'MATERIAL_CONCLUSION_MISMATCH', field: 'subject' });
  }

  if (a.exact_pressing_claim !== b.exact_pressing_claim) {
    diffs.push({
      class: 'MATERIAL_CONCLUSION_MISMATCH',
      field: 'exact_pressing_claim',
      left: a.exact_pressing_claim,
      right: b.exact_pressing_claim,
    });
  }

  if (!almostEqual(a.numeric_result, b.numeric_result, tol)) {
    const withinLoose = almostEqual(a.numeric_result, b.numeric_result, opts.looseNumericTolerance ?? 0.01);
    diffs.push({
      class: withinLoose ? 'ALLOWED_NUMERIC_TOLERANCE' : 'MATERIAL_CONCLUSION_MISMATCH',
      field: 'numeric_result',
      left: a.numeric_result,
      right: b.numeric_result,
    });
  }

  if (!almostEqual(a.confidence, b.confidence, opts.confidenceTolerance ?? 0.02)) {
    diffs.push({
      class: 'MATERIAL_CONCLUSION_MISMATCH',
      field: 'confidence',
      left: a.confidence,
      right: b.confidence,
    });
  } else if (!almostEqual(a.confidence, b.confidence, tol) && almostEqual(a.confidence, b.confidence, opts.confidenceTolerance ?? 0.02)) {
    diffs.push({ class: 'ALLOWED_NUMERIC_TOLERANCE', field: 'confidence' });
  }

  if (Boolean(a.abstention?.abstained) !== Boolean(b.abstention?.abstained)) {
    diffs.push({ class: 'SAFETY_MISMATCH', field: 'abstention' });
  }

  const limA = [...(a.limitations || [])].map(String).sort().join('|');
  const limB = [...(b.limitations || [])].map(String).sort().join('|');
  if (limA !== limB) {
    diffs.push({ class: 'MATERIAL_CONCLUSION_MISMATCH', field: 'limitations' });
  }

  if (a.safety_decision !== b.safety_decision) {
    diffs.push({ class: 'SAFETY_MISMATCH', field: 'safety_decision' });
  }
  if (a.privacy_decision !== b.privacy_decision) {
    diffs.push({ class: 'PRIVACY_MISMATCH', field: 'privacy_decision' });
  }

  if (JSON.stringify(a.ranking_order || []) !== JSON.stringify(b.ranking_order || [])) {
    diffs.push({ class: 'RANKING_MISMATCH', field: 'ranking_order' });
  }
  if (a.retrieval_mode !== b.retrieval_mode) {
    diffs.push({ class: 'RETRIEVAL_MISMATCH', field: 'retrieval_mode' });
  }
  if (JSON.stringify(a.memory_selection || []) !== JSON.stringify(b.memory_selection || [])) {
    diffs.push({ class: 'MEMORY_MISMATCH', field: 'memory_selection' });
  }

  const evA = sortEvidenceIds(a.evidence_ids || a.evidence);
  const evB = sortEvidenceIds(b.evidence_ids || b.evidence);
  if (JSON.stringify(evA) !== JSON.stringify(evB)) {
    const setA = new Set(evA);
    const setB = new Set(evB);
    const sameSet = evA.length === evB.length && evA.every((id) => setB.has(id));
    diffs.push({
      class: sameSet ? 'EVIDENCE_ORDER_ONLY' : 'MATERIAL_CONCLUSION_MISMATCH',
      field: 'evidence_ids',
    });
  }

  if (a.summary_text !== b.summary_text && JSON.stringify(a) !== JSON.stringify(b)) {
    // prose-only difference flagged after structured checks
    const materialAlready = diffs.some((d) => MATERIAL.has(d.class));
    if (!materialAlready && a.summary_text != null && b.summary_text != null) {
      diffs.push({ class: 'PRESENTATION_ONLY', field: 'summary_text' });
    }
  }

  if (a.observed_protocol && b.observed_protocol && a.observed_protocol === b.observed_protocol) {
    // comparing same protocol copies shouldn't happen; when comparing across protocols, protocol field may differ
  } else if (a.requested_protocol && b.requested_protocol && a.requested_protocol === b.requested_protocol) {
    if (a.observed_protocol !== b.observed_protocol) {
      diffs.push({ class: 'PROTOCOL_MISMATCH', field: 'observed_protocol' });
    }
  }

  return summarize(diffs);
}

function summarize(diffs) {
  const material = diffs.filter((d) => MATERIAL.has(d.class));
  return {
    status: material.length ? 'FAIL' : 'PASS',
    material_mismatch_count: material.length,
    diffs,
  };
}

/**
 * Compare a synchronized H1/H2/H3 triplet of normalized results.
 */
export function evaluateTripletParity(triplet, opts = {}) {
  const { h1, h2, h3 } = triplet || {};
  const pairs = [
    compareNormalizedCapabilityOutputs(h1, h2, opts),
    compareNormalizedCapabilityOutputs(h1, h3, opts),
    compareNormalizedCapabilityOutputs(h2, h3, opts),
  ];
  const material = pairs.reduce((n, p) => n + p.material_mismatch_count, 0);
  return {
    status: material === 0 ? 'PASS' : 'FAIL',
    material_mismatch_count: material,
    pair_results: pairs,
  };
}
