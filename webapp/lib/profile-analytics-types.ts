export type BarDatum = { label: string; value: number }

export type SellerAnalyticsSummary = {
  activeListings: number
  soldListings: number
  revenueCents: number
  revenueDisplay: string
  avgSalePriceCents: number
  avgSalePriceDisplay: string
  avgDaysToSold: number | null
  oboAcceptRate: number | null
  oboAcceptRateDisplay: string
  auctionWon: number
  auctionLost: number
  auctionOutbid: number
}

export type SellerOfferStats = {
  pending: number
  countered: number
  accepted: number
  rejected: number
  withdrawn: number
  expired: number
}

export type BuyerAnalyticsSummary = {
  totalPurchases: number
  totalSpendCents: number
  totalSpendDisplay: string
  uniqueArtists: number
  topFormat: string
}

export type BuyerPurchaseRow = {
  id: string
  title: string
  artist: string
  format: string
  purchaseType: string
  purchaseTypeLabel: string
  priceCents: number
  priceDisplay: string
  purchasedAt: string | null
  receivedAt: string | null
  listingId: string | null
  recordId: string | null
  href: string
}
