import * as d3 from 'd3'

import { fetchFeedbackSummary } from './marketplace-feedback-api'
import { fetchMyListings } from './listings-api'
import type { MarketplaceListing } from './listings-types'
import { fetchOffersInbox } from './offers-api'
import type {
  BarDatum,
  SellerAnalyticsSummary,
  SellerOfferStats,
} from './profile-analytics-types'
import { formatMoneyCents } from './records-format'

export type SellerAnalyticsBundle = {
  summary: SellerAnalyticsSummary
  offerStats: SellerOfferStats
  salesOverTime: BarDatum[]
  revenueOverTime: BarDatum[]
  oboStatusChart: BarDatum[]
  auctionOutcomeChart: BarDatum[]
  feedbackDistribution: { stars: number; count: number }[]
  listings: MarketplaceListing[]
}

function isActiveListing(l: MarketplaceListing): boolean {
  const s = String(l.status ?? l.listing_status ?? 'active').toLowerCase()
  return s === 'active' || s === 'published' || s === 'draft'
}

function isSoldListing(l: MarketplaceListing): boolean {
  const s = String(l.status ?? l.listing_status ?? '').toLowerCase()
  return s === 'sold' || s === 'archived' || s === 'closed'
}

function isAuctionListing(l: MarketplaceListing): boolean {
  const mode = String(l.saleType ?? l.listing_type ?? l.pricing_mode ?? '').toLowerCase()
  return mode === 'auction'
}

function listingPriceCents(l: MarketplaceListing): number {
  if (typeof l.price_cents === 'number' && l.price_cents > 0) return l.price_cents
  if (typeof l.price === 'number' && l.price > 0) return Math.round(l.price * 100)
  return 0
}

function soldAtIso(l: MarketplaceListing): string | null {
  const raw = l.sold_at ?? l.updated_at ?? l.listed_at ?? l.created_at
  return raw ? String(raw) : null
}

function listedAtIso(l: MarketplaceListing): string | null {
  const raw = l.listed_at ?? l.created_at
  return raw ? String(raw) : null
}

function daysBetween(start: string, end: string): number | null {
  const a = new Date(start).getTime()
  const b = new Date(end).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null
  return Math.round((b - a) / (1000 * 60 * 60 * 24))
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split('-')
  if (!y || !m) return ym
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, {
    month: 'short',
    year: '2-digit',
  })
}

function rollupOfferStats(items: { status: string }[]): SellerOfferStats {
  const counts: SellerOfferStats = {
    pending: 0,
    countered: 0,
    accepted: 0,
    rejected: 0,
    withdrawn: 0,
    expired: 0,
  }
  for (const row of items) {
    const key = String(row.status ?? '').toLowerCase() as keyof SellerOfferStats
    if (key in counts) counts[key] += 1
  }
  return counts
}

export async function fetchSellerAnalytics(): Promise<SellerAnalyticsBundle> {
  const [listings, inbox, feedback] = await Promise.all([
    fetchMyListings().catch(() => [] as MarketplaceListing[]),
    fetchOffersInbox().catch(() => ({ items: [], total: 0 })),
    fetchFeedbackSummary().catch(() => null),
  ])

  const active = listings.filter(isActiveListing)
  const sold = listings.filter(isSoldListing)
  const soldRevenueCents = d3.sum(sold, listingPriceCents)
  const avgSalePriceCents = sold.length > 0 ? Math.round(soldRevenueCents / sold.length) : 0

  const durations = sold
    .map((l) => {
      const listed = listedAtIso(l)
      const soldAt = soldAtIso(l)
      if (!listed || !soldAt) return null
      return daysBetween(listed, soldAt)
    })
    .filter((d): d is number => d != null)
  const avgDaysToSold =
    durations.length > 0 ? Math.round(d3.mean(durations) ?? 0) : null

  const offerStats = rollupOfferStats(inbox.items)
  const oboDecided = offerStats.accepted + offerStats.rejected + offerStats.expired
  const oboAcceptRate = oboDecided > 0 ? offerStats.accepted / oboDecided : null

  const auctionListings = listings.filter(isAuctionListing)
  const auctionWon = auctionListings.filter((l) => isSoldListing(l)).length
  const auctionLost = auctionListings.filter((l) => {
    const s = String(l.status ?? '').toLowerCase()
    return s === 'closed' || s === 'archived'
  }).length
  const auctionOutbid = Math.max(0, auctionListings.length - auctionWon - auctionLost)

  const salesOverTime = [...d3.rollup(
    sold.filter((l) => soldAtIso(l)),
    (v) => v.length,
    (l) => soldAtIso(l)!.slice(0, 7),
  )]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([label, value]) => ({ label: formatMonthLabel(label), value }))

  const revenueOverTime = [...d3.rollup(
    sold.filter((l) => soldAtIso(l)),
    (v) => d3.sum(v, listingPriceCents),
    (l) => soldAtIso(l)!.slice(0, 7),
  )]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([label, value]) => ({
      label: formatMonthLabel(label),
      value: Math.round(value / 100),
    }))

  const oboStatusChart: BarDatum[] = [
    { label: 'Pending', value: offerStats.pending },
    { label: 'Countered', value: offerStats.countered },
    { label: 'Accepted', value: offerStats.accepted },
    { label: 'Declined', value: offerStats.rejected },
    { label: 'Withdrawn', value: offerStats.withdrawn },
    { label: 'Expired', value: offerStats.expired },
  ].filter((d) => d.value > 0)

  const auctionOutcomeChart: BarDatum[] = [
    { label: 'Won/sold', value: auctionWon },
    { label: 'Ended unsold', value: auctionLost },
    { label: 'Active/other', value: auctionOutbid },
  ].filter((d) => d.value > 0)

  return {
    summary: {
      activeListings: active.length,
      soldListings: sold.length,
      revenueCents: soldRevenueCents,
      revenueDisplay: formatMoneyCents(soldRevenueCents),
      avgSalePriceCents,
      avgSalePriceDisplay: formatMoneyCents(avgSalePriceCents),
      avgDaysToSold,
      oboAcceptRate,
      oboAcceptRateDisplay:
        oboAcceptRate != null ? `${Math.round(oboAcceptRate * 100)}%` : '—',
      auctionWon,
      auctionLost,
      auctionOutbid,
    },
    offerStats,
    salesOverTime,
    revenueOverTime,
    oboStatusChart,
    auctionOutcomeChart,
    feedbackDistribution: feedback?.distribution ?? [],
    listings,
  }
}
