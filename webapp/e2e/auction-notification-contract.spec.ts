import { test, expect } from '@playwright/test'

import { obtainBuyerContractToken, obtainSellerContractToken } from './helpers/auth'
import { createListingWithShipping, patchListingFields } from './helpers/listing-contract'

test.describe.configure({ timeout: 180_000 })

test.describe('Auction notification contract', () => {
  test('BidPlaced notifies seller via Kafka consumer', async ({ request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    const buyerToken = await obtainBuyerContractToken(request)
    const listingId = await createListingWithShipping(request, sellerToken, {
      title: `Auction Notify ${Date.now()}`,
    })
    const ends = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    await patchListingFields(request, sellerToken, listingId, {
      pricing_mode: 'auction',
      amenities: [
        'sale_type:auction',
        'starting_bid_cents:1500',
        'bid_increment_cents:100',
        `auction_ends_at:${ends}`,
      ],
    })

    const bid = await request.post(`/api/listings/${listingId}/auction/bids`, {
      headers: { Authorization: `Bearer ${buyerToken}`, 'X-RP-E2E-Contract': '1' },
      data: { amountCents: 1600 },
    })
    expect(bid.status()).toBe(201)

    await expect
      .poll(
        async () => {
          const res = await request.get('/api/notifications', {
            headers: { Authorization: `Bearer ${sellerToken}`, 'X-RP-E2E-Contract': '1' },
          })
          if (!res.ok()) return 0
          const rows = ((await res.json()) as { items?: { event_type?: string }[] }).items ?? []
          return rows.filter((n) => n.event_type === 'BidPlaced').length
        },
        { timeout: 45_000 },
      )
      .toBeGreaterThan(0)
  })
})
