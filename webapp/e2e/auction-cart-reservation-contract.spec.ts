import { test, expect } from '@playwright/test'

import {
  obtainBidder2ContractToken,
  obtainBuyerContractToken,
  obtainSellerContractToken,
} from './helpers/auth'
import { createListingWithShipping, patchListingFields } from './helpers/listing-contract'

test.describe.configure({ timeout: 180_000 })

test.describe.serial('Auction cart reservation contract', () => {
  test('winner gets auction_win cart item on close', async ({ request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    const winnerToken = await obtainBuyerContractToken(request)
    const loserToken = await obtainBidder2ContractToken(request)
    const listingId = await createListingWithShipping(request, sellerToken, {
      title: `Auction Cart ${Date.now()}`,
    })
    const ends = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    await patchListingFields(request, sellerToken, listingId, {
      pricing_mode: 'auction',
      amenities: [
        'sale_type:auction',
        'starting_bid_cents:2000',
        'bid_increment_cents:100',
        'reserve_price_cents:2200',
        `auction_ends_at:${ends}`,
      ],
    })

    const b1 = await request.post(`/api/listings/${listingId}/auction/bids`, {
      headers: { Authorization: `Bearer ${winnerToken}`, 'X-RP-E2E-Contract': '1' },
      data: { amountCents: 2200 },
    })
    expect(b1.status()).toBe(201)

    const b2 = await request.post(`/api/listings/${listingId}/auction/bids`, {
      headers: { Authorization: `Bearer ${loserToken}`, 'X-RP-E2E-Contract': '1' },
      data: { amountCents: 2300 },
    })
    expect(b2.status()).toBe(201)

    const b3 = await request.post(`/api/listings/${listingId}/auction/bids`, {
      headers: { Authorization: `Bearer ${winnerToken}`, 'X-RP-E2E-Contract': '1' },
      data: { amountCents: 2500 },
    })
    expect(b3.status()).toBe(201)

    const closed = await request.post(`/api/listings/${listingId}/auction/close?force=1`, {
      headers: { Authorization: `Bearer ${sellerToken}`, 'X-RP-E2E-Contract': '1' },
      data: { force: true },
    })
    expect(closed.ok()).toBeTruthy()

    const cartRes = await request.get('/api/cart', {
      headers: { Authorization: `Bearer ${winnerToken}`, 'X-RP-E2E-Contract': '1' },
    })
    expect(cartRes.ok()).toBeTruthy()
    const cart = (await cartRes.json()) as {
      items?: { listing_id?: string; item_id?: string; metadata?: { purchase_type?: string } }[]
    }
    const hit = (cart.items ?? []).find(
      (i) =>
        String(i.listing_id || i.item_id) === listingId &&
        i.metadata?.purchase_type === 'auction_win',
    )
    expect(hit).toBeTruthy()

    const loserCart = await request.get('/api/cart', {
      headers: { Authorization: `Bearer ${loserToken}`, 'X-RP-E2E-Contract': '1' },
    })
    const loserItems = ((await loserCart.json()) as { items?: unknown[] }).items ?? []
    const loserHit = loserItems.find(
      (i) =>
        typeof i === 'object' &&
        i &&
        String((i as { listing_id?: string }).listing_id || (i as { item_id?: string }).item_id) ===
          listingId,
    )
    expect(loserHit).toBeFalsy()
  })
})
