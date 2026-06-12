/**
 * T15.2B — Analytics normalization layer (shared).
 * Cleans raw platform rows into stable, owner-scoped AI documents.
 * analytics-service will consume this export path in later tickets; reindex uses it now.
 */
import crypto from 'node:crypto';

export const SOURCE_TYPES = {
  RECORD: 'record',
  LISTING: 'listing',
  LISTING_REVISION: 'listing_revision',
  OBO_OFFER_SUMMARY: 'obo_offer_summary',
  AUCTION_BID_SUMMARY: 'auction_bid_summary',
  NOTIFICATION: 'notification',
  CART_SUMMARY: 'cart_summary',
  ORDER_SUMMARY: 'order_summary',
  RESERVATION_SUMMARY: 'reservation_summary',
  MESSAGE: 'message',
};

const FORBIDDEN_EXPORT_PATTERNS = [
  /max_bid_cents/i,
  /proxy_bids/i,
  /proxy max/i,
  /\blandlord\b/i,
  /\btenant\b/i,
  /\bOCH\b/,
  /off[- ]campus/i,
  /\bresidence_type\b/i,
  /lease_length_months/i,
];

/** SHA-256 hex digest of normalized payload for idempotent upsert. */
export function documentChecksum(fields) {
  const payload = JSON.stringify({
    source_type: fields.source_type,
    source_id: fields.source_id,
    owner_user_id: fields.owner_user_id ?? null,
    visibility: fields.visibility,
    title: fields.title,
    summary: fields.summary,
    normalized_text: fields.normalized_text,
    source_updated_at: fields.source_updated_at,
    metadata: fields.metadata ?? {},
    source_refs: fields.source_refs ?? [],
  });
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

export function maskBidderId(bidderUserId) {
  if (!bidderUserId) return 'bidder_unknown';
  const h = crypto.createHash('sha256').update(String(bidderUserId)).digest('hex').slice(0, 8);
  return `bidder_${h}`;
}

/** Strip legacy OCH/housing seed artifacts from export text (analytics curation). */
export function sanitizePlatformText(text) {
  return String(text ?? '')
    .replace(/\boch-page[-\d\w]*/gi, 'marketplace-listing')
    .replace(/\boff[- ]campus\b/gi, '')
    .replace(/\bresidence_type\b/gi, '')
    .replace(/\blease_length_months\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function sanitizeListingTitle(title, id) {
  const raw = String(title ?? '').trim();
  if (/^och-page[-\d]/i.test(raw)) {
    return `Listing ${String(id).slice(0, 8)}`;
  }
  return sanitizePlatformText(raw) || `Listing ${String(id).slice(0, 8)}`;
}

export function assertNoForbiddenExport(text) {
  for (const re of FORBIDDEN_EXPORT_PATTERNS) {
    if (re.test(text)) {
      throw new Error(`forbidden export content matched ${re}`);
    }
  }
}

function baseDoc(partial) {
  const doc = {
    source_type: partial.source_type,
    source_id: String(partial.source_id),
    owner_user_id: partial.owner_user_id != null ? String(partial.owner_user_id) : null,
    visibility: partial.visibility,
    title: partial.title,
    summary: partial.summary ?? '',
    normalized_text: partial.normalized_text,
    source_updated_at: partial.source_updated_at,
    metadata: partial.metadata ?? {},
    source_refs: partial.source_refs ?? [],
  };
  assertNoForbiddenExport(doc.normalized_text);
  assertNoForbiddenExport(doc.summary);
  assertNoForbiddenExport(JSON.stringify(doc.metadata));
  doc.checksum = documentChecksum(doc);
  return doc;
}

/** records.records → owner-scoped collection document. */
export function normalizeRecord(row) {
  const title = `${row.artist} — ${row.name}`;
  const lines = [
    `Record: ${row.artist} — ${row.name}`,
    `Format: ${row.format}`,
    row.catalog_number ? `Catalog: ${row.catalog_number}` : null,
    row.record_grade ? `Record grade: ${row.record_grade}` : null,
    row.sleeve_grade ? `Sleeve grade: ${row.sleeve_grade}` : null,
    row.price_paid != null ? `Price paid: ${row.price_paid}` : null,
    row.notes ? `Notes: ${String(row.notes).slice(0, 500)}` : null,
  ].filter(Boolean);
  return baseDoc({
    source_type: SOURCE_TYPES.RECORD,
    source_id: row.id,
    owner_user_id: row.user_id,
    visibility: 'owner',
    title,
    summary: `Collection record ${row.artist} — ${row.name} (${row.format})`,
    normalized_text: lines.join('\n'),
    source_updated_at: row.updated_at ?? row.created_at,
    metadata: {
      format: row.format,
      record_grade: row.record_grade,
      sleeve_grade: row.sleeve_grade,
    },
    source_refs: [{ schema: 'records', table: 'records', id: String(row.id) }],
  });
}

/** Active public marketplace listing (no draft/seller-only fields). */
export function normalizePublicListing(row) {
  const title = sanitizeListingTitle(row.title, row.id);
  const description = row.description ? sanitizePlatformText(String(row.description).slice(0, 800)) : null;
  const lines = [
    `Listing: ${title}`,
    `Type: ${row.listing_type}`,
    `Price: ${row.price} ${row.currency}`,
    row.condition ? `Condition: ${row.condition}` : null,
    row.category ? `Category: ${row.category}` : null,
    row.location ? `Location: ${sanitizePlatformText(row.location)}` : null,
    description ? `Description: ${description}` : null,
  ].filter(Boolean);
  return baseDoc({
    source_type: SOURCE_TYPES.LISTING,
    source_id: row.id,
    owner_user_id: null,
    visibility: 'public',
    title,
    summary: `Active listing ${title} (${row.listing_type})`,
    normalized_text: lines.join('\n'),
    source_updated_at: row.updated_at ?? row.created_at,
    metadata: {
      listing_type: row.listing_type,
      seller_user_id: String(row.user_id),
      is_active: true,
    },
    source_refs: [{ schema: 'listings', table: 'listings', id: String(row.id) }],
  });
}

/** Seller-only listing document (draft/inactive). */
export function normalizeOwnerListing(row) {
  const cleanTitle = sanitizeListingTitle(row.title, row.id);
  const title = `[Seller] ${cleanTitle}`;
  const description = row.description ? sanitizePlatformText(String(row.description).slice(0, 1200)) : null;
  const lines = [
    `Seller listing: ${cleanTitle}`,
    `Status: ${row.is_active ? 'active' : 'inactive'}`,
    `Type: ${row.listing_type}`,
    `Price: ${row.price} ${row.currency}`,
    description ? `Description: ${description}` : null,
  ].filter(Boolean);
  return baseDoc({
    source_type: SOURCE_TYPES.LISTING,
    source_id: row.id,
    owner_user_id: row.user_id,
    visibility: 'owner',
    title,
    summary: `Seller view of listing ${cleanTitle}`,
    normalized_text: lines.join('\n'),
    source_updated_at: row.updated_at ?? row.created_at,
    metadata: { listing_type: row.listing_type, is_active: row.is_active },
    source_refs: [{ schema: 'listings', table: 'listings', id: String(row.id) }],
  });
}

/** Append-only listing revision — seller/editor only. */
export function normalizeListingRevision(row, listing) {
  const snap = row.snapshot ?? {};
  const listingTitle = sanitizeListingTitle(listing?.title ?? row.listing_id, row.listing_id);
  const title = `Revision ${row.id.slice(0, 8)} — ${listingTitle}`;
  const lines = [
    `Listing revision for ${listingTitle}`,
    `Editor: ${row.editor_user_id}`,
    snap.title ? `Title: ${sanitizeListingTitle(snap.title, row.listing_id)}` : null,
    snap.price != null ? `Price: ${snap.price}` : null,
    snap.description ? `Description: ${String(snap.description).slice(0, 800)}` : null,
  ].filter(Boolean);
  const owner = listing?.user_id ?? row.editor_user_id;
  return baseDoc({
    source_type: SOURCE_TYPES.LISTING_REVISION,
    source_id: row.id,
    owner_user_id: owner,
    visibility: 'owner',
    title,
    summary: `Listing edit history snapshot`,
    normalized_text: lines.join('\n'),
    source_updated_at: row.created_at,
    metadata: { listing_id: String(row.listing_id), editor_user_id: String(row.editor_user_id) },
    source_refs: [
      { schema: 'listings', table: 'listing_revisions', id: String(row.id) },
      { schema: 'listings', table: 'listings', id: String(row.listing_id) },
    ],
  });
}

/** OBO offer summary — metadata only; never raw negotiation message. */
export function normalizeOboOfferSummary(offer, listingTitle) {
  const title = `Offer on ${listingTitle ?? offer.listing_id}`;
  const lines = [
    `Offer summary for listing ${offer.listing_id}`,
    `Status: ${offer.status}`,
    `Amount: ${offer.amount_cents} ${offer.currency}`,
    `Attempt: ${offer.attempt_number}`,
    offer.expires_at ? `Expires: ${offer.expires_at}` : null,
    offer.parent_offer_id ? `Counter-chain parent: ${offer.parent_offer_id}` : null,
  ];
  const docs = [];
  for (const [role, uid] of [
    ['buyer', offer.buyer_user_id],
    ['seller', offer.seller_user_id],
  ]) {
    docs.push(
      baseDoc({
        source_type: SOURCE_TYPES.OBO_OFFER_SUMMARY,
        source_id: offer.id,
        owner_user_id: uid,
        visibility: 'owner',
        title: `${title} (${role})`,
        summary: `OBO offer ${offer.status} — ${offer.amount_cents} cents`,
        normalized_text: lines.join('\n'),
        source_updated_at: offer.updated_at ?? offer.created_at,
        metadata: {
          role,
          listing_id: String(offer.listing_id),
          status: offer.status,
          amount_cents: offer.amount_cents,
        },
        source_refs: [{ schema: 'listings', table: 'offers', id: String(offer.id) }],
      }),
    );
  }
  return docs;
}

/** Auction bid summary — visible bids only; masked bidders; never proxy max. */
export function normalizeAuctionBidSummary(listing, settings, bids) {
  const title = `Auction: ${listing.title}`;
  const bidLines = (bids ?? []).map((b) => {
    const bidder = maskBidderId(b.bidder_user_id ?? b.user_id);
    const cents = b.amount_cents ?? Math.round(Number(b.bid_amount ?? 0) * 100);
    return `Bid ${cents} cents by ${bidder} at ${b.created_at}`;
  });
  const lines = [
    `Auction listing: ${listing.title}`,
    `Status: ${settings?.status ?? 'unknown'}`,
    `Current bid cents: ${settings?.current_bid_cents ?? 0}`,
    `Bid count: ${settings?.bid_count ?? bidLines.length}`,
    settings?.ends_at ? `Ends: ${settings.ends_at}` : null,
    ...bidLines.slice(0, 20),
  ].filter(Boolean);
  return baseDoc({
    source_type: SOURCE_TYPES.AUCTION_BID_SUMMARY,
    source_id: listing.id,
    owner_user_id: null,
    visibility: 'public',
    title,
    summary: `Auction summary — ${settings?.bid_count ?? 0} bids`,
    normalized_text: lines.join('\n'),
    source_updated_at: settings?.updated_at ?? listing.updated_at ?? listing.created_at,
    metadata: {
      listing_id: String(listing.id),
      bid_count: settings?.bid_count ?? bidLines.length,
      current_bid_cents: settings?.current_bid_cents ?? 0,
    },
    source_refs: [{ schema: 'listings', table: 'listings', id: String(listing.id) }],
  });
}

export function normalizeNotification(row) {
  const payload = row.payload ?? {};
  const title = `Notification: ${row.event_type}`;
  const lines = [
    `Notification ${row.event_type}`,
    `Channel: ${row.channel}`,
    `Status: ${row.status}`,
    payload.listing_id ? `Listing: ${payload.listing_id}` : null,
    payload.record_id ? `Record: ${payload.record_id}` : null,
  ].filter(Boolean);
  return baseDoc({
    source_type: SOURCE_TYPES.NOTIFICATION,
    source_id: row.id,
    owner_user_id: row.user_id,
    visibility: 'owner',
    title,
    summary: `${row.event_type} via ${row.channel}`,
    normalized_text: lines.join('\n'),
    source_updated_at: row.created_at,
    metadata: { event_type: row.event_type, channel: row.channel, status: row.status },
    source_refs: [{ schema: 'notification', table: 'notifications', id: String(row.id) }],
  });
}

/** Messages skipped unless explicit opt-in (checked at export time). */
export function normalizeMessage(row, optIn) {
  if (!optIn) return null;
  const title = `Message thread ${row.conversation_id}`;
  const body = String(row.body ?? '').slice(0, 500);
  return baseDoc({
    source_type: SOURCE_TYPES.MESSAGE,
    source_id: row.id,
    owner_user_id: row.sender_id,
    visibility: 'owner',
    title,
    summary: `Message excerpt (${body.length} chars)`,
    normalized_text: `Message in conversation ${row.conversation_id}: ${body}`,
    source_updated_at: row.created_at,
    metadata: { conversation_id: String(row.conversation_id), opt_in: true },
    source_refs: [{ schema: 'messaging', table: 'messages', id: String(row.id) }],
  });
}

/** Deterministic chunking (paragraph-aware, max chunk chars). */
export function chunkNormalizedText(text, maxChars = 1200, maxChunks = 32) {
  const paragraphs = String(text).split(/\n\n+/).filter((p) => p.trim());
  const chunks = [];
  let buf = '';
  for (const p of paragraphs) {
    const next = buf ? `${buf}\n\n${p}` : p;
    if (next.length > maxChars && buf) {
      chunks.push(buf.trim());
      buf = p;
    } else if (next.length > maxChars) {
      for (let i = 0; i < p.length; i += maxChars) {
        chunks.push(p.slice(i, i + maxChars).trim());
      }
      buf = '';
    } else {
      buf = next;
    }
    if (chunks.length >= maxChunks) break;
  }
  if (buf.trim() && chunks.length < maxChunks) chunks.push(buf.trim());
  if (chunks.length === 0 && text.trim()) chunks.push(text.trim().slice(0, maxChars));
  return chunks.slice(0, maxChunks).map((content, chunk_index) => ({
    chunk_index,
    content,
    token_count: Math.ceil(content.length / 4),
    checksum: crypto.createHash('sha256').update(content, 'utf8').digest('hex'),
    source_refs: [],
  }));
}
