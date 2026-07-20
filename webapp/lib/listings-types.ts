import {
  parseAuctionFromRow,
  parseOboFromRow,
  parseShippingFromRow,
  resolveSaleMode,
  type ListingAuctionSettings,
  type ListingOboSettings,
  type ListingShippingInfo,
} from './listing-rp-metadata'
import { inferFormatFromTitle, parseRpFieldsFromRow, resolveRpFormat } from './rp-listing-fields'

export type ListingSaleType = 'fixed_price' | 'obo' | 'auction'

export type ListingStatus =
  | 'draft'
  | 'active'
  | 'published'
  | 'paused'
  | 'sold'
  | 'archived'
  | 'closed'

export type MarketplaceListing = {
  id: string
  title: string
  subtitle?: string
  description?: string
  price?: number
  price_cents?: number
  priceDisplay?: string
  saleTypeDisplay?: string
  listedAtDisplay?: string
  updatedAtDisplay?: string
  timezone?: string
  currency?: string
  listing_type?: ListingSaleType
  pricing_mode?: 'fixed' | 'obo' | 'auction'
  listing_status?: string
  status?: string
  seller?: string
  seller_feedback_score?: number
  shipping_summary?: string
  format?: string
  mediaCondition?: string
  sleeveCondition?: string
  catalogNumber?: string
  label?: string
  artist?: string
  release?: string
  catalog_number?: string
  grade?: string
  sleeve_grade?: string
  location?: string
  country?: string
  created_at?: string
  updated_at?: string
  listed_at?: string
  sold_at?: string
  primaryImageUrl?: string | null
  images?: string[]
  media_items?: Array<{
    id: string
    url_or_path: string
    media_type: string
    sort_order: number
  }>
  watch_count?: number
  bidCount?: number
  currentBidCents?: number
  currentBidDisplay?: string
  endsAt?: string
  timeLeft?: string
  reserveMet?: boolean
  highBidderMasked?: string | null
  user_id?: string
  saleType?: string
  allowOffers?: boolean
  seller_id?: string
  seller_city?: string
  seller_region?: string
  seller_country?: string
  shipping?: ListingShippingInfo
  obo?: ListingOboSettings
  auction?: ListingAuctionSettings
}

export type ListingRevision = {
  id: string
  editor_user_id?: string
  snapshot?: Record<string, unknown>
  changes?: Record<string, unknown> | string
  created_at: string
}

export const LISTINGS_PAGE_SIZES = [24, 48, 72, 120] as const

export type ListingsViewMode = 'grid' | 'list' | 'compact'

export type ListingsSortKey =
  | 'best_match'
  | 'newly_listed'
  | 'ending_soon'
  | 'price_asc'
  | 'price_desc'
  | 'recently_sold'

export function listingToStoredRef(listing: MarketplaceListing) {
  return {
    id: listing.id,
    title: listing.release ?? listing.title,
    artist: listing.artist,
    priceCents:
      listing.price_cents ??
      (listing.price != null ? Math.round(listing.price * 100) : undefined),
    priceDisplay: listing.priceDisplay,
    imageUrl: listing.primaryImageUrl ?? listing.images?.[0],
    saleType: listing.pricing_mode ?? listing.listing_type,
    saleTypeDisplay: listing.saleTypeDisplay,
    sellerDisplay: listing.seller,
    format: listing.format,
    mediaCondition: listing.mediaCondition ?? listing.grade,
  }
}

const HOUSING_FORMAT_BLOCKLIST = new Set([
  'apartment',
  'house',
  'townhouse',
  'condo',
  'studio',
  'room',
  'duplex',
])

function imageUrlsFromRow(row: Record<string, unknown>): string[] {
  if (Array.isArray(row.images) && row.images.length) {
    return row.images.map(String)
  }
  const media = row.mediaItems ?? row.media_items
  if (Array.isArray(media)) {
    return media
      .map((m) => {
        if (!m || typeof m !== 'object') return ''
        const o = m as Record<string, unknown>
        return String(o.url_or_path ?? o.url ?? '')
      })
      .filter(Boolean)
  }
  const primary =
    (row.primaryImageUrl as string | null) ??
    (row.primary_image_url as string | null) ??
    (row.primary_image as string | null)
  return primary ? [String(primary)] : []
}

export function normalizeListing(row: Record<string, unknown>): MarketplaceListing {
  const price_cents = row.price_cents != null ? Number(row.price_cents) : undefined
  const priceDisplay =
    row.priceDisplay != null ? String(row.priceDisplay) : undefined
  const price =
    row.price != null
      ? Number(row.price)
      : price_cents != null
        ? price_cents / 100
        : priceDisplay
          ? Number(priceDisplay.replace(/[^0-9.]/g, ''))
          : undefined
  const imageUrls = imageUrlsFromRow(row)
  const saleMode = resolveSaleMode(row)
  const pm = String(row.pricing_mode ?? row.listing_type ?? row.saleType ?? 'fixed').toLowerCase()
  const listing_type: ListingSaleType = saleMode
  const st = String(row.status ?? row.listing_status ?? 'active').toLowerCase()
  const rp = parseRpFieldsFromRow(row)
  const auction = parseAuctionFromRow(row)
  const endsAt =
    row.endsAt != null
      ? String(row.endsAt)
      : row.auction_ends_at != null
        ? String(row.auction_ends_at)
        : auction.endsAt
  let format =
    row.format != null ? String(row.format) : rp.format ?? resolveRpFormat(row, {})
  if (format && HOUSING_FORMAT_BLOCKLIST.has(format.toLowerCase())) {
    format = inferFormatFromTitle(String(row.title ?? ''))
  }
  const seller =
    String(
      row.seller ??
        row.landlord_display ??
        row.username_display ??
        row.seller_display ??
        '',
    ).trim() || 'Seller'
  return {
    id: String(row.id ?? ''),
    title: String(row.title ?? ''),
    subtitle: row.subtitle != null ? String(row.subtitle) : undefined,
    description: row.description != null ? String(row.description) : undefined,
    price,
    price_cents,
    priceDisplay,
    saleTypeDisplay:
      row.saleTypeDisplay != null ? String(row.saleTypeDisplay) : undefined,
    listedAtDisplay:
      row.listedAtDisplay != null ? String(row.listedAtDisplay) : undefined,
    updatedAtDisplay:
      row.updatedAtDisplay != null ? String(row.updatedAtDisplay) : undefined,
    timezone: row.timezone != null ? String(row.timezone) : undefined,
    pricing_mode:
      listing_type === 'auction' ? 'auction' : listing_type === 'obo' ? 'obo' : 'fixed',
    listing_type,
    listing_status: st,
    status: st,
    seller,
    format,
    mediaCondition:
      row.mediaCondition != null
        ? String(row.mediaCondition)
        : rp.mediaCondition ?? (row.grade != null ? String(row.grade) : undefined),
    sleeveCondition:
      row.sleeveCondition != null
        ? String(row.sleeveCondition)
        : rp.sleeveCondition ??
          (row.sleeve_grade != null ? String(row.sleeve_grade) : undefined),
    catalogNumber:
      row.catalogNumber != null
        ? String(row.catalogNumber)
        : rp.catalogNumber ??
          (row.catalog_number != null ? String(row.catalog_number) : undefined),
    label: row.label != null ? String(row.label) : rp.label,
    artist: row.artist != null ? String(row.artist) : undefined,
    release: row.release != null ? String(row.release) : undefined,
    location:
      row.location != null
        ? String(row.location)
        : row.approximate_location_label != null
          ? String(row.approximate_location_label)
          : undefined,
    country: row.country != null ? String(row.country) : row.seller_country != null ? String(row.seller_country) : undefined,
    created_at:
      row.created_at != null
        ? String(row.created_at)
        : row.listedAt != null
          ? String(row.listedAt)
          : undefined,
    updated_at:
      row.updated_at != null
        ? String(row.updated_at)
        : row.updatedAt != null
          ? String(row.updatedAt)
          : undefined,
    listed_at:
      row.listed_at != null
        ? String(row.listed_at)
        : row.listedAt != null
          ? String(row.listedAt)
          : undefined,
    sold_at: row.sold_at != null ? String(row.sold_at) : undefined,
    primaryImageUrl:
      (row.primaryImageUrl as string | null) ??
      (row.primary_image_url as string | null) ??
      (row.primary_image as string | null) ??
      imageUrls[0] ??
      null,
    grade:
      row.grade != null
        ? String(row.grade)
        : rp.mediaCondition,
    sleeve_grade:
      row.sleeve_grade != null ? String(row.sleeve_grade) : rp.sleeveCondition,
    catalog_number:
      row.catalog_number != null ? String(row.catalog_number) : rp.catalogNumber,
    images: imageUrls.length ? imageUrls : undefined,
    media_items: Array.isArray(row.media_items)
      ? (row.media_items as Record<string, unknown>[]).map((m) => ({
          id: String(m.id ?? ''),
          url_or_path: String(m.url_or_path ?? ''),
          media_type: String(m.media_type ?? 'image'),
          sort_order: Number(m.sort_order ?? 0),
        }))
      : Array.isArray(row.mediaItems)
        ? (row.mediaItems as Record<string, unknown>[]).map((m) => ({
            id: String(m.id ?? ''),
            url_or_path: String(m.url_or_path ?? m.url ?? ''),
            media_type: String(m.media_type ?? 'image'),
            sort_order: Number(m.sort_order ?? 0),
          }))
        : undefined,
    watch_count: row.watch_count != null ? Number(row.watch_count) : undefined,
    user_id: row.user_id != null ? String(row.user_id) : undefined,
    saleType: row.saleType != null ? String(row.saleType) : listing_type,
    allowOffers: row.allowOffers === true || row.allowOffers === 'true',
    shipping_summary:
      row.shipping_summary != null ? String(row.shipping_summary) : undefined,
    seller_id:
      row.seller_id != null
        ? String(row.seller_id)
        : row.user_id != null
          ? String(row.user_id)
          : undefined,
    seller_city: row.seller_city != null ? String(row.seller_city) : undefined,
    seller_region: row.seller_region != null ? String(row.seller_region) : undefined,
    seller_country: row.seller_country != null ? String(row.seller_country) : undefined,
    shipping: parseShippingFromRow(row),
    obo: parseOboFromRow(row),
    auction,
    endsAt,
  }
}
