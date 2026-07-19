/**
 * Authorized evidence bundle — facts before model synthesis.
 * Untraceable material claims must fail closed.
 */
import crypto from 'node:crypto';

export const AUTHORIZED_EVIDENCE_BUNDLE_VERSION = 'phase34-authorized-evidence-bundle-v1';

export const AUTHORIZED_EVIDENCE_FIELDS = Object.freeze([
  'pipeline_version',
  'capability',
  'user_intent',
  'participant_side',
  'authorized_scope',
  'subject_identity',
  'exact_pressing_identity',
  'evidence_snapshot_id',
  'evidence_snapshot_hash',
  'sold_comparables',
  'asking_comparables',
  'auction_events',
  'normalized_market_events',
  'deterministic_metrics',
  'retrieval_results',
  'reranker_results',
  'memory_facts',
  'corrections',
  'excluded_evidence',
  'freshness',
  'limitations',
]);

/**
 * Build a typed authorized evidence bundle. Deterministic metrics are authoritative.
 */
export function buildAuthorizedEvidenceBundle(input = {}) {
  const snapshotPayload = {
    sold: input.sold_comparables || [],
    asking: input.asking_comparables || [],
    auctions: input.auction_events || [],
    metrics: input.deterministic_metrics || {},
    subject: input.subject_identity || null,
    pressing: input.exact_pressing_identity || null,
  };
  const evidence_snapshot_hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(snapshotPayload))
    .digest('hex');

  return {
    pipeline_version: input.pipeline_version || 'phase34-intelligence-pipeline-v1',
    capability: input.capability || null,
    user_intent: input.user_intent || null,
    participant_side: input.participant_side || null,
    authorized_scope: input.authorized_scope || null,
    subject_identity: input.subject_identity || null,
    exact_pressing_identity: input.exact_pressing_identity || null,
    evidence_snapshot_id: input.evidence_snapshot_id || `ev-${evidence_snapshot_hash.slice(0, 16)}`,
    evidence_snapshot_hash,
    sold_comparables: input.sold_comparables || [],
    asking_comparables: input.asking_comparables || [],
    auction_events: input.auction_events || [],
    normalized_market_events: input.normalized_market_events || [],
    deterministic_metrics: input.deterministic_metrics || {},
    retrieval_results: input.retrieval_results || [],
    reranker_results: input.reranker_results || [],
    memory_facts: input.memory_facts || [],
    corrections: input.corrections || [],
    excluded_evidence: input.excluded_evidence || [],
    freshness: input.freshness || null,
    limitations: input.limitations || [],
  };
}

/**
 * Extract numeric material claims from prose-ish answer text.
 * Returns claims that cannot be traced to metrics/evidence → fail closed.
 */
export function findUntraceableMaterialClaims(answerText, bundle) {
  const text = String(answerText || '');
  const numbers = [...text.matchAll(/\$?\d+(?:\.\d+)?%?/g)].map((m) => m[0]);
  const allowed = new Set();
  const metrics = bundle?.deterministic_metrics || {};
  for (const v of Object.values(metrics)) {
    if (typeof v === 'number') allowed.add(String(v));
    if (v && typeof v === 'object') {
      for (const nested of Object.values(v)) {
        if (typeof nested === 'number') allowed.add(String(nested));
      }
    }
  }
  for (const row of [...(bundle?.sold_comparables || []), ...(bundle?.asking_comparables || [])]) {
    if (typeof row.price === 'number') allowed.add(String(row.price));
    if (typeof row.amount === 'number') allowed.add(String(row.amount));
  }

  const untraceable = [];
  for (const n of numbers) {
    const bare = n.replace(/[^\d.]/g, '');
    if (!bare) continue;
    // Allow tiny structural numbers (turn indices etc.) under 3 unless currency-like
    if (!n.includes('$') && !n.includes('%') && Number(bare) < 3) continue;
    if (![...allowed].some((a) => a === bare || a === String(Number(bare)))) {
      untraceable.push(n);
    }
  }
  return untraceable;
}

export function assertMaterialClaimsTraceable(answerText, bundle) {
  const bad = findUntraceableMaterialClaims(answerText, bundle);
  if (bad.length) {
    const err = new Error(`UNTRACEABLE_MATERIAL_CLAIMS:${bad.join(',')}`);
    err.code = 'UNTRACEABLE_MATERIAL_CLAIMS';
    err.claims = bad;
    throw err;
  }
  return true;
}
