import { apiFetch } from './api-client'

export type AuctionState = {
  listingId: string
  status: string
  currentBidDisplay: string
  currentBidCents: number
  bidCount: number
  bidIncrementDisplay: string
  bidIncrementCents: number
  timeLeft: string
  timeLeftMs: number
  reserveMet: boolean
  highBidderMasked: string | null
  viewerState?: string | null
  winnerMasked?: string | null
}

export type AuctionBidItem = {
  id: string
  amountDisplay: string
  bidderMasked: string
  bidSource: string
  bidSourceDisplay: string
  createdAtDisplay: string
}

export async function fetchAuctionState(listingId: string): Promise<AuctionState> {
  return apiFetch<AuctionState>(`/api/listings/${listingId}/auction/state`, { auth: true })
}

export async function fetchAuctionBids(
  listingId: string,
): Promise<{ items: AuctionBidItem[]; total: number }> {
  return apiFetch<{ items: AuctionBidItem[]; total: number }>(
    `/api/listings/${listingId}/auction/bids`,
    { auth: true },
  )
}

export async function placeAuctionBid(
  listingId: string,
  input: { amountCents?: number; maxBidCents?: number; useProxy?: boolean },
): Promise<AuctionState> {
  return apiFetch<AuctionState>(`/api/listings/${listingId}/auction/bids`, {
    method: 'POST',
    auth: true,
    data: input,
  })
}

export async function closeAuction(listingId: string, force = true): Promise<AuctionState> {
  return apiFetch<AuctionState>(`/api/listings/${listingId}/auction/close?force=1`, {
    method: 'POST',
    auth: true,
    data: { force: true },
  })
}

export function dollarsToCents(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, '')
  const dollars = Number(cleaned)
  if (!Number.isFinite(dollars) || dollars <= 0) return null
  return Math.round(dollars * 100)
}

export function listingIsAuction(listing: {
  listing_type?: string
  pricing_mode?: string
  saleType?: string
}): boolean {
  const mode = String(
    listing.listing_type ?? listing.pricing_mode ?? listing.saleType ?? '',
  ).toLowerCase()
  return mode === 'auction'
}
