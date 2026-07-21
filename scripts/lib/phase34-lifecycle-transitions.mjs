/**
 * Authoritative listing lifecycle transitions (Phase A hardening A5).
 * ARCHIVED is organizational only — never sale proof.
 */
import { LISTING_LIFECYCLE } from './phase34-listing-lifecycle.mjs';

export const LEGAL_LIFECYCLE_TRANSITIONS = Object.freeze({
  [LISTING_LIFECYCLE.ACTIVE]: Object.freeze([
    LISTING_LIFECYCLE.SOLD,
    LISTING_LIFECYCLE.CANCELLED,
    LISTING_LIFECYCLE.EXPIRED,
    LISTING_LIFECYCLE.ENDED_UNSOLD,
    LISTING_LIFECYCLE.ARCHIVED,
  ]),
  [LISTING_LIFECYCLE.ENDED_UNSOLD]: Object.freeze([LISTING_LIFECYCLE.ARCHIVED]),
  [LISTING_LIFECYCLE.CANCELLED]: Object.freeze([LISTING_LIFECYCLE.ARCHIVED]),
  [LISTING_LIFECYCLE.EXPIRED]: Object.freeze([LISTING_LIFECYCLE.ARCHIVED]),
  [LISTING_LIFECYCLE.SOLD]: Object.freeze([]),
  [LISTING_LIFECYCLE.ARCHIVED]: Object.freeze([]),
});

export class IllegalLifecycleTransitionError extends Error {
  constructor(from, to, reason = 'ILLEGAL_LIFECYCLE_TRANSITION') {
    super(`${reason}:${from}->${to}`);
    this.name = 'IllegalLifecycleTransitionError';
    this.code = reason;
    this.from = from;
    this.to = to;
  }
}

export function assertLegalLifecycleTransition(from, to) {
  const src = String(from || LISTING_LIFECYCLE.ACTIVE);
  const dst = String(to || '');
  if (src === dst) return { ok: true, from: src, to: dst, noop: true };
  const allowed = LEGAL_LIFECYCLE_TRANSITIONS[src];
  if (!allowed || !allowed.includes(dst)) {
    throw new IllegalLifecycleTransitionError(src, dst);
  }
  if (dst === LISTING_LIFECYCLE.SOLD && src === LISTING_LIFECYCLE.ARCHIVED) {
    throw new IllegalLifecycleTransitionError(src, dst, 'ARCHIVED_IS_NOT_SOLD');
  }
  return { ok: true, from: src, to: dst, noop: false };
}

/**
 * Apply a lifecycle transition. Returns an audit record (caller persists).
 * sold_at alone must never be used as settlement evidence eligibility.
 */
export function planLifecycleTransition({
  listingId,
  fromLifecycle,
  toLifecycle,
  reasonCode,
  actor = null,
  saleEventId = null,
  settlementEvidenceEligible = null,
  metadata = {},
} = {}) {
  assertLegalLifecycleTransition(fromLifecycle, toLifecycle);
  const eligible =
    toLifecycle === LISTING_LIFECYCLE.SOLD
      ? Boolean(settlementEvidenceEligible && saleEventId)
      : false;
  if (toLifecycle === LISTING_LIFECYCLE.SOLD && !saleEventId) {
    throw new IllegalLifecycleTransitionError(
      fromLifecycle,
      toLifecycle,
      'SOLD_REQUIRES_SALE_COMPLETED_EVENT',
    );
  }
  return {
    listing_id: listingId,
    from_lifecycle: fromLifecycle || LISTING_LIFECYCLE.ACTIVE,
    to_lifecycle: toLifecycle,
    reason_code: reasonCode || 'UNSPECIFIED',
    actor,
    sale_event_id: saleEventId,
    settlement_evidence_eligible: eligible,
    metadata: {
      ...metadata,
      archived_is_not_sold: toLifecycle === LISTING_LIFECYCLE.ARCHIVED,
    },
  };
}
