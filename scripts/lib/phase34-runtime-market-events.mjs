/**
 * Load canonical market events from intelligence.market_events for runtime
 * capability responses. Never returns seed/owner-proof fixture arrays.
 */
import pg from 'pg';

const DEFAULT_URL =
  process.env.POSTGRES_URL_LISTINGS ||
  process.env.LISTINGS_DATABASE_URL ||
  'postgresql://postgres:postgres@127.0.0.1:5435/listings';

/**
 * Map a DB market_events row (+ payload) into an eligibility candidate.
 */
export function marketEventRowToCandidate(row) {
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload || {};
  const eventType = String(row.event_type || '').toUpperCase();
  const isSold = eventType === 'SALE_COMPLETED' || eventType === 'AUCTION_PAYMENT_SETTLED';
  return {
    market_event_id: row.market_event_id,
    evidence_id: row.market_event_id,
    observation_id: row.observation_id || null,
    event_type: eventType,
    sale_kind: isSold ? 'sold' : payload.sale_kind || null,
    source_type: isSold ? 'sale' : 'listing',
    source_class: isSold ? 'FIRST_PARTY_SETTLEMENT' : 'FIRST_PARTY_LISTING',
    settlement_evidence_eligible: isSold,
    rights_status: row.rights_status || payload.rights_status || 'FIRST_PARTY',
    rights_class:
      payload.rights_class || row.rights_status || payload.rights_status || 'FIRST_PARTY',
    deletion_status: row.deletion_status || 'ACTIVE',
    event_status: row.event_status || 'ACTIVE',
    price: row.price_normalized != null ? Number(row.price_normalized) : null,
    final_price: row.price_normalized != null ? Number(row.price_normalized) : null,
    currency: row.currency_normalized || row.currency_original || 'USD',
    occurred_at: row.occurred_at,
    sold_at: isSold ? row.occurred_at : null,
    observed_at: row.occurred_at,
    payload_hash: row.payload_hash,
    listing_id: payload.listing_id || payload.source_listing_id || null,
    sale_event_id: payload.sale_event_id || null,
    artist: row.subject_artist || payload.artist || null,
    title: row.subject_title || payload.title || null,
    catalog_number: row.subject_catalog_number || payload.catalog_number || null,
    media_condition: row.media_condition || payload.media_condition || null,
    pressing_id: payload.pressing_id || null,
    release_id: payload.release_id || null,
    refunded: payload.refunded === true || eventType === 'SALE_REFUNDED',
    from_seed: false,
    synthetic: false,
    force_floor: false,
    freshness_status: 'fresh',
    authorization_scope: 'authenticated_market',
    reason_codes: isSold ? ['RECENT_SALE', 'AUTHORIZED_MARKET'] : ['ACTIVE_ASKING_ONLY'],
  };
}

/**
 * @param {object} [opts]
 * @param {string[]} [opts.eventTypes]
 * @param {number} [opts.limit]
 * @param {string} [opts.listingId]
 * @param {import('pg').Pool} [opts.pool]
 */
export async function loadCanonicalMarketEventCandidates(opts = {}) {
  const {
    eventTypes = ['SALE_COMPLETED'],
    limit = 50,
    listingId = null,
    connectionString = DEFAULT_URL,
    pool = null,
  } = opts;

  const owned = !pool;
  const db = pool || new pg.Pool({ connectionString, max: 2 });
  try {
    const params = [eventTypes, limit];
    let sql = `
      SELECT market_event_id, observation_id, event_type, event_status,
             subject_artist, subject_title, subject_catalog_number, media_condition,
             currency_original, price_original, currency_normalized, price_normalized,
             occurred_at, rights_status, deletion_status, payload_hash, payload
      FROM intelligence.market_events
      WHERE event_type = ANY($1::text[])
        AND COALESCE(deletion_status, 'ACTIVE') = 'ACTIVE'
        AND COALESCE(event_status, 'ACTIVE') = 'ACTIVE'`;
    if (listingId) {
      params.push(listingId);
      sql += ` AND (payload->>'listing_id' = $${params.length}
               OR payload->>'source_listing_id' = $${params.length})`;
    }
    sql += ` ORDER BY occurred_at DESC NULLS LAST LIMIT $2`;

    const { rows } = await db.query(sql, params);
    return rows.map(marketEventRowToCandidate);
  } finally {
    if (owned) await db.end();
  }
}
