import { test, expect } from '@playwright/test'

import {
  obtainBidder2ContractToken,
  obtainBidder3ContractToken,
  obtainBuyerContractToken,
  obtainSellerContractToken,
} from './helpers/auth'
import { createListingWithShipping, patchListingFields } from './helpers/listing-contract'

test.describe.configure({ timeout: 180_000 })

test.describe.serial('Auction proxy bid contract (3 bidders)', () => {
  let listingId = ''

  test.beforeAll(async ({ request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    listingId = await createListingWithShipping(request, sellerToken, {
      title: `Auction Proxy ${Date.now()}`,
    })
    const ends = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    await patchListingFields(request, sellerToken, listingId, {
      pricing_mode: 'auction',
      amenities: [
        'sale_type:auction',
        'starting_bid_cents:1000',
        'bid_increment_cents:100',
        'reserve_price_cents:1500',
        `auction_ends_at:${ends}`,
      ],
    })
  })

  test('bidder A opens with proxy max $50', async ({ request }) => {
    const token = await obtainBuyerContractToken(request)
    const res = await request.post(`/api/listings/${listingId}/auction/bids`, {
      headers: { Authorization: `Bearer ${token}`, 'X-RP-E2E-Contract': '1' },
      data: { useProxy: true, maxBidCents: 5000 },
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.currentBidCents).toBe(1000)
    expect(body.bidCount).toBe(1)
  })

  test('bidder B proxy max $35 raises price to $36; A still winning', async ({ request }) => {
    const token = await obtainBidder2ContractToken(request)
    const res = await request.post(`/api/listings/${listingId}/auction/bids`, {
      headers: { Authorization: `Bearer ${token}`, 'X-RP-E2E-Contract': '1' },
      data: { useProxy: true, maxBidCents: 3500 },
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.currentBidCents).toBe(3600)
    expect(body.bidCount).toBeGreaterThanOrEqual(2)
  })

  test('bidder C proxy max $60 wins at $51', async ({ request }) => {
    const token = await obtainBidder3ContractToken(request)
    const res = await request.post(`/api/listings/${listingId}/auction/bids`, {
      headers: { Authorization: `Bearer ${token}`, 'X-RP-E2E-Contract': '1' },
      data: { useProxy: true, maxBidCents: 6000 },
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.currentBidCents).toBe(5100)
    expect(body.reserveMet).toBe(true)
  })

  test('history includes proxy_auto increments', async ({ request }) => {
    const token = await obtainBuyerContractToken(request)
    const res = await request.get(`/api/listings/${listingId}/auction/bids`, {
      headers: { Authorization: `Bearer ${token}`, 'X-RP-E2E-Contract': '1' },
    })
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as { items: { bidSource: string }[] }
    expect(body.items.some((i) => i.bidSource === 'proxy_auto')).toBeTruthy()
  })
})
