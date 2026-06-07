import { formatListingPrice, formatMoneyFromCents } from '@/lib/listing-format'
import type { MarketplaceListing } from '@/lib/listings-types'

export type BrowseSaleMode = 'fixed' | 'obo' | 'auction'

export function resolveBrowseSaleMode(listing: MarketplaceListing): BrowseSaleMode {
  const t = String(
    listing.pricing_mode ?? listing.listing_type ?? listing.saleType ?? 'fixed',
  ).toLowerCase()
  if (t === 'auction') return 'auction'
  if (t === 'obo' || t === 'best_offer') return 'obo'
  return 'fixed'
}

export function listingIsSold(listing: MarketplaceListing): boolean {
  const s = String(listing.status ?? listing.listing_status ?? '').toLowerCase()
  return s === 'sold' || s === 'closed'
}

export function auctionEnded(listing: MarketplaceListing): boolean {
  const ends = listing.auction?.endsAt
  if (!ends) return false
  const ms = Date.parse(ends)
  return Number.isFinite(ms) && ms < Date.now()
}

export function formatAuctionTimeLeft(endsAt?: string): string | null {
  if (!endsAt) return null
  const ms = Date.parse(endsAt) - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return 'Ended'
  const hours = Math.floor(ms / 3_600_000)
  if (hours < 1) return '<1h left'
  if (hours < 48) return `${hours}h left`
  const days = Math.floor(hours / 24)
  return `${days}d left`
}

export type BrowsePriceDisplay = {
  amount: string
  label: string
  meta?: string
  accent?: 'default' | 'ended' | 'urgent'
}

export function browsePriceDisplay(listing: MarketplaceListing): BrowsePriceDisplay {
  const mode = resolveBrowseSaleMode(listing)
  const amount = formatListingPrice(listing)
  const sold = listingIsSold(listing)

  if (mode === 'auction') {
    const ended = auctionEnded(listing) || sold
    const timeLeft = formatAuctionTimeLeft(listing.auction?.endsAt)
    const bids = listing.watch_count != null ? `${listing.watch_count} watching` : '0 bids'
    return {
      amount,
      label: ended ? 'Ended' : 'Current bid',
      meta: ended ? `${bids} · Ended` : `${bids} · ${timeLeft ?? 'Active'}`,
      accent: ended ? 'ended' : 'urgent',
    }
  }

  if (mode === 'obo') {
    return {
      amount,
      label: 'Buy It Now',
      meta: 'or Best Offer',
      accent: 'default',
    }
  }

  return {
    amount,
    label: sold ? 'Sold' : 'Buy It Now',
    meta: listing.shipping_summary?.trim() || undefined,
    accent: sold ? 'ended' : 'default',
  }
}

export function browseShippingLine(listing: MarketplaceListing): string {
  if (listing.shipping_summary?.trim()) return listing.shipping_summary.trim()
  const s = listing.shipping
  if (s?.domesticDisplay?.trim()) return s.domesticDisplay.trim()
  if (s?.domesticCostCents === 0 || s?.domesticShipping) return 'Free shipping'
  if (s?.domesticCostCents != null) return formatMoneyFromCents(s.domesticCostCents) + ' shipping'
  return 'See shipping'
}

export function browseConditionLine(listing: MarketplaceListing): string {
  const parts = [
    listing.grade ?? listing.mediaCondition,
    listing.format,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Vinyl'
}

/** Unique image URLs for browse cards (primary first). */
export function browseCardImageUrls(listing: MarketplaceListing): string[] {
  const seen = new Set<string>()
  const push = (url?: string | null) => {
    const u = url?.trim()
    if (!u || seen.has(u)) return
    seen.add(u)
    out.push(u)
  }
  const out: string[] = []
  push(listing.primaryImageUrl)
  for (const url of listing.images ?? []) push(url)
  for (const item of listing.media_items ?? []) push(item.url_or_path)
  return out
}

export function browseSaleRibbon(
  listing: MarketplaceListing,
): { text: string; tone: 'auction' | 'obo' | 'fixed' | 'ended' } | null {
  const mode = resolveBrowseSaleMode(listing)
  if (listingIsSold(listing)) return { text: 'SOLD', tone: 'ended' }
  if (mode === 'auction') {
    if (auctionEnded(listing)) return { text: 'ENDED', tone: 'ended' }
    return { text: 'AUCTION', tone: 'auction' }
  }
  if (mode === 'obo') return { text: 'BEST OFFER', tone: 'obo' }
  return null
}
