import { test, expect } from '@playwright/test'

import { obtainBuyerContractToken, obtainSellerContractToken } from './helpers/auth'
import { createListingWithShipping, patchListingFields } from './helpers/listing-contract'

test.describe.configure({ timeout: 180_000 })

test.describe.serial('OBO offer cart reservation contract', () => {
  test('accepted offer reserves listing in buyer cart at agreed price', async ({ request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    const buyerToken = await obtainBuyerContractToken(request)
    const listingId = await createListingWithShipping(request, sellerToken, {
      title: `OBO Cart Reserve ${Date.now()}`,
    })
    await patchListingFields(request, sellerToken, listingId, {
      pricing_mode: 'obo',
      amenities: ['sale_type:obo', 'max_offer_attempts:5', 'allow_offers:true'],
    })

    const offerAmountCents = 2350
    const created = await request.post(`/api/listings/${listingId}/offers`, {
      headers: { Authorization: `Bearer ${buyerToken}`, 'X-RP-E2E-Contract': '1' },
      data: { amountCents: offerAmountCents, message: 'Cart reserve proof' },
    })
    expect(created.status()).toBe(201)
    const offerId = String(((await created.json()) as { id: string }).id)

    const accepted = await request.post(`/api/listings/${listingId}/offers/${offerId}/accept`, {
      headers: { Authorization: `Bearer ${sellerToken}`, 'X-RP-E2E-Contract': '1' },
      data: {},
    })
    expect(accepted.ok()).toBeTruthy()
    expect((await accepted.json()).status).toBe('accepted')

    const cartRes = await request.get('/api/cart', {
      headers: { Authorization: `Bearer ${buyerToken}`, 'X-RP-E2E-Contract': '1' },
    })
    expect(cartRes.ok()).toBeTruthy()
    const cart = (await cartRes.json()) as {
      items?: {
        item_id?: string
        listing_id?: string
        price?: number
        metadata?: { purchase_type?: string; offer_id?: string; amount_cents?: number }
      }[]
    }
    const hit = (cart.items ?? []).find(
      (i) =>
        String(i.listing_id || i.item_id) === listingId &&
        i.metadata?.purchase_type === 'best_offer' &&
        i.metadata?.offer_id === offerId,
    )
    expect(hit).toBeTruthy()
    expect(Number(hit?.price)).toBeCloseTo(offerAmountCents / 100, 2)
    expect(hit?.metadata?.amount_cents).toBe(offerAmountCents)
  })

  test('second accept on same listing is blocked after first acceptance', async ({ request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    const buyerToken = await obtainBuyerContractToken(request)
    const listingId = await createListingWithShipping(request, sellerToken, {
      title: `OBO Double Accept ${Date.now()}`,
    })
    await patchListingFields(request, sellerToken, listingId, {
      pricing_mode: 'obo',
      amenities: ['sale_type:obo', 'max_offer_attempts:5', 'allow_offers:true'],
    })

    const o1 = await request.post(`/api/listings/${listingId}/offers`, {
      headers: { Authorization: `Bearer ${buyerToken}`, 'X-RP-E2E-Contract': '1' },
      data: { amountCents: 2000 },
    })
    expect(o1.status()).toBe(201)
    const offer1 = String(((await o1.json()) as { id: string }).id)
    const accept1 = await request.post(`/api/listings/${listingId}/offers/${offer1}/accept`, {
      headers: { Authorization: `Bearer ${sellerToken}`, 'X-RP-E2E-Contract': '1' },
      data: {},
    })
    expect(accept1.ok()).toBeTruthy()

    const o2 = await request.post(`/api/listings/${listingId}/offers`, {
      headers: { Authorization: `Bearer ${buyerToken}`, 'X-RP-E2E-Contract': '1' },
      data: { amountCents: 2100 },
    })
    expect(o2.status()).toBe(409)
  })
})
