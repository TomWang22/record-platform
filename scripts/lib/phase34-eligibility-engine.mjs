/**
 * Shared eligibility + dedupe engine (Phase B4 + Phase G rights).
 * sold_at / archive / seed / force floors never become INCLUDED sold evidence.
 * FORBIDDEN/UNLICENSED and disabled connectors are EXCLUDED_RIGHTS.
 */
import {
  evaluateRightsEligibility,
  assertIncludedEventHasRightsClass,
} from './phase34-rights-connectors.mjs';

export const ELIGIBILITY_DECISIONS = Object.freeze([
  'INCLUDED',
  'EXCLUDED_WRONG_PRESSING',
  'EXCLUDED_RELEASE_ONLY',
  'EXCLUDED_DUPLICATE',
  'EXCLUDED_STALE',
  'EXCLUDED_DELETED',
  'EXCLUDED_RIGHTS',
  'EXCLUDED_ASKING_NOT_SOLD',
  'EXCLUDED_UNSETTLED',
  'EXCLUDED_REFUNDED',
  'EXCLUDED_CURRENCY',
  'EXCLUDED_CONDITION',
  'EXCLUDED_GEOGRAPHY',
  'EXCLUDED_OUTLIER',
  'EXCLUDED_UNRESOLVED',
]);

export const ELIGIBILITY_VERSION = 'phase34-eligibility-v1';

function isSoldEventType(type) {
  const t = String(type || '').toUpperCase();
  return t === 'SALE_COMPLETED' || t === 'AUCTION_PAYMENT_SETTLED';
}

function isAskingType(type) {
  const t = String(type || '').toUpperCase();
  return t === 'LISTING_CREATED' || t === 'LISTING_PRICE_CHANGED' || t === 'ASKING_LISTING';
}

/**
 * Decide eligibility for one candidate event relative to a resolved subject.
 */
export function decideEligibility(event = {}, context = {}) {
  const {
    resolution = null,
    requireExactPressing = false,
    seenContentHashes = new Set(),
    maxAgeDays = 365,
    now = Date.now(),
  } = context;

  if (event.deletion_status === 'DELETED' || event.event_status === 'DELETED') {
    return { decision: 'EXCLUDED_DELETED', reason_detail: 'deleted' };
  }

  if (
    event.refunded === true ||
    event.reversed === true ||
    event.chargeback === true ||
    String(event.event_type || '').toUpperCase() === 'SALE_REFUNDED' ||
    String(event.event_type || '').toUpperCase() === 'SALE_REVERSED' ||
    String(event.eligibility_state || '').toUpperCase() === 'REFUNDED'
  ) {
    return { decision: 'EXCLUDED_REFUNDED', reason_detail: 'refunded_or_reversed_policy' };
  }

  const rightsGate = evaluateRightsEligibility(event, context.rightsOptions || {});
  if (!rightsGate.ok) {
    return {
      decision: rightsGate.exclusion_decision || 'EXCLUDED_RIGHTS',
      reason_detail: rightsGate.reason_detail,
    };
  }

  // A3: unsettled — sold_at-only, archive, seed COMPLETED_SALE, missing settlement.
  if (
    event.synthetic === true ||
    event.from_seed === true ||
    event.force_floor === true ||
    event.source_class === 'SEED' ||
    String(event.event_type || '').toUpperCase() === 'COMPLETED_SALE'
  ) {
    return { decision: 'EXCLUDED_UNSETTLED', reason_detail: 'synthetic_or_seed_not_settlement' };
  }

  if (isSoldEventType(event.event_type)) {
    if (event.source_class && event.source_class !== 'FIRST_PARTY_SETTLEMENT') {
      return { decision: 'EXCLUDED_UNSETTLED', reason_detail: 'sold_without_settlement_class' };
    }
    if (event.settlement_evidence_eligible === false) {
      return { decision: 'EXCLUDED_UNSETTLED', reason_detail: 'lifecycle_sold_without_event' };
    }
    if (event.from_sold_at_only === true) {
      return { decision: 'EXCLUDED_UNSETTLED', reason_detail: 'sold_at_alone' };
    }
  }

  if (context.treatAsSold === true && isAskingType(event.event_type)) {
    return { decision: 'EXCLUDED_ASKING_NOT_SOLD', reason_detail: 'asking_used_as_sold' };
  }

  if (event.payload_hash && seenContentHashes.has(event.payload_hash)) {
    return { decision: 'EXCLUDED_DUPLICATE', reason_detail: 'payload_hash' };
  }
  if (event.market_event_id && seenContentHashes.has(`id:${event.market_event_id}`)) {
    return { decision: 'EXCLUDED_DUPLICATE', reason_detail: 'market_event_id' };
  }

  if (event.occurred_at || event.sold_at || event.observed_at) {
    const ts = Date.parse(event.occurred_at || event.sold_at || event.observed_at);
    if (Number.isFinite(ts)) {
      const ageDays = (now - ts) / (1000 * 60 * 60 * 24);
      if (ageDays > maxAgeDays) {
        return { decision: 'EXCLUDED_STALE', reason_detail: `age_days=${Math.round(ageDays)}` };
      }
    }
  }

  if (requireExactPressing || resolution?.resolution_status === 'MATCHED_EXACT_PRESSING') {
    const match = event.pressing_match || event.pressing_match_confidence;
    if (match === 'RELEASE_LEVEL_MATCH' || match === 'RELEASE_LEVEL_ONLY') {
      return { decision: 'EXCLUDED_RELEASE_ONLY', reason_detail: 'release_not_exact' };
    }
    if (
      resolution?.resolved_pressing_id &&
      event.pressing_id &&
      event.pressing_id !== resolution.resolved_pressing_id
    ) {
      return { decision: 'EXCLUDED_WRONG_PRESSING', reason_detail: 'pressing_mismatch' };
    }
  }

  if (resolution?.resolution_status === 'UNRESOLVED' && requireExactPressing) {
    return { decision: 'EXCLUDED_UNRESOLVED', reason_detail: 'subject_unresolved' };
  }

  if (event.currency_conversion_failure === true) {
    return { decision: 'EXCLUDED_CURRENCY', reason_detail: 'conversion_failed' };
  }

  // Phase G: every INCLUDED event must carry a rights class.
  try {
    assertIncludedEventHasRightsClass(event);
  } catch (err) {
    return {
      decision: 'EXCLUDED_RIGHTS',
      reason_detail: err.code || err.message || 'missing_rights_class',
    };
  }

  return { decision: 'INCLUDED', reason_detail: null };
}

/**
 * Evaluate a candidate list; returns included, exclusions, and decisions[].
 */
export function evaluateEligibility(events = [], context = {}) {
  const seen = new Set(context.seenContentHashes || []);
  const decisions = [];
  const included = [];
  const exclusions = [];

  for (const event of events) {
    const result = decideEligibility(event, { ...context, seenContentHashes: seen });
    const row = {
      market_event_id: event.market_event_id || null,
      evidence_id: event.evidence_id || event.market_event_id || null,
      decision: result.decision,
      reason_detail: result.reason_detail,
      eligibility_version: ELIGIBILITY_VERSION,
      event,
    };
    decisions.push(row);
    if (result.decision === 'INCLUDED') {
      included.push(event);
      if (event.payload_hash) seen.add(event.payload_hash);
      if (event.market_event_id) seen.add(`id:${event.market_event_id}`);
    } else {
      exclusions.push(row);
    }
  }

  return {
    included,
    exclusions,
    decisions,
    eligibility_version: ELIGIBILITY_VERSION,
  };
}
