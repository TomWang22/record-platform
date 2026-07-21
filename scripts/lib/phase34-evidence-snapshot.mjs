/**
 * Phase 34 bounded evidence snapshots and claim→evidence mapping.
 * Unsupported / contradicted material claims fail closed.
 */
import crypto from 'node:crypto';

export const EVIDENCE_SNAPSHOT_VERSION = 'phase34-evidence-snapshot-v1';

export const SUPPORT_STATUSES = Object.freeze([
  'SUPPORTED',
  'PARTIALLY_SUPPORTED',
  'UNSUPPORTED',
  'CONTRADICTED',
]);

export const MATERIAL_CLAIM_TYPES = Object.freeze([
  'price',
  'valuation',
  'sold_count',
  'asking_count',
  'exact_pressing',
  'auction_velocity',
  'financial',
  'scarcity',
  'comparable',
]);

function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function sha256(obj) {
  return crypto.createHash('sha256').update(stableStringify(obj)).digest('hex');
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function evidenceIdsOf(items) {
  return asArray(items)
    .map((e) => e?.evidence_id)
    .filter(Boolean);
}

/**
 * Build a bounded, hash-stable evidence snapshot for model consumption.
 */
export function buildEvidenceSnapshot({
  capability = null,
  subject = null,
  participant_side = null,
  authorized_scope = null,
  evidence_items = [],
  metrics = {},
  limitations = [],
  created_at = null,
  sold_comparables = null,
  asking_comparables = null,
  auction_evidence = null,
  watchlist_evidence = null,
  collection_context = null,
  authorized_conversation_facts = null,
  retrieval_results = null,
  analytics_values = null,
  exact_pressing_evidence = null,
  release_level_evidence = null,
} = {}) {
  const items = asArray(evidence_items);
  const included = items.filter((e) => e.included !== false);
  const excluded = items.filter((e) => e.included === false);

  const sold =
    sold_comparables ??
    included.filter(
      (e) =>
        e.sale_kind === 'sold' ||
        e.event_type === 'COMPLETED_SALE' ||
        e.event_type === 'SALE_COMPLETED' ||
        e.event_type === 'AUCTION_COMPLETED',
    );
  const asking =
    asking_comparables ??
    included.filter(
      (e) => e.sale_kind === 'asking' || e.event_type === 'ASKING_LISTING',
    );
  const auctions =
    auction_evidence ??
    included.filter((e) => String(e.event_type || '').startsWith('AUCTION_'));

  const exactPressing =
    exact_pressing_evidence ??
    included.filter(
      (e) =>
        e.pressing_confidence === 'EXACT_PRESSING_MATCH' ||
        e.identity_status === 'EXACT',
    );
  const releaseLevel =
    release_level_evidence ??
    included.filter(
      (e) =>
        e.pressing_confidence === 'RELEASE_LEVEL_MATCH' ||
        e.identity_status === 'RELEASE_LEVEL_ONLY',
    );

  const source_distribution = {};
  for (const e of included) {
    const key = e.source_id || 'unknown';
    source_distribution[key] = (source_distribution[key] || 0) + 1;
  }

  const freshness = {
    fresh: included.filter((e) => e.freshness === 'fresh').length,
    stale: included.filter((e) => e.freshness === 'stale').length,
    total: included.length,
  };

  const analytics = analytics_values ?? metrics ?? {};

  const payload = {
    capability,
    subject_identity: subject,
    participant_side,
    authorized_scope,
    source_distribution,
    exact_pressing_evidence: exactPressing,
    release_level_evidence: releaseLevel,
    sold_comparables: sold,
    asking_comparables: asking,
    auction_evidence: auctions,
    watchlist_evidence: watchlist_evidence ?? [],
    collection_context: collection_context ?? null,
    authorized_conversation_facts: authorized_conversation_facts ?? [],
    retrieval_results: retrieval_results ?? [],
    analytics_values: analytics,
    excluded_evidence: excluded,
    limitations: asArray(limitations),
    included_evidence_ids: evidenceIdsOf(included).sort(),
  };

  const evidence_snapshot_hash = sha256(payload);
  const created = created_at || new Date(0).toISOString();

  return {
    evidence_snapshot_id: `es-${evidence_snapshot_hash.slice(0, 16)}`,
    evidence_snapshot_hash,
    evidence_snapshot_version: EVIDENCE_SNAPSHOT_VERSION,
    capability,
    subject_identity: subject,
    participant_side,
    authorized_scope,
    created_at: created,
    freshness,
    source_distribution,
    exact_pressing_evidence: exactPressing,
    release_level_evidence: releaseLevel,
    sold_comparables: sold,
    asking_comparables: asking,
    auction_evidence: auctions,
    watchlist_evidence: watchlist_evidence ?? [],
    collection_context: collection_context ?? null,
    authorized_conversation_facts: authorized_conversation_facts ?? [],
    retrieval_results: retrieval_results ?? [],
    analytics_values: analytics,
    excluded_evidence: excluded,
    limitations: asArray(limitations),
  };
}

function snapshotEvidenceIndex(snapshot) {
  const map = new Map();
  const buckets = [
    ...asArray(snapshot.exact_pressing_evidence),
    ...asArray(snapshot.release_level_evidence),
    ...asArray(snapshot.sold_comparables),
    ...asArray(snapshot.asking_comparables),
    ...asArray(snapshot.auction_evidence),
    ...asArray(snapshot.watchlist_evidence),
    ...asArray(snapshot.authorized_conversation_facts),
    ...asArray(snapshot.retrieval_results),
    ...asArray(snapshot.excluded_evidence),
  ];
  for (const e of buckets) {
    if (e?.evidence_id) map.set(e.evidence_id, e);
  }
  return map;
}

function metricIdsOf(snapshot) {
  const metrics = snapshot.analytics_values || {};
  return Object.keys(metrics);
}

function isMaterialClaim(claim) {
  if (claim.material === true) return true;
  const t = String(claim.claim_type || '').toLowerCase();
  return MATERIAL_CLAIM_TYPES.includes(t);
}

/**
 * Map answer claims to evidence / deterministic metrics in a snapshot.
 */
export function mapClaimsToEvidence(claims = [], snapshot = {}) {
  const evidenceIndex = snapshotEvidenceIndex(snapshot);
  const metricKeys = new Set(metricIdsOf(snapshot));
  const excludedIds = new Set(
    asArray(snapshot.excluded_evidence)
      .map((e) => e.evidence_id)
      .filter(Boolean),
  );

  return asArray(claims).map((claim, idx) => {
    const claim_id = claim.claim_id || `claim-${idx + 1}`;
    const claim_text = claim.claim_text || claim.text || '';
    const claim_type = claim.claim_type || 'general';
    const requestedEvidence = asArray(claim.evidence_ids);
    const requestedMetrics = asArray(claim.deterministic_metric_ids || claim.metric_ids);

    const validEvidence = [];
    const contradicted = [];
    for (const id of requestedEvidence) {
      if (excludedIds.has(id)) {
        contradicted.push(id);
        continue;
      }
      if (evidenceIndex.has(id)) validEvidence.push(id);
    }

    const validMetrics = requestedMetrics.filter((id) => metricKeys.has(id));
    const missingEvidence = requestedEvidence.filter(
      (id) => !validEvidence.includes(id) && !contradicted.includes(id),
    );
    const missingMetrics = requestedMetrics.filter((id) => !validMetrics.includes(id));

    let support_status = 'UNSUPPORTED';
    if (contradicted.length && !validEvidence.length && !validMetrics.length) {
      support_status = 'CONTRADICTED';
    } else if (contradicted.length && (validEvidence.length || validMetrics.length)) {
      support_status = 'CONTRADICTED';
    } else if (
      (requestedEvidence.length || requestedMetrics.length) &&
      missingEvidence.length === 0 &&
      missingMetrics.length === 0 &&
      (validEvidence.length > 0 || validMetrics.length > 0)
    ) {
      support_status = 'SUPPORTED';
    } else if (validEvidence.length > 0 || validMetrics.length > 0) {
      support_status = 'PARTIALLY_SUPPORTED';
    } else if (!requestedEvidence.length && !requestedMetrics.length) {
      support_status = 'UNSUPPORTED';
    }

    // Explicit override from caller for fixture tests.
    if (claim.support_status && SUPPORT_STATUSES.includes(claim.support_status)) {
      support_status = claim.support_status;
    }

    const confidence =
      typeof claim.confidence === 'number'
        ? claim.confidence
        : support_status === 'SUPPORTED'
          ? 0.9
          : support_status === 'PARTIALLY_SUPPORTED'
            ? 0.55
            : 0.1;

    return {
      claim_id,
      claim_text,
      claim_type,
      evidence_ids: validEvidence,
      deterministic_metric_ids: validMetrics,
      confidence,
      support_status,
      material: isMaterialClaim(claim),
      contradicted_evidence_ids: contradicted,
      missing_evidence_ids: missingEvidence,
      missing_metric_ids: missingMetrics,
    };
  });
}

/**
 * Fail closed when any material claim is UNSUPPORTED or CONTRADICTED.
 */
export function assertNoUnsupportedMaterialClaims(claimMap = []) {
  const bad = asArray(claimMap).filter(
    (c) =>
      c.material !== false &&
      isMaterialClaim(c) &&
      (c.support_status === 'UNSUPPORTED' || c.support_status === 'CONTRADICTED'),
  );
  if (bad.length) {
    const err = new Error(
      `UNSUPPORTED_MATERIAL_CLAIMS:${bad.map((c) => c.claim_id).join(',')}`,
    );
    err.code = 'UNSUPPORTED_MATERIAL_CLAIMS';
    err.claims = bad;
    throw err;
  }
  return true;
}
