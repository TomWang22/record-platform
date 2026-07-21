/**
 * Phase 34 Phase A — SALE_COMPLETED emitter.
 *
 * Only settlement-grade sources may emit SALE_COMPLETED:
 * CHECKOUT_SETTLEMENT | AUCTION_PAYMENT_SETTLEMENT | OFFER_PAYMENT_SETTLEMENT
 *
 * Owner-proof seed COMPLETED_SALE is a different event type and must never
 * be re-labeled as SALE_COMPLETED.
 */
import crypto from 'node:crypto';
import { LISTING_LIFECYCLE, assertNeverSoldFromArchive } from './phase34-listing-lifecycle.mjs';
import { normalizeMarketEvent } from './phase34-market-event-normalization.mjs';

export const SALE_COMPLETED_EVENT_TYPE = 'SALE_COMPLETED';

export const SETTLEMENT_SOURCES = Object.freeze({
  CHECKOUT_SETTLEMENT: 'CHECKOUT_SETTLEMENT',
  AUCTION_PAYMENT_SETTLEMENT: 'AUCTION_PAYMENT_SETTLEMENT',
  OFFER_PAYMENT_SETTLEMENT: 'OFFER_PAYMENT_SETTLEMENT',
});

export const SALE_COMPLETED_REQUIRED_FIELDS = Object.freeze([
  'sale_event_id',
  'listing_id',
  'completed_at',
  'final_price',
  'currency',
  'sale_mechanism',
  'source',
  'authorization_scope',
  'provenance',
]);

function requireSettlementSource(source) {
  const s = String(source || '');
  if (!Object.values(SETTLEMENT_SOURCES).includes(s)) {
    const err = new Error(`SALE_COMPLETED_INVALID_SOURCE:${s || 'missing'}`);
    err.code = 'SALE_COMPLETED_INVALID_SOURCE';
    throw err;
  }
  return s;
}

/**
 * Build a SALE_COMPLETED market event from settlement facts.
 * Throws if listing lifecycle is archival without settlement, or source is not settlement-grade.
 */
export function buildSaleCompletedEvent(input = {}) {
  const source = requireSettlementSource(input.source || input.sale_mechanism_source);
  // Prior listing status must not be archival; settlement facts alone create SOLD.
  assertNeverSoldFromArchive(input.listing_status || input.lifecycle || LISTING_LIFECYCLE.ACTIVE, {
    soldAt: input.completed_at || input.sold_at || null,
    allowEndedWithoutSettlement: Boolean(input.completed_at || input.sold_at),
  });

  const listingId = String(input.listing_id || input.source_listing_id || '').trim();
  const saleEventId = String(
    input.sale_event_id ||
      input.market_event_id ||
      `sale-${listingId || 'unknown'}-${crypto.randomBytes(6).toString('hex')}`,
  );
  const completedAt = input.completed_at || input.sold_at || new Date().toISOString();
  const price = Number(input.final_price ?? input.price_normalized ?? input.price);
  const currency = String(input.currency || input.currency_normalized || 'USD').toUpperCase();

  if (!listingId) {
    const err = new Error('SALE_COMPLETED_MISSING_LISTING_ID');
    err.code = 'SALE_COMPLETED_MISSING_LISTING_ID';
    throw err;
  }
  if (!Number.isFinite(price) || price <= 0) {
    const err = new Error('SALE_COMPLETED_INVALID_PRICE');
    err.code = 'SALE_COMPLETED_INVALID_PRICE';
    throw err;
  }

  const raw = {
    market_event_id: `me-${saleEventId}`,
    source_id: source,
    source_event_id: saleEventId,
    source_listing_id: listingId,
    listing_id: listingId,
    observed_at: completedAt,
    sold_at: completedAt,
    event_type: SALE_COMPLETED_EVENT_TYPE,
    event_status: 'COMPLETED',
    artist: input.artist || null,
    title: input.title || null,
    catalog_number: input.catalog_number || null,
    label: input.label || null,
    release_id: input.release_id || null,
    pressing_id: input.pressing_id || null,
    media_condition: input.media_condition || input.condition || null,
    sleeve_condition: input.sleeve_condition || null,
    currency_original: currency,
    price_original: price,
    currency_normalized: currency,
    price_normalized: price,
    sale_type: input.sale_mechanism || input.sale_type || 'buy_now',
    authorization_scope: input.authorization_scope || 'first_party_settlement',
    rights_status: input.rights_status || 'FIRST_PARTY',
    deletion_status: input.deletion_status || 'ACTIVE',
    identity_resolution_status: input.identity_resolution_status || 'UNKNOWN',
    pressing_match_confidence: input.pressing_match_confidence ?? null,
    provenance: {
      settlement_source: source,
      order_id: input.order_id || null,
      purchase_id: input.purchase_id || null,
      payment_transaction_id: input.payment_transaction_id || null,
      listing_lifecycle_after: LISTING_LIFECYCLE.SOLD,
    },
    lifecycle_after: LISTING_LIFECYCLE.SOLD,
  };

  const normalized = normalizeMarketEvent(raw);
  // Guard: seed COMPLETED_SALE type must never emerge from this emitter.
  if (String(normalized.event_type) === 'COMPLETED_SALE') {
    const err = new Error('SALE_COMPLETED_COLLAPSED_TO_SEED_TYPE');
    err.code = 'SALE_COMPLETED_COLLAPSED_TO_SEED_TYPE';
    throw err;
  }
  normalized.event_type = SALE_COMPLETED_EVENT_TYPE;
  normalized.sale_event_id = saleEventId;
  normalized.sale_mechanism = raw.sale_type;
  normalized.provenance = raw.provenance;
  normalized.settlement_source = source;
  normalized.listing_id = listingId;
  normalized.source_listing_id = listingId;
  return normalized;
}

/**
 * True only for settlement-grade SALE_COMPLETED events.
 * Seed COMPLETED_SALE returns false.
 */
export function isSettlementSaleCompleted(event) {
  if (!event || typeof event !== 'object') return false;
  if (String(event.event_type || '').toUpperCase() !== SALE_COMPLETED_EVENT_TYPE) return false;
  try {
    requireSettlementSource(event.settlement_source || event.source_id || event.provenance?.settlement_source);
    return true;
  } catch {
    return false;
  }
}
