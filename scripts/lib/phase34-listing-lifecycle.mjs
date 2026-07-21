/**
 * Phase 34 Phase A — canonical listing lifecycle.
 * ARCHIVED / PAUSED / draft must never equal SOLD evidence.
 */
export const LISTING_LIFECYCLE = Object.freeze({
  ACTIVE: 'ACTIVE',
  ENDED_UNSOLD: 'ENDED_UNSOLD',
  SOLD: 'SOLD',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  ARCHIVED: 'ARCHIVED',
});

export const LISTING_LIFECYCLE_VALUES = Object.freeze(Object.values(LISTING_LIFECYCLE));

/** Legacy / DB status strings mapped into the canonical lifecycle. */
const LEGACY_TO_CANONICAL = Object.freeze({
  active: LISTING_LIFECYCLE.ACTIVE,
  published: LISTING_LIFECYCLE.ACTIVE,
  draft: LISTING_LIFECYCLE.ACTIVE,
  paused: LISTING_LIFECYCLE.ARCHIVED,
  archived: LISTING_LIFECYCLE.ARCHIVED,
  closed: LISTING_LIFECYCLE.ENDED_UNSOLD,
  cancelled: LISTING_LIFECYCLE.CANCELLED,
  canceled: LISTING_LIFECYCLE.CANCELLED,
  expired: LISTING_LIFECYCLE.EXPIRED,
  ended: LISTING_LIFECYCLE.ENDED_UNSOLD,
  sold: LISTING_LIFECYCLE.SOLD,
});

/**
 * Map a listing status into the canonical lifecycle.
 * Hard rule: ARCHIVED never becomes SOLD via soldAt — archival is not settlement.
 */
export function normalizeListingLifecycle(raw, { soldAt = null } = {}) {
  const key = String(raw || '')
    .trim()
    .toLowerCase();
  if (LISTING_LIFECYCLE[String(raw || '').trim().toUpperCase()]) {
    const canonical = LISTING_LIFECYCLE[String(raw || '').trim().toUpperCase()];
    if (canonical === LISTING_LIFECYCLE.ARCHIVED) return LISTING_LIFECYCLE.ARCHIVED;
    if (soldAt && canonical !== LISTING_LIFECYCLE.ARCHIVED) return LISTING_LIFECYCLE.SOLD;
    return canonical;
  }
  if (!key) {
    return soldAt ? LISTING_LIFECYCLE.SOLD : null;
  }
  const mapped = LEGACY_TO_CANONICAL[key] || null;
  if (mapped === LISTING_LIFECYCLE.ARCHIVED) return LISTING_LIFECYCLE.ARCHIVED;
  if (soldAt) return LISTING_LIFECYCLE.SOLD;
  return mapped;
}

export function isSoldLifecycle(raw, opts) {
  return normalizeListingLifecycle(raw, opts) === LISTING_LIFECYCLE.SOLD;
}

export function isArchivedLifecycle(raw, opts = {}) {
  return normalizeListingLifecycle(raw, { ...opts, soldAt: null }) === LISTING_LIFECYCLE.ARCHIVED;
}

/**
 * Hard rule: archival / pause / closed-without-sold_at cannot produce sold evidence.
 */
export function assertNeverSoldFromArchive(raw, opts = {}) {
  const prior = normalizeListingLifecycle(raw, { soldAt: null });
  if (prior === LISTING_LIFECYCLE.ARCHIVED) {
    const err = new Error('LISTING_ARCHIVED_IS_NOT_SOLD');
    err.code = 'LISTING_ARCHIVED_IS_NOT_SOLD';
    throw err;
  }
  if (
    prior === LISTING_LIFECYCLE.ENDED_UNSOLD ||
    prior === LISTING_LIFECYCLE.CANCELLED ||
    prior === LISTING_LIFECYCLE.EXPIRED
  ) {
    if (!opts.soldAt && !opts.allowEndedWithoutSettlement) {
      const err = new Error('LISTING_ENDED_WITHOUT_SETTLEMENT_IS_NOT_SOLD');
      err.code = 'LISTING_ENDED_WITHOUT_SETTLEMENT_IS_NOT_SOLD';
      throw err;
    }
  }
  return prior;
}
