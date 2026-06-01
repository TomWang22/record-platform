import type { APIRequestContext } from '@playwright/test'

import { getJsonWith429Retry } from './http-retry'
import { ensureTestCollection } from './seed-collection'

const PLACEHOLDER_IMAGE = 'https://picsum.photos/seed/rp-vinyl-catalog/400/400'

export type MarketplaceSeedResult = {
  recordIds: string[]
  listingIds: string[]
  fixedListingId?: string
  oboListingId?: string
  auctionListingId?: string
  soldListingId?: string
  watchedListingId?: string
  cartListingId?: string
}

function listingPayload(
  title: string,
  priceCents: number,
  pricingMode: 'fixed' | 'obo',
  extra?: Record<string, unknown>,
) {
  return {
    title,
    description: `E2E marketplace listing for ${title}.`,
    price_cents: priceCents,
    effective_from: '2026-05-01',
    effective_until: '2027-05-01',
    amenities: [
      'format:LP',
      'media_condition:VG+',
      'sleeve_condition:VG',
    ],
    pricing_mode: pricingMode,
    initial_status: 'active',
    images: [PLACEHOLDER_IMAGE],
    city: 'Brooklyn',
    state_or_province: 'NY',
    country: 'US',
    ...extra,
  }
}

export async function ensureMarketplaceSeed(
  request: APIRequestContext,
  token: string,
): Promise<MarketplaceSeedResult> {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }

  await ensureTestCollection(request, token)

  const records = await getJsonWith429Retry<{ id: string }[]>(
    request,
    '/api/records',
    headers,
    'marketplace seed records',
  )
  const recordIds = records.map((r) => r.id)

  let mine: { id: string; title?: string; status?: string }[] = []
  try {
    const mineBody = await getJsonWith429Retry<{ items?: { id: string; title?: string; status?: string }[] }>(
      request,
      '/api/listings/mine',
      headers,
      'marketplace seed listings mine',
    )
    mine = mineBody.items ?? []
  } catch {
    mine = []
  }

  const listingIds: string[] = mine.map((m) => m.id)
  const result: MarketplaceSeedResult = { recordIds, listingIds }

  async function createListing(body: Record<string, unknown>) {
    const res = await request.post('/api/listings/create', { headers, data: body })
    if (!res.ok()) {
      const text = await res.text()
      console.warn('[seed] create listing failed', res.status(), text.slice(0, 200))
      return null
    }
    const row = (await res.json()) as { id?: string }
    if (row.id) listingIds.push(row.id)
    return row.id ?? null
  }

  if (listingIds.length < 3) {
    result.fixedListingId =
      (await createListing(
        listingPayload('Miles Davis — Kind of Blue [VG+ LP]', 4500, 'fixed', {
          description: 'Classic Columbia pressing.\n\nPlays quiet.\n\nShips in mailer.',
        }),
      )) ?? undefined
    result.oboListingId =
      (await createListing(
        listingPayload('John Coltrane — Blue Train [NM LP]', 5200, 'obo'),
      )) ?? undefined
    result.auctionListingId =
      (await createListing(
        listingPayload('Art Blakey — Moanin [EX LP]', 3800, 'fixed', {
          pricing_mode: 'fixed',
        }),
      )) ?? undefined
  } else {
    result.fixedListingId = listingIds[0]
    result.oboListingId = listingIds[1]
    result.auctionListingId = listingIds[2]
  }

  if (!result.soldListingId) {
    const soldId = await createListing(
      listingPayload('Kenny Dorham — Quiet Kenny [SOLD]', 4100, 'fixed', {
        initial_status: 'active',
      }),
    )
    if (soldId) {
      await request.patch(`/api/listings/${soldId}/status`, {
        headers,
        data: { status: 'archived' },
      }).catch(() => {})
      result.soldListingId = soldId
      if (!listingIds.includes(soldId)) listingIds.push(soldId)
    }
  }

  const mineAfter = await request.get('/api/listings/mine', { headers })
  const itemsAfter = mineAfter.ok()
    ? ((await mineAfter.json()) as { items?: { id: string; status?: string }[] }).items ?? []
    : []
  const activeIds = itemsAfter
    .filter((m) => String(m.status ?? '').toLowerCase() === 'active')
    .map((m) => m.id)
  result.listingIds = [...new Set([...listingIds, ...itemsAfter.map((m) => m.id)])]
  if (activeIds.length > 0) {
    result.fixedListingId = activeIds[0]
    result.oboListingId = activeIds[1] ?? result.oboListingId
    result.auctionListingId = activeIds[2] ?? result.auctionListingId
  }
  result.watchedListingId = result.fixedListingId ?? result.listingIds[0]
  result.cartListingId = result.oboListingId ?? result.listingIds[0]

  if (result.watchedListingId) {
    await request.post('/api/shopping/watchlist', {
      headers,
      data: { itemType: 'listing', itemId: result.watchedListingId },
    }).catch(() => {})
  }

  if (result.cartListingId) {
    await request.post('/api/cart', {
      headers,
      data: { itemType: 'listing', itemId: result.cartListingId, quantity: 1 },
    }).catch(() => {})
  }

  console.info('[seed] marketplace', JSON.stringify(result))
  return result
}
