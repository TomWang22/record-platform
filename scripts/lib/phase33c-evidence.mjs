/**
 * Phase 33C shared evidence selection (deterministic, keyword/metadata first).
 * Semantic similarity must not override explicit metadata contradictions.
 */

export const REASON_CODES = [
  'EXACT_PRESSING_MATCH',
  'EXACT_RELEASE_MATCH',
  'CONDITION_MATCH',
  'GEOGRAPHY_MATCH',
  'RECENT_SALE',
  'COMPLETED_AUCTION',
  'ACTIVE_ASKING_ONLY',
  'STALE_SOURCE',
  'WRONG_PRESSING',
  'WEAK_COMPARABLE',
  'OUTLIER',
  'UNAUTHORIZED',
  'DELETED',
  'DUPLICATE',
];

export function selectEvidence({
  candidates = [],
  subject = {},
  principalId,
  authorizedScopes = ['public_market', 'authenticated_market'],
  requireExactPressing = false,
  maxEvidence = 12,
  nowMs = Date.parse('2026-07-15T12:00:00.000Z'),
  staleAfterDays = 180,
} = {}) {
  const selected = [];
  const excluded = [];
  const seen = new Set();

  for (const raw of candidates) {
    const c = { ...raw };
    const id = c.evidence_id || c.source_id;
    if (!id) {
      excluded.push({ evidence_id: null, reason_codes: ['WEAK_COMPARABLE'] });
      continue;
    }
    if (seen.has(id)) {
      excluded.push({ evidence_id: id, reason_codes: ['DUPLICATE'] });
      continue;
    }
    seen.add(id);

    const codes = [];
    if (c.deletion_state === 'DELETED' || c.deleted === true) {
      excluded.push({ evidence_id: id, reason_codes: ['DELETED'] });
      continue;
    }
    if (c.privacy_class === 'PROHIBITED') {
      excluded.push({ evidence_id: id, reason_codes: ['UNAUTHORIZED'] });
      continue;
    }
    if (
      (c.privacy_class === 'OWNER_PRIVATE' || c.privacy_class === 'THREAD_PRIVATE') &&
      c.owner_principal_fixture &&
      c.owner_principal_fixture !== principalId
    ) {
      excluded.push({ evidence_id: id, reason_codes: ['UNAUTHORIZED'] });
      continue;
    }
    if (c.authorization_scope && !authorizedScopes.includes(c.authorization_scope)) {
      excluded.push({ evidence_id: id, reason_codes: ['UNAUTHORIZED'] });
      continue;
    }

    if (subject.pressing_id && c.pressing_id) {
      if (c.pressing_id === subject.pressing_id) codes.push('EXACT_PRESSING_MATCH');
      else {
        codes.push('WRONG_PRESSING');
        if (requireExactPressing || c.claim_exact_pressing === true) {
          excluded.push({ evidence_id: id, reason_codes: codes });
          continue;
        }
      }
    }
    if (subject.release_id && c.release_id && c.release_id === subject.release_id) {
      codes.push('EXACT_RELEASE_MATCH');
    }
    if (subject.condition && c.condition && c.condition === subject.condition) {
      codes.push('CONDITION_MATCH');
    }
    if (subject.geography && c.geography && c.geography === subject.geography) {
      codes.push('GEOGRAPHY_MATCH');
    }

    const observed = Date.parse(c.observed_at || c.retrieved_at || 0);
    const ageDays = Number.isFinite(observed) ? (nowMs - observed) / 86400000 : null;
    if (ageDays !== null && ageDays > staleAfterDays) {
      codes.push('STALE_SOURCE');
      c.stale = true;
      c.stale_labeled = c.stale_labeled === true || c.freshness_status === 'stale';
      if (!c.stale_labeled) {
        excluded.push({ evidence_id: id, reason_codes: codes });
        continue;
      }
    }

    if (c.sale_kind === 'sold' || (c.sale_kind == null && c.source_type === 'sale')) {
      codes.push('RECENT_SALE');
    }
    if (c.source_type === 'auction' && c.auction_state === 'completed') codes.push('COMPLETED_AUCTION');
    if (c.sale_kind === 'asking' || (c.sale_kind == null && c.source_type === 'listing')) {
      codes.push('ACTIVE_ASKING_ONLY');
    }
    if (c.outlier === true) {
      codes.push('OUTLIER');
      excluded.push({ evidence_id: id, reason_codes: codes });
      continue;
    }
    if (c.weak_comparable === true) codes.push('WEAK_COMPARABLE');

    // Metadata contradiction beats semantic similarity claims.
    if (c.semantic_only === true && codes.includes('WRONG_PRESSING')) {
      excluded.push({ evidence_id: id, reason_codes: codes });
      continue;
    }

    // sale_kind=sold must never render as source_type "listing".
    let sourceType = c.source_type || 'public_metadata';
    if (c.sale_kind === 'sold' && sourceType === 'listing') sourceType = 'sale';
    if (c.sale_kind === 'asking' && sourceType === 'sale') sourceType = 'listing';

    selected.push({
      evidence_id: id,
      source_type: sourceType,
      source_id: c.source_id || id,
      retrieved_at: c.retrieved_at || c.observed_at || new Date(nowMs).toISOString(),
      observed_at: c.observed_at || null,
      summary:
        c.summary ||
        (c.sale_kind === 'sold'
          ? `Sold comparable${typeof c.price === 'number' ? ` for $${c.price}` : ''}`
          : c.sale_kind === 'asking'
            ? `Asking comparable${typeof c.price === 'number' ? ` for $${c.price}` : ''}`
            : 'Marketplace comparable'),
      authorization_scope: c.authorization_scope || 'authenticated_market',
      freshness_status: c.stale ? 'stale' : 'fresh',
      reason_codes: codes,
      sale_kind: c.sale_kind || null,
      price: typeof c.price === 'number' ? c.price : null,
      currency: c.currency || null,
      pressing_id: c.pressing_id || null,
      release_id: c.release_id || null,
      condition: c.condition || null,
      auction_state: c.auction_state || null,
      bid_count: c.bid_count ?? null,
      bid_velocity: c.bid_velocity ?? null,
      late_bid_pressure: c.late_bid_pressure ?? null,
      price_acceleration: c.price_acceleration ?? null,
      end_at: c.end_at || null,
      owner_principal_fixture: c.owner_principal_fixture || null,
    });
  }

  selected.sort((a, b) => {
    const score = (e) =>
      (e.reason_codes.includes('EXACT_PRESSING_MATCH') ? 8 : 0) +
      (e.reason_codes.includes('EXACT_RELEASE_MATCH') ? 4 : 0) +
      (e.reason_codes.includes('RECENT_SALE') ? 3 : 0) +
      (e.reason_codes.includes('COMPLETED_AUCTION') ? 2 : 0) -
      (e.reason_codes.includes('ACTIVE_ASKING_ONLY') ? 1 : 0) -
      (e.reason_codes.includes('STALE_SOURCE') ? 2 : 0) -
      (e.reason_codes.includes('WEAK_COMPARABLE') ? 2 : 0);
    return score(b) - score(a) || a.evidence_id.localeCompare(b.evidence_id);
  });

  const capped = selected.slice(0, maxEvidence);
  for (const drop of selected.slice(maxEvidence)) {
    excluded.push({ evidence_id: drop.evidence_id, reason_codes: ['WEAK_COMPARABLE'] });
  }

  return {
    selected: capped,
    excluded,
    evidence_for_schema: capped.map((e) => ({
      evidence_id: e.evidence_id,
      source_type: ['listing', 'sale', 'auction', 'release', 'pressing', 'market_report', 'authorized_thread_summary', 'public_metadata', 'derived_aggregate'].includes(e.source_type)
        ? e.source_type
        : 'public_metadata',
      source_id: e.source_id,
      retrieved_at: e.retrieved_at,
      observed_at: e.observed_at,
      summary: e.summary,
    })),
  };
}
