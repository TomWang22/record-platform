import { apiFetch } from './api-client'

export type PublicOffer = {
  id: string
  listingId: string
  listingTitle?: string | null
  buyer: string
  seller: string
  amountDisplay: string
  status: string
  statusDisplay: string
  message?: string | null
  expiresAtDisplay?: string | null
  attemptNumber?: number
  createdAtDisplay?: string
}

export type OfferSettings = {
  oboEnabled: boolean
  maxAttempts: number
  attemptsRemaining: number | null
  minOfferDisplay: string | null
  offerTtlHours: number
  allowCounteroffers: boolean
  listingTitle?: string | null
}

export type OfferListResponse = {
  items: PublicOffer[]
  total: number
}

export async function fetchOfferSettings(listingId: string): Promise<OfferSettings> {
  return apiFetch<OfferSettings>(`/api/listings/${listingId}/offers/settings`, { auth: true })
}

export async function fetchOffersInbox(): Promise<OfferListResponse> {
  return apiFetch<OfferListResponse>('/api/offers/inbox', { auth: true })
}

export async function fetchOffersSent(): Promise<OfferListResponse> {
  return apiFetch<OfferListResponse>('/api/offers/sent', { auth: true })
}

export async function fetchMyOffersForListing(listingId: string): Promise<OfferListResponse> {
  return apiFetch<OfferListResponse>(`/api/listings/${listingId}/offers/mine`, { auth: true })
}

export async function submitOffer(
  listingId: string,
  input: { amountCents: number; message?: string },
): Promise<PublicOffer> {
  return apiFetch<PublicOffer>(`/api/listings/${listingId}/offers`, {
    method: 'POST',
    auth: true,
    data: input,
  })
}

export async function acceptOffer(listingId: string, offerId: string): Promise<PublicOffer> {
  return apiFetch<PublicOffer>(`/api/listings/${listingId}/offers/${offerId}/accept`, {
    method: 'POST',
    auth: true,
    data: {},
  })
}

export async function rejectOffer(listingId: string, offerId: string): Promise<PublicOffer> {
  return apiFetch<PublicOffer>(`/api/listings/${listingId}/offers/${offerId}/reject`, {
    method: 'POST',
    auth: true,
    data: {},
  })
}

export async function counterOffer(
  listingId: string,
  offerId: string,
  input: { amountCents: number; message?: string },
): Promise<PublicOffer> {
  return apiFetch<PublicOffer>(`/api/listings/${listingId}/offers/${offerId}/counter`, {
    method: 'POST',
    auth: true,
    data: input,
  })
}

export async function withdrawOffer(listingId: string, offerId: string): Promise<PublicOffer> {
  return apiFetch<PublicOffer>(`/api/listings/${listingId}/offers/${offerId}/withdraw`, {
    method: 'POST',
    auth: true,
    data: {},
  })
}

export function dollarsToCents(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, '')
  const dollars = Number(cleaned)
  if (!Number.isFinite(dollars) || dollars <= 0) return null
  return Math.round(dollars * 100)
}

export function listingAcceptsOffers(listing: {
  listing_type?: string
  pricing_mode?: string
  saleType?: string
  allowOffers?: boolean
}): boolean {
  const mode = String(
    listing.listing_type ?? listing.pricing_mode ?? listing.saleType ?? '',
  ).toLowerCase()
  return mode === 'obo' || listing.allowOffers === true
}
