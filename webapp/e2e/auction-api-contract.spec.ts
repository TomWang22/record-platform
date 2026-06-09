import { test, expect } from '@playwright/test'

import { obtainBuyerContractToken, obtainSellerContractToken } from './helpers/auth'
import { createListingWithShipping, patchListingFields } from './helpers/listing-contract'

test.describe.configure({ timeout: 180_000 })

function auctionAmenities(endsAt: string) {
  return [
    'sale_type:auction',
    'starting_bid_cents:1500',
    'bid_increment_cents:100',
    'reserve_price_cents:1800',
    `auction_ends_at:${endsAt}`,
  ]
}

test.describe.serial('Auction API contract', () => {
  let listingId = ''

  test.beforeAll(async ({ request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    listingId = await createListingWithShipping(request, sellerToken, {
      title: `Auction API ${Date.now()}`,
    })
    const ends = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    await patchListingFields(request, sellerToken, listingId, {
      pricing_mode: 'auction',
      amenities: auctionAmenities(ends),
    })
  })

  test('GET auction state exposes public fields', async ({ request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    const res = await request.get(`/api/listings/${listingId}/auction/state`, {
      headers: { Authorization: `Bearer ${buyerToken}`, 'X-RP-E2E-Contract': '1' },
    })
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as Record<string, unknown>
    expect(body.currentBidCents).toBeGreaterThan(0)
    expect(body.bidCount).toBeGreaterThanOrEqual(0)
    expect(body.endsAt).toBeTruthy()
    expect(body.timeLeft).toBeTruthy()
    expect(body.reserveMet).toBeDefined()
    expect(body).not.toHaveProperty('proxyMaxCents')
  })

  test('seller cannot bid on own listing', async ({ request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    const res = await request.post(`/api/listings/${listingId}/auction/bids`, {
      headers: { Authorization: `Bearer ${sellerToken}`, 'X-RP-E2E-Contract': '1' },
      data: { amountCents: 2000 },
    })
    expect(res.status()).toBe(403)
  })

  test('bid below minimum rejected', async ({ request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    const res = await request.post(`/api/listings/${listingId}/auction/bids`, {
      headers: { Authorization: `Bearer ${buyerToken}`, 'X-RP-E2E-Contract': '1' },
      data: { amountCents: 1000 },
    })
    expect(res.status()).toBe(400)
  })

  test('buyer places manual bid', async ({ request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    const res = await request.post(`/api/listings/${listingId}/auction/bids`, {
      headers: { Authorization: `Bearer ${buyerToken}`, 'X-RP-E2E-Contract': '1' },
      data: { amountCents: 1600 },
    })
    expect(res.status()).toBe(201)
    const body = (await res.json()) as { bidCount: number; currentBidCents: number }
    expect(body.bidCount).toBeGreaterThanOrEqual(1)
    expect(body.currentBidCents).toBeGreaterThanOrEqual(1500)
  })

  test('bid history returns masked bidders without proxy max', async ({ request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    const res = await request.get(`/api/listings/${listingId}/auction/bids`, {
      headers: { Authorization: `Bearer ${buyerToken}`, 'X-RP-E2E-Contract': '1' },
    })
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as { items: Record<string, unknown>[] }
    expect(body.items.length).toBeGreaterThan(0)
    for (const item of body.items) {
      expect(item.bidderMasked).toBeTruthy()
      expect(item).not.toHaveProperty('maxBidCents')
      expect(item).not.toHaveProperty('proxyMax')
    }
  })
})
