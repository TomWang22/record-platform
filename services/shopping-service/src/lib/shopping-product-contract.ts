import { listingsPool } from './availability.js'

export type ShoppingProductCard = {
  id: string
  listingId: string
  title: string
  seller: string | null
  sellerId: string | null
  priceDisplay: string | null
  saleTypeDisplay: string | null
  primaryImageUrl: string | null
  format: string | null
  mediaCondition: string | null
  sleeveCondition: string | null
  listedAtDisplay: string | null
  updatedAtDisplay: string | null
  watchlistedAtDisplay?: string | null
  viewedAtDisplay?: string | null
}

const FORBIDDEN_RESPONSE_KEYS = new Set([
  'item_type',
  'item_id',
  'metadata',
  'price_cents',
  'priceCents',
  'notify_on',
  'listing_info',
  'sold_out',
  'sold_out_at',
  'viewed_at',
  'created_at',
])

function formatMoneyFromCents(cents: unknown): string | null {
  const n = Number(cents)
  if (!Number.isFinite(n)) return null
  return `$${(Math.round(n) / 100).toFixed(2)}`
}

function saleTypeDisplay(mode: unknown): string {
  const s = String(mode ?? 'fixed').toLowerCase()
  if (s === 'auction') return 'Auction'
  if (s === 'obo' || s === 'best_offer' || s === 'best offer') return 'Best offer'
  return 'Fixed price'
}

function formatPublicTimestamp(iso: unknown): string | null {
  if (!iso) return null
  const d = new Date(String(iso))
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  })
}

function parseMetadata(raw: unknown): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return {}
}

function amenityValue(amenities: unknown, ...keys: string[]): string | null {
  const map = parseMetadata(amenities)
  for (const k of keys) {
    const v = map[k] ?? map[k.toLowerCase()]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  if (Array.isArray(amenities)) {
    for (const item of amenities) {
      const s = String(item)
      for (const k of keys) {
        const prefix = `${k}=`
        if (s.toLowerCase().startsWith(prefix.toLowerCase())) {
          return s.slice(prefix.length).trim()
        }
      }
    }
  }
  return null
}

type ListingRow = {
  id: string
  title?: string | null
  price_cents?: number | null
  user_id?: string | null
  username_display?: string | null
  record_grade?: string | null
  sleeve_grade?: string | null
  pricing_mode?: string | null
  amenities?: unknown
  listed_at?: string | Date | null
  updated_at?: string | Date | null
  image_url?: string | null
}

async function fetchListingRows(ids: string[]): Promise<Map<string, ListingRow>> {
  const out = new Map<string, ListingRow>()
  const unique = [...new Set(ids.filter(Boolean))]
  if (!unique.length) return out
  try {
    const result = await listingsPool.query(
      `SELECT l.id, l.title, l.price_cents, l.user_id, l.username_display,
              l.record_grade, l.sleeve_grade, l.pricing_mode, l.amenities,
              l.listed_at, l.updated_at,
              (
                SELECT m.url_or_path
                FROM listings.listing_media m
                WHERE m.listing_id = l.id AND m.media_type = 'image'
                ORDER BY m.sort_order ASC, m.created_at ASC
                LIMIT 1
              ) AS image_url
       FROM listings.listings l
       WHERE l.id = ANY($1::uuid[]) AND l.deleted_at IS NULL`,
      [unique],
    )
    for (const row of result.rows as ListingRow[]) {
      out.set(String(row.id), row)
    }
  } catch (err) {
    console.warn('[shopping] listing enrichment unavailable:', (err as Error).message)
  }
  return out
}

function buildCard(
  listingId: string,
  meta: Record<string, unknown>,
  listing: ListingRow | undefined,
  opts: { watchlistedAt?: string | Date | null; viewedAt?: string | Date | null; rowId?: string },
): ShoppingProductCard {
  const priceDisplay =
    (meta.priceDisplay != null ? String(meta.priceDisplay) : null) ??
    (listing?.price_cents != null ? formatMoneyFromCents(listing.price_cents) : null)

  const saleType =
    meta.saleType != null
      ? String(meta.saleType)
      : listing?.pricing_mode != null
        ? String(listing.pricing_mode)
        : 'fixed'

  const format =
    (meta.format != null ? String(meta.format) : null) ??
    amenityValue(listing?.amenities, 'format', 'media_type')

  const mediaCondition =
    (meta.mediaCondition != null ? String(meta.mediaCondition) : null) ??
    (listing?.record_grade != null ? String(listing.record_grade) : null) ??
    amenityValue(listing?.amenities, 'media_condition', 'record_grade', 'grade')

  const sleeveCondition =
    (meta.sleeveCondition != null ? String(meta.sleeveCondition) : null) ??
    (listing?.sleeve_grade != null ? String(listing.sleeve_grade) : null) ??
    amenityValue(listing?.amenities, 'sleeve_condition', 'sleeve_grade')

  const seller =
    (meta.sellerDisplay != null ? String(meta.sellerDisplay) : null) ??
    (listing?.username_display != null ? String(listing.username_display) : null)

  const sellerId =
    listing?.user_id != null
      ? String(listing.user_id)
      : meta.sellerId != null
        ? String(meta.sellerId)
        : null

  const primaryImageUrl =
    (meta.imageUrl != null ? String(meta.imageUrl) : null) ??
    (meta.primaryImageUrl != null ? String(meta.primaryImageUrl) : null) ??
    (listing?.image_url != null ? String(listing.image_url) : null)

  return {
    id: opts.rowId ?? listingId,
    listingId,
    title: String(meta.title ?? listing?.title ?? 'Listing'),
    seller,
    sellerId,
    priceDisplay,
    saleTypeDisplay:
      meta.saleTypeDisplay != null ? String(meta.saleTypeDisplay) : saleTypeDisplay(saleType),
    primaryImageUrl,
    format,
    mediaCondition,
    sleeveCondition,
    listedAtDisplay:
      meta.listedAtDisplay != null
        ? String(meta.listedAtDisplay)
        : formatPublicTimestamp(listing?.listed_at),
    updatedAtDisplay:
      meta.updatedAtDisplay != null
        ? String(meta.updatedAtDisplay)
        : formatPublicTimestamp(listing?.updated_at),
    watchlistedAtDisplay: opts.watchlistedAt
      ? formatPublicTimestamp(opts.watchlistedAt)
      : undefined,
    viewedAtDisplay: opts.viewedAt ? formatPublicTimestamp(opts.viewedAt) : undefined,
  }
}

export function shoppingProductResponseLeaksRawShape(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const obj = payload as Record<string, unknown>
  const items = obj.items
  if (!Array.isArray(items)) return 'missing items array'
  for (const item of items) {
    if (!item || typeof item !== 'object') return 'invalid item'
    const row = item as Record<string, unknown>
    for (const key of Object.keys(row)) {
      if (FORBIDDEN_RESPONSE_KEYS.has(key)) return key
      if (key.endsWith('_cents')) return key
    }
    if (!row.listingId || !row.title || !row.priceDisplay) return 'incomplete product card'
  }
  return null
}

export async function normalizeWatchlistItems(
  rows: Array<{
    id?: string
    listing_id?: string | null
    item_id: string
    metadata?: unknown
    created_at?: string | Date
  }>,
): Promise<ShoppingProductCard[]> {
  const listingIds = rows.map((r) => String(r.listing_id ?? r.item_id))
  const listings = await fetchListingRows(listingIds)
  return rows.map((row) => {
    const listingId = String(row.listing_id ?? row.item_id)
    const meta = parseMetadata(row.metadata)
    return buildCard(listingId, meta, listings.get(listingId), {
      rowId: row.id != null ? String(row.id) : listingId,
      watchlistedAt: row.created_at,
    })
  })
}

export async function normalizeRecentlyViewedItems(
  rows: Array<{
    item_id: string
    metadata?: unknown
    viewed_at?: string | Date
  }>,
): Promise<ShoppingProductCard[]> {
  const listingIds = rows.map((r) => String(r.item_id))
  const listings = await fetchListingRows(listingIds)
  return rows.map((row) => {
    const listingId = String(row.item_id)
    const meta = parseMetadata(row.metadata)
    return buildCard(listingId, meta, listings.get(listingId), {
      rowId: listingId,
      viewedAt: row.viewed_at,
    })
  })
}
