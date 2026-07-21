/**
 * Phase B — raw observation + canonical market event builders.
 */
import crypto from 'node:crypto';

export const SOURCE_CLASSES = Object.freeze([
  'FIRST_PARTY_SETTLEMENT',
  'FIRST_PARTY_LISTING',
  'FIRST_PARTY_OFFER',
  'FIRST_PARTY_AUCTION',
  'FIRST_PARTY_BID_EVENT',
  'FIRST_PARTY_WATCHLIST',
  'FIRST_PARTY_COLLECTION',
  'FIRST_PARTY_PREFERENCE',
  'FIRST_PARTY_AUTHORIZED_MESSAGE',
  'PERMITTED_PUBLIC_CATALOG',
  'LICENSED_EXTERNAL_ARCHIVE',
]);

export const CANONICAL_EVENT_TYPES = Object.freeze([
  'LISTING_CREATED',
  'LISTING_PRICE_CHANGED',
  'LISTING_ENDED',
  'SALE_COMPLETED',
  'SALE_REFUNDED',
  'OFFER_CREATED',
  'OFFER_COUNTERED',
  'OFFER_ACCEPTED',
  'OFFER_DECLINED',
  'AUCTION_CREATED',
  'BID_PLACED',
  'AUCTION_ENDED_UNSOLD',
  'AUCTION_WON',
  'AUCTION_PAYMENT_SETTLED',
  'WATCHLIST_ADDED',
  'WATCHLIST_REMOVED',
  'RECORD_METADATA_UPDATED',
  'PREFERENCE_SET',
  'PREFERENCE_FORGOTTEN',
  'MESSAGE_AUTHORIZED',
  'SOURCE_DELETED',
  'SALE_REVERSED',
  'PAYMENT_CHARGEBACK',
  'AUCTION_NON_PAYMENT',
  'SALE_CORRECTION_RECORDED',
]);

function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function payloadHash(obj) {
  return crypto.createHash('sha256').update(stableStringify(obj)).digest('hex');
}

export function buildRawObservation(input = {}) {
  const sourceClass = String(input.source_class || '');
  if (!SOURCE_CLASSES.includes(sourceClass)) {
    const err = new Error(`RAW_OBSERVATION_INVALID_SOURCE_CLASS:${sourceClass}`);
    err.code = 'RAW_OBSERVATION_INVALID_SOURCE_CLASS';
    throw err;
  }
  const raw_payload = input.raw_payload ?? input.payload ?? {};
  const canonical_payload_hash = input.canonical_payload_hash || payloadHash(raw_payload);
  const observation_id =
    input.observation_id ||
    `obs-${payloadHash({
      sourceClass,
      source_record_id: input.source_record_id,
      source_event_type: input.source_event_type,
      canonical_payload_hash,
    }).slice(0, 24)}`;

  return Object.freeze({
    observation_id,
    source_class: sourceClass,
    source_connector: String(input.source_connector || 'unknown'),
    source_record_id: String(input.source_record_id || ''),
    source_event_type: String(input.source_event_type || ''),
    observed_at: input.observed_at || new Date().toISOString(),
    effective_at: input.effective_at || null,
    ingested_at: input.ingested_at || new Date().toISOString(),
    raw_payload,
    canonical_payload_hash,
    authorization_scope: input.authorization_scope || 'unknown',
    rights_classification: input.rights_classification || 'UNKNOWN',
    retention_status: input.retention_status || 'ACTIVE',
    deletion_status: input.deletion_status || 'ACTIVE',
    connector_version: input.connector_version || null,
    trace_id: input.trace_id || null,
    correlation_id: input.correlation_id || null,
  });
}

export function buildCanonicalMarketEvent(observation, input = {}) {
  if (!observation?.observation_id) {
    const err = new Error('MARKET_EVENT_REQUIRES_OBSERVATION');
    err.code = 'MARKET_EVENT_REQUIRES_OBSERVATION';
    throw err;
  }
  const event_type = String(input.event_type || '');
  if (!CANONICAL_EVENT_TYPES.includes(event_type)) {
    const err = new Error(`MARKET_EVENT_INVALID_TYPE:${event_type}`);
    err.code = 'MARKET_EVENT_INVALID_TYPE';
    throw err;
  }
  // A3: never treat listing sold_at / archive as SALE_COMPLETED without settlement class.
  if (event_type === 'SALE_COMPLETED' && observation.source_class !== 'FIRST_PARTY_SETTLEMENT') {
    const err = new Error('SALE_COMPLETED_REQUIRES_FIRST_PARTY_SETTLEMENT_OBSERVATION');
    err.code = 'SALE_COMPLETED_REQUIRES_FIRST_PARTY_SETTLEMENT_OBSERVATION';
    throw err;
  }
  const payload = input.payload || {};
  const payload_hash = input.payload_hash || payloadHash(payload);
  const market_event_id =
    input.market_event_id || `me-${observation.observation_id}-${event_type.toLowerCase()}`;

  return Object.freeze({
    market_event_id,
    observation_id: observation.observation_id,
    event_type,
    event_status: input.event_status || 'ACTIVE',
    normalization_version: input.normalization_version || 'phase34-market-event-v2',
    subject_artist: input.subject_artist ?? payload.artist ?? null,
    subject_title: input.subject_title ?? payload.title ?? null,
    subject_label: input.subject_label ?? payload.label ?? null,
    subject_catalog_number: input.subject_catalog_number ?? payload.catalog_number ?? null,
    release_id: input.release_id ?? payload.release_id ?? null,
    pressing_id: input.pressing_id ?? payload.pressing_id ?? null,
    media_condition: input.media_condition ?? payload.media_condition ?? null,
    sleeve_condition: input.sleeve_condition ?? payload.sleeve_condition ?? null,
    geography_country: input.geography_country ?? payload.country ?? null,
    currency_original: input.currency_original ?? payload.currency_original ?? null,
    price_original: input.price_original ?? payload.price_original ?? null,
    currency_normalized: input.currency_normalized ?? payload.currency_normalized ?? null,
    price_normalized: input.price_normalized ?? payload.price_normalized ?? null,
    occurred_at: input.occurred_at || observation.observed_at,
    rights_status: input.rights_status || observation.rights_classification,
    deletion_status: input.deletion_status || observation.deletion_status,
    eligibility_state: input.eligibility_state || 'PENDING',
    payload_hash,
    payload,
    source_class: observation.source_class,
  });
}
