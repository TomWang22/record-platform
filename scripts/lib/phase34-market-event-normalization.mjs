/**
 * Phase 34 market-event normalization — canonical events, hard distinctions,
 * exclusion helpers, and evidence-item projection.
 */
import crypto from 'node:crypto';

export const NORMALIZATION_VERSION = 'phase34-market-event-v1';

export const EVENT_TYPES = Object.freeze([
  'ASKING_LISTING',
  'COMPLETED_SALE',
  /** Settlement-grade sold event (Phase A). Distinct from seed COMPLETED_SALE. */
  'SALE_COMPLETED',
  'AUCTION_STARTED',
  'AUCTION_BID',
  'AUCTION_COMPLETED',
  'OFFER_CREATED',
  'OFFER_ACCEPTED',
  'OFFER_REJECTED',
  'WATCHLIST_ADDED',
  'WATCHLIST_REMOVED',
  'COLLECTION_ADDED',
  'COLLECTION_UPDATED',
  'LISTING_DELETED',
  'SALE_CORRECTED',
  'SOURCE_EXPIRED',
]);

/** Required exclusion reason codes (fail-closed evidence policy). */
export const REQUIRED_EXCLUSIONS = Object.freeze([
  'deleted',
  'expired',
  'unauthorized',
  'cross-user',
  'cross-thread',
  'wrong pressing',
  'wrong currency without conversion',
  'asking used as sold',
  'active used as completed',
  'unknown accepted-offer price',
  'duplicate event',
  'stale beyond policy',
  'source rights unavailable',
]);

const CANONICAL_FIELDS = Object.freeze([
  'market_event_id',
  'source_id',
  'source_event_id',
  'source_url',
  'source_timestamp',
  'ingested_at',
  'observed_at',
  'event_type',
  'event_status',
  'artist',
  'title',
  'release_id',
  'master_release_id',
  'pressing_id',
  'catalog_number',
  'barcode',
  'label',
  'country',
  'release_year',
  'format',
  'speed',
  'size',
  'vinyl_color',
  'edition',
  'matrix_runout',
  'media_condition',
  'sleeve_condition',
  'condition_notes',
  'currency_original',
  'price_original',
  'currency_normalized',
  'price_normalized',
  'shipping_price',
  'buyer_premium',
  'tax',
  'total_price',
  'quantity',
  'bid_count',
  'watcher_count',
  'offer_count',
  'sale_type',
  'seller_country',
  'buyer_country',
  'listing_started_at',
  'listing_ended_at',
  'sold_at',
  'evidence_quality',
  'pressing_match_confidence',
  'identity_resolution_status',
  'authorization_scope',
  'privacy_class',
  'deletion_status',
  'staleness_status',
  'rights_status',
  'normalization_version',
]);

/** Fixture FX table — never invent rates. */
export const FX_TO_USD = Object.freeze({
  USD: 1,
  EUR: 1.1,
  GBP: 1.25,
  JPY: 0.0067,
});

const ASKING_TYPES = new Set(['ASKING_LISTING', 'AUCTION_STARTED', 'AUCTION_BID', 'OFFER_CREATED']);
const COMPLETED_SALE_TYPES = new Set(['COMPLETED_SALE', 'SALE_COMPLETED', 'AUCTION_COMPLETED']);
const ACTIVE_TYPES = new Set(['ASKING_LISTING', 'AUCTION_STARTED', 'AUCTION_BID', 'OFFER_CREATED']);

function nullish(value) {
  return value === undefined ? null : value;
}

function asNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asIntOrNull(value) {
  const n = asNumberOrNull(value);
  return n === null ? null : Math.trunc(n);
}

function asStringOrNull(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function normalizeCondition(raw) {
  if (raw === null || raw === undefined || raw === '') {
    return { value: null, ok: true };
  }
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, '');
  const map = {
    M: 'M',
    MINT: 'M',
    NM: 'NM',
    'NEARMINT': 'NM',
    'VG+': 'VG+',
    VGPLUS: 'VG+',
    VG: 'VG',
    'G+': 'G+',
    GPLUS: 'G+',
    G: 'G',
    F: 'F',
    P: 'P',
  };
  if (map[s] || map[String(raw).trim().toUpperCase()]) {
    return { value: map[s] || map[String(raw).trim().toUpperCase()], ok: true };
  }
  // Preserve raw when unknown — do not invent grades.
  return { value: String(raw).trim(), ok: false };
}

/**
 * Convert amount to target currency using explicit FX table only.
 * Never invents rates or silently drops mismatches.
 */
export function convertCurrency(amount, fromCurrency, toCurrency = 'USD') {
  const from = String(fromCurrency || '').toUpperCase();
  const to = String(toCurrency || '').toUpperCase();
  if (!Number.isFinite(amount)) {
    return { ok: false, amount: null, reason: 'INVALID_AMOUNT' };
  }
  if (!from || !to) {
    return { ok: false, amount: null, reason: 'MISSING_CURRENCY' };
  }
  if (!FX_TO_USD[from] || !FX_TO_USD[to]) {
    return { ok: false, amount: null, reason: 'UNSUPPORTED_CURRENCY' };
  }
  if (from === to) return { ok: true, amount, converted: false };
  const usd = amount * FX_TO_USD[from];
  return { ok: true, amount: usd / FX_TO_USD[to], converted: true, via: 'USD' };
}

function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function computeContentHash(canonicalWithoutHash) {
  return crypto.createHash('sha256').update(stableStringify(canonicalWithoutHash)).digest('hex');
}

function inferEventType(input) {
  if (input.event_type && EVENT_TYPES.includes(input.event_type)) return input.event_type;
  const listedAs = String(input.listed_as || input.sale_kind || input.source_type || '').toLowerCase();
  // Infer seed-style COMPLETED_SALE only when not explicitly settlement-graded.
  if (String(input.event_type || '').toUpperCase() === 'SALE_COMPLETED') return 'SALE_COMPLETED';
  if (
    String(input.settlement_source || '').length > 0 ||
    String(input.authorization_scope || '') === 'first_party_settlement'
  ) {
    if (listedAs === 'sold' || listedAs === 'sale' || listedAs === 'completed_sale') {
      return 'SALE_COMPLETED';
    }
  }
  if (listedAs === 'sold' || listedAs === 'sale' || listedAs === 'completed_sale') return 'COMPLETED_SALE';
  if (listedAs === 'asking' || listedAs === 'listing' || listedAs === 'active') return 'ASKING_LISTING';
  if (listedAs === 'auction') {
    if (String(input.status || '').toLowerCase() === 'completed') return 'AUCTION_COMPLETED';
    return 'AUCTION_STARTED';
  }
  return input.event_type || 'ASKING_LISTING';
}

function inferEventStatus(input, eventType) {
  if (input.event_status) return String(input.event_status).toUpperCase();
  if (input.deletion_status === 'DELETED' || eventType === 'LISTING_DELETED') return 'DELETED';
  if (eventType === 'SOURCE_EXPIRED') return 'EXPIRED';
  if (COMPLETED_SALE_TYPES.has(eventType) || eventType === 'OFFER_ACCEPTED' || eventType === 'OFFER_REJECTED') {
    return 'COMPLETED';
  }
  if (ACTIVE_TYPES.has(eventType)) return 'ACTIVE';
  return 'UNKNOWN';
}

/**
 * Normalize a raw market event into the canonical Phase 34 shape.
 * Hard rules:
 * - ASKING_LISTING != COMPLETED_SALE (never treat asking as sold)
 * - never treat active as completed
 * - ACCEPTED_BEST_OFFER_WITH_UNKNOWN_PRICE must not invent price
 * - RELEASE_LEVEL_MATCH != EXACT_PRESSING_MATCH
 */
export function normalizeMarketEvent(input = {}) {
  const warnings = [];
  let event_type = inferEventType(input);
  let event_status = inferEventStatus(input, event_type);

  // Hard: never treat asking as sold even if listed_as says sold.
  const askingPresentedAsSold =
    input.asking_presented_as_sold === true ||
    (ASKING_TYPES.has(event_type) === false &&
      String(input.source_type || '').toLowerCase() === 'asking' &&
      String(input.listed_as || '').toLowerCase() === 'sold') ||
    (String(input.source_type || '').toLowerCase() === 'asking' &&
      (event_type === 'COMPLETED_SALE' || String(input.listed_as || '').toLowerCase() === 'sold'));

  if (askingPresentedAsSold || (String(input.source_type || '').toLowerCase() === 'asking' && event_type === 'COMPLETED_SALE')) {
    event_type = 'ASKING_LISTING';
    event_status = 'ACTIVE';
    warnings.push('asking used as sold');
  }

  // If caller forced ASKING with COMPLETED status, demote status.
  if (event_type === 'ASKING_LISTING' && event_status === 'COMPLETED') {
    event_status = 'ACTIVE';
    warnings.push('active used as completed');
  }

  // Never treat active auction/listing as completed sale.
  if (ACTIVE_TYPES.has(event_type) && event_status === 'COMPLETED' && !COMPLETED_SALE_TYPES.has(event_type)) {
    event_status = 'ACTIVE';
    warnings.push('active used as completed');
  }

  let sale_type = asStringOrNull(input.sale_type);
  if (
    sale_type === 'ACCEPTED_BEST_OFFER_WITH_UNKNOWN_PRICE' ||
    input.accepted_offer_price_unknown === true
  ) {
    sale_type = 'ACCEPTED_BEST_OFFER_WITH_UNKNOWN_PRICE';
  }

  const currency_original = asStringOrNull(input.currency_original || input.currency)?.toUpperCase() ?? null;
  let price_original = asNumberOrNull(input.price_original ?? input.price);

  // Hard: do not invent price for unknown accepted-offer.
  if (sale_type === 'ACCEPTED_BEST_OFFER_WITH_UNKNOWN_PRICE') {
    if (input.invent_price === true || (price_original !== null && input.price_is_invented === true)) {
      warnings.push('unknown accepted-offer price');
    }
    price_original = null;
  }

  const targetCurrency = (
    asStringOrNull(input.currency_normalized) ||
    asStringOrNull(input.target_currency) ||
    'USD'
  ).toUpperCase();

  let currency_normalized = null;
  let price_normalized = null;
  let currency_conversion_failure = false;

  if (price_original !== null && currency_original) {
    const conv = convertCurrency(price_original, currency_original, targetCurrency);
    if (conv.ok) {
      currency_normalized = targetCurrency;
      price_normalized = Math.round(conv.amount * 100) / 100;
    } else {
      currency_conversion_failure = true;
      currency_normalized = null;
      price_normalized = null;
      warnings.push('wrong currency without conversion');
    }
  } else if (price_original !== null && !currency_original) {
    currency_conversion_failure = true;
    warnings.push('wrong currency without conversion');
  }

  let pressing_match_confidence = asStringOrNull(input.pressing_match_confidence);
  // Hard: RELEASE_LEVEL_MATCH != EXACT_PRESSING_MATCH
  if (pressing_match_confidence === 'EXACT_PRESSING_MATCH' && input.release_level_only === true) {
    pressing_match_confidence = 'RELEASE_LEVEL_MATCH';
    warnings.push('release_level_forced');
  }
  if (
    pressing_match_confidence === 'RELEASE_LEVEL_MATCH' &&
    input.claim_exact_pressing === true
  ) {
    // Do not upgrade release-level to exact.
    pressing_match_confidence = 'RELEASE_LEVEL_MATCH';
    warnings.push('exact_pressing_claim_blocked');
  }

  const media = normalizeCondition(input.media_condition ?? input.condition);
  const sleeve = normalizeCondition(input.sleeve_condition);
  if (!media.ok) warnings.push('condition_normalization_failure');
  if (input.sleeve_condition != null && !sleeve.ok) warnings.push('condition_normalization_failure');

  const market_event_id =
    asStringOrNull(input.market_event_id) ||
    `me-${asStringOrNull(input.source_id) || 'src'}-${asStringOrNull(input.source_event_id) || 'evt'}`;

  const base = {
    market_event_id,
    source_id: asStringOrNull(input.source_id) || 'unknown',
    source_event_id: asStringOrNull(input.source_event_id) || market_event_id,
    source_url: asStringOrNull(input.source_url),
    source_timestamp: asStringOrNull(input.source_timestamp || input.source_event_time),
    ingested_at: asStringOrNull(input.ingested_at),
    observed_at: asStringOrNull(input.observed_at || input.source_timestamp || input.source_event_time),
    event_type,
    event_status,
    artist: asStringOrNull(input.artist),
    title: asStringOrNull(input.title),
    release_id: asStringOrNull(input.release_id),
    master_release_id: asStringOrNull(input.master_release_id),
    pressing_id: asStringOrNull(input.pressing_id),
    catalog_number: asStringOrNull(input.catalog_number),
    barcode: asStringOrNull(input.barcode),
    label: asStringOrNull(input.label),
    country: asStringOrNull(input.country),
    release_year: asIntOrNull(input.release_year ?? input.year),
    format: asStringOrNull(input.format),
    speed: asStringOrNull(input.speed),
    size: asStringOrNull(input.size),
    vinyl_color: asStringOrNull(input.vinyl_color),
    edition: asStringOrNull(input.edition),
    matrix_runout: asStringOrNull(input.matrix_runout || input.matrix),
    media_condition: media.value,
    sleeve_condition: sleeve.value,
    condition_notes: asStringOrNull(input.condition_notes),
    currency_original,
    price_original,
    currency_normalized,
    price_normalized,
    shipping_price: asNumberOrNull(input.shipping_price),
    buyer_premium: asNumberOrNull(input.buyer_premium),
    tax: asNumberOrNull(input.tax),
    total_price: asNumberOrNull(input.total_price),
    quantity: asIntOrNull(input.quantity),
    bid_count: asIntOrNull(input.bid_count),
    watcher_count: asIntOrNull(input.watcher_count),
    offer_count: asIntOrNull(input.offer_count),
    sale_type,
    seller_country: asStringOrNull(input.seller_country),
    buyer_country: asStringOrNull(input.buyer_country),
    listing_started_at: asStringOrNull(input.listing_started_at),
    listing_ended_at: asStringOrNull(input.listing_ended_at || input.ended_at),
    sold_at: event_type === 'ASKING_LISTING' ? null : asStringOrNull(input.sold_at),
    evidence_quality: asStringOrNull(input.evidence_quality) || 'UNKNOWN',
    pressing_match_confidence,
    identity_resolution_status: asStringOrNull(input.identity_resolution_status),
    authorization_scope: asStringOrNull(input.authorization_scope),
    privacy_class: asStringOrNull(input.privacy_class),
    deletion_status: asStringOrNull(input.deletion_status) || 'ACTIVE',
    staleness_status: asStringOrNull(input.staleness_status) || 'UNKNOWN',
    rights_status: asStringOrNull(input.rights_status) || 'UNKNOWN',
    normalization_version: NORMALIZATION_VERSION,
  };

  // Ensure only canonical fields for hash.
  const forHash = {};
  for (const key of CANONICAL_FIELDS) {
    forHash[key] = nullish(base[key]);
  }
  const content_hash = computeContentHash(forHash);

  return {
    ...forHash,
    content_hash,
    _meta: {
      warnings,
      currency_conversion_failure,
      asking_as_sold_blocked: warnings.includes('asking used as sold'),
      active_as_completed_blocked: warnings.includes('active used as completed'),
    },
  };
}

/**
 * Evaluate exclusion reasons for an event. Returns included=false when any
 * required exclusion applies.
 */
export function collectExclusionReasons(event = {}, context = {}) {
  const reasons = [];

  if (event.deletion_status === 'DELETED' || event.event_status === 'DELETED' || event.event_type === 'LISTING_DELETED') {
    reasons.push('deleted');
  }
  if (event.event_type === 'SOURCE_EXPIRED' || event.event_status === 'EXPIRED' || event.expiry_status === 'EXPIRED') {
    reasons.push('expired');
  }
  if (
    event.privacy_class === 'PROHIBITED' ||
    (event.authorization_scope &&
      Array.isArray(context.authorized_scopes) &&
      !context.authorized_scopes.includes(event.authorization_scope))
  ) {
    reasons.push('unauthorized');
  }
  if (context.principal_id && event.owner_principal_id && event.owner_principal_id !== context.principal_id) {
    reasons.push('cross-user');
  }
  if (context.thread_id && event.thread_id && event.thread_id !== context.thread_id) {
    reasons.push('cross-thread');
  }
  if (
    context.subject_pressing_id &&
    event.pressing_id &&
    event.pressing_id !== context.subject_pressing_id
  ) {
    reasons.push('wrong pressing');
  }
  if (
    event._meta?.currency_conversion_failure ||
    (event.price_original != null &&
      event.currency_original &&
      event.price_normalized == null &&
      event.currency_normalized == null)
  ) {
    reasons.push('wrong currency without conversion');
  }
  if (
    event._meta?.asking_as_sold_blocked ||
    event.asking_presented_as_sold === true ||
    (event.event_type === 'ASKING_LISTING' && event.sold_at && event.treated_as_sold === true)
  ) {
    reasons.push('asking used as sold');
  }
  if (
    event._meta?.active_as_completed_blocked ||
    (event.event_status === 'ACTIVE' && event.treated_as_completed === true)
  ) {
    reasons.push('active used as completed');
  }
  if (
    event.sale_type === 'ACCEPTED_BEST_OFFER_WITH_UNKNOWN_PRICE' &&
    (event.price_original != null || event.price_normalized != null || event.invent_price === true)
  ) {
    reasons.push('unknown accepted-offer price');
  }
  if (context.seen_content_hashes instanceof Set && event.content_hash && context.seen_content_hashes.has(event.content_hash)) {
    reasons.push('duplicate event');
  }
  if (context.seen_source_event_ids instanceof Set) {
    const key = `${event.source_id}|${event.source_event_id}`;
    if (context.seen_source_event_ids.has(key)) reasons.push('duplicate event');
  }
  if (event.staleness_status === 'STALE' && context.allow_stale !== true) {
    reasons.push('stale beyond policy');
  }
  if (event.rights_status === 'UNAVAILABLE') {
    reasons.push('source rights unavailable');
  }

  return [...new Set(reasons)];
}

/**
 * Exclude an event with one or more reasons. Merges auto-detected reasons with
 * explicit `reasons`. Always uses REQUIRED_EXCLUSIONS vocabulary when possible.
 */
export function excludeEvent(event = {}, reasons = [], context = {}) {
  const auto = collectExclusionReasons(event, context);
  const merged = [...new Set([...auto, ...reasons].map(String))];
  const included = merged.length === 0;
  return {
    included,
    excluded_reason: included ? null : merged.join('; '),
    excluded_reasons: merged,
    event,
  };
}

/**
 * Validate hard distinctions across a set of (possibly normalized) events.
 * Throws on any violation.
 */
export function validateHardDistinctions(events = []) {
  const violations = [];

  for (const raw of events) {
    const e = raw?.content_hash ? raw : normalizeMarketEvent(raw);

    if (e.event_type === 'ASKING_LISTING' && (e.sold_at || e.treated_as_sold === true)) {
      if (e.treated_as_sold === true || raw?.asking_presented_as_sold === true) {
        violations.push({
          code: 'ASKING_AS_SOLD',
          market_event_id: e.market_event_id,
          message: 'ASKING_LISTING must not be treated as COMPLETED_SALE',
        });
      }
    }

    if (e.event_type === 'ASKING_LISTING' && e.event_status === 'COMPLETED') {
      violations.push({
        code: 'ASKING_AS_SOLD',
        market_event_id: e.market_event_id,
        message: 'ASKING_LISTING status must not be COMPLETED',
      });
    }

    if (
      String(raw?.source_type || '').toLowerCase() === 'asking' &&
      (raw?.event_type === 'COMPLETED_SALE' || String(raw?.listed_as || '').toLowerCase() === 'sold') &&
      raw?.force_asking_as_sold === true
    ) {
      violations.push({
        code: 'ASKING_AS_SOLD',
        market_event_id: e.market_event_id,
        message: 'asking must not be forced as sold',
      });
    }

    if (e.event_status === 'ACTIVE' && e.treated_as_completed === true) {
      violations.push({
        code: 'ACTIVE_AS_COMPLETED',
        market_event_id: e.market_event_id,
        message: 'ACTIVE must not be treated as COMPLETED',
      });
    }

    if (
      e.sale_type === 'ACCEPTED_BEST_OFFER_WITH_UNKNOWN_PRICE' &&
      (e.price_original != null || e.price_normalized != null)
    ) {
      violations.push({
        code: 'UNKNOWN_OFFER_PRICE_INVENTED',
        market_event_id: e.market_event_id,
        message: 'ACCEPTED_BEST_OFFER_WITH_UNKNOWN_PRICE must not invent price',
      });
    }

    if (
      e.pressing_match_confidence === 'EXACT_PRESSING_MATCH' &&
      (e.identity_resolution_status === 'RELEASE_LEVEL_ONLY' || raw?.release_level_only === true)
    ) {
      violations.push({
        code: 'RELEASE_LEVEL_AS_EXACT',
        market_event_id: e.market_event_id,
        message: 'RELEASE_LEVEL_MATCH must not equal EXACT_PRESSING_MATCH',
      });
    }

    if (
      e.pressing_match_confidence === 'RELEASE_LEVEL_MATCH' &&
      raw?.claim_exact_pressing === true &&
      raw?.force_exact_from_release_level === true
    ) {
      violations.push({
        code: 'RELEASE_LEVEL_AS_EXACT',
        market_event_id: e.market_event_id,
        message: 'RELEASE_LEVEL_MATCH must not be upgraded to EXACT_PRESSING_MATCH',
      });
    }
  }

  if (violations.length) {
    const err = new Error(
      `HARD_DISTINCTION_VIOLATIONS:${violations.map((v) => v.code).join(',')}`,
    );
    err.code = 'HARD_DISTINCTION_VIOLATIONS';
    err.violations = violations;
    throw err;
  }

  return true;
}

/**
 * Project a normalized market event into an evidence item for snapshots.
 */
export function buildEvidenceItem(event = {}, options = {}) {
  const normalized = event.content_hash ? event : normalizeMarketEvent(event);
  const exclusion = excludeEvent(normalized, options.reasons || [], options.context || {});
  const evidence_id =
    options.evidence_id ||
    `ev-${normalized.content_hash.slice(0, 16)}` ||
    normalized.market_event_id;

  return {
    evidence_id,
    source_id: normalized.source_id,
    rights_status: normalized.rights_status,
    source_event_id: normalized.source_event_id,
    source_url: normalized.source_url,
    source_timestamp: normalized.source_timestamp,
    ingested_at: normalized.ingested_at,
    freshness: normalized.staleness_status === 'STALE' ? 'stale' : 'fresh',
    content_hash: normalized.content_hash,
    identity_status: normalized.identity_resolution_status,
    pressing_confidence: normalized.pressing_match_confidence,
    authorization_scope: normalized.authorization_scope,
    included: exclusion.included,
    excluded_reason: exclusion.excluded_reason,
  };
}

export function stripMeta(event) {
  if (!event || typeof event !== 'object') return event;
  const { _meta, ...rest } = event;
  return rest;
}
