import type { APIRequestContext } from '@playwright/test'

import { createListingWithShipping, PLACEHOLDER_A, PLACEHOLDER_B } from './listing-contract'
import { getJsonWith429Retry } from './http-retry'

type ListingHit = {
  id?: string
  pricing_mode?: string
  listing_type?: string
  saleType?: string
  saleTypeDisplay?: string
}

function saleModeOf(row: ListingHit): string {
  return String(
    row.pricing_mode ?? row.listing_type ?? row.saleType ?? row.saleTypeDisplay ?? 'fixed',
  ).toLowerCase()
}

/** Ensure active browse grid shows fixed, OBO, and auction cards for contract screenshots. */
export async function ensureMarketplaceBrowseSaleMix(
  request: APIRequestContext,
  token: string,
): Promise<{ fixedId: string; oboId: string; auctionId: string }> {
  const headers = { Authorization: `Bearer ${token}`, 'X-RP-E2E-Contract': '1' }
  const rows = await getJsonWith429Retry<{ items?: ListingHit[] }>(
    request,
    '/api/listings/search?limit=50',
    headers,
    'browse sale mix',
  )
  const items = rows.items ?? []
  let fixedId =
    items.find((i) => saleModeOf(i).includes('fixed'))?.id ??
    (await createListingWithShipping(request, token, {
      title: `E2E Browse Fixed ${Date.now()}`,
      pricing_mode: 'fixed',
      price_cents: 4599,
      images: [PLACEHOLDER_A, PLACEHOLDER_B],
      amenities: ['sale_type:fixed'],
    }))

  let oboId = items.find((i) => saleModeOf(i).includes('obo'))?.id
  if (!oboId) {
    oboId = await createListingWithShipping(request, token, {
      title: `E2E Browse OBO ${Date.now()}`,
      pricing_mode: 'obo',
      price_cents: 6000,
      amenities: ['sale_type:obo', 'max_offer_attempts:5', 'allow_offers:true'],
    })
  }

  let auctionId = items.find((i) => saleModeOf(i).includes('auction'))?.id
  if (!auctionId) {
    const ends = new Date(Date.now() + 72 * 3_600_000).toISOString()
    auctionId = await createListingWithShipping(request, token, {
      title: `E2E Browse Auction ${Date.now()}`,
      pricing_mode: 'auction',
      price_cents: 399,
      amenities: [
        'sale_type:auction',
        'starting_bid_cents:399',
        'reserve_price_cents:1500',
        `auction_ends_at:${ends}`,
      ],
    })
  }

  return { fixedId, oboId, auctionId }
}
