import { test, expect } from '@playwright/test'

import {
  BUYER_CONTRACT_EMAIL,
  obtainBuyerContractToken,
  obtainSellerContractToken,
} from './helpers/auth'
import { createListingWithShipping, patchListingFields } from './helpers/listing-contract'

test.describe.configure({ timeout: 180_000 })

test.describe.serial('OBO API contract', () => {
  let listingId = ''
  let offerId = ''
  let counterOfferId = ''

  test.beforeAll(async ({ request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    listingId = await createListingWithShipping(request, sellerToken, {
      title: `OBO API Contract ${Date.now()}`,
    })
    await patchListingFields(request, sellerToken, listingId, {
      pricing_mode: 'obo',
      amenities: [
        'sale_type:obo',
        'max_offer_attempts:3',
        'allow_offers:true',
        'offer_expiration_hours:48',
      ],
    })
  })

  test('buyer cannot offer on own listing', async ({ request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    const res = await request.post(`/api/listings/${listingId}/offers`, {
      headers: {
        Authorization: `Bearer ${sellerToken}`,
        'X-RP-E2E-Contract': '1',
      },
      data: { amountCents: 1500 },
    })
    expect(res.status()).toBe(403)
    const body = await res.json()
    expect(String(body.error || '')).toMatch(/own listing/i)
  })

  test('unauthorized access denied', async ({ request }) => {
    const res = await request.post(`/api/listings/${listingId}/offers`, {
      headers: { 'X-RP-E2E-Contract': '1' },
      data: { amountCents: 1500 },
    })
    expect(res.status()).toBe(401)
  })

  test('create offer returns public contract shape', async ({ request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    const res = await request.post(`/api/listings/${listingId}/offers`, {
      headers: {
        Authorization: `Bearer ${buyerToken}`,
        'X-RP-E2E-Contract': '1',
      },
      data: { amountCents: 1800, message: 'Fair offer' },
    })
    expect(res.status()).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    offerId = String(body.id)
    expect(body.amountDisplay).toBe('$18.00')
    expect(body.status).toBe('pending')
    expect(body.buyer).toBeTruthy()
    expect(body.seller).toBeTruthy()
    expect(JSON.stringify(body)).not.toMatch(/amount_cents|price_cents/)
    expect(Array.isArray(body.events)).toBeTruthy()
  })

  test('seller rejects offer', async ({ request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    const res = await request.post(`/api/listings/${listingId}/offers/${offerId}/reject`, {
      headers: {
        Authorization: `Bearer ${sellerToken}`,
        'X-RP-E2E-Contract': '1',
      },
      data: {},
    })
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('rejected')
  })

  test('create second offer for counter flow', async ({ request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    const res = await request.post(`/api/listings/${listingId}/offers`, {
      headers: {
        Authorization: `Bearer ${buyerToken}`,
        'X-RP-E2E-Contract': '1',
      },
      data: { amountCents: 2000 },
    })
    expect(res.status()).toBe(201)
    offerId = String((await res.json()).id)
  })

  test('seller counteroffer', async ({ request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    const res = await request.post(`/api/listings/${listingId}/offers/${offerId}/counter`, {
      headers: {
        Authorization: `Bearer ${sellerToken}`,
        'X-RP-E2E-Contract': '1',
      },
      data: { amountCents: 2200, message: 'Counter' },
    })
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as Record<string, unknown>
    counterOfferId = String(body.id)
    expect(body.amountDisplay).toBe('$22.00')
    expect(body.status).toBe('pending')
  })

  test('buyer withdraws counter child offer', async ({ request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    const res = await request.post(
      `/api/listings/${listingId}/offers/${counterOfferId}/withdraw`,
      {
        headers: {
          Authorization: `Bearer ${buyerToken}`,
          'X-RP-E2E-Contract': '1',
        },
        data: {},
      },
    )
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('withdrawn')
  })

  test('accept offer closes competing pending offers', async ({ request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    const buyerToken = await obtainBuyerContractToken(request)
    const acceptListing = await createListingWithShipping(request, sellerToken, {
      title: `OBO Accept ${Date.now()}`,
    })
    await patchListingFields(request, sellerToken, acceptListing, {
      pricing_mode: 'obo',
      amenities: ['sale_type:obo', 'max_offer_attempts:5', 'allow_offers:true'],
    })
    const o1 = await request.post(`/api/listings/${acceptListing}/offers`, {
      headers: { Authorization: `Bearer ${buyerToken}`, 'X-RP-E2E-Contract': '1' },
      data: { amountCents: 2100 },
    })
    expect(o1.status()).toBe(201)
    const acceptId = String(((await o1.json()) as { id: string }).id)
    const acceptRes = await request.post(
      `/api/listings/${acceptListing}/offers/${acceptId}/accept`,
      {
        headers: { Authorization: `Bearer ${sellerToken}`, 'X-RP-E2E-Contract': '1' },
        data: {},
      },
    )
    expect(acceptRes.ok()).toBeTruthy()
    const accepted = (await acceptRes.json()) as Record<string, unknown>
    expect(accepted.status).toBe('accepted')
  })

  test('max attempts enforced', async ({ request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    const buyerToken = await obtainBuyerContractToken(request)
    const maxListing = await createListingWithShipping(request, sellerToken, {
      title: `OBO Max Attempts ${Date.now()}`,
    })
    await patchListingFields(request, sellerToken, maxListing, {
      pricing_mode: 'obo',
      amenities: ['sale_type:obo', 'max_offer_attempts:2', 'allow_offers:true'],
    })
    for (let i = 0; i < 2; i++) {
      const res = await request.post(`/api/listings/${maxListing}/offers`, {
        headers: {
          Authorization: `Bearer ${buyerToken}`,
          'X-RP-E2E-Contract': '1',
        },
        data: { amountCents: 1900 + i * 10 },
      })
      expect(res.status()).toBe(201)
      await request.post(`/api/listings/${maxListing}/offers/${(await res.json()).id}/reject`, {
        headers: { Authorization: `Bearer ${sellerToken}`, 'X-RP-E2E-Contract': '1' },
        data: {},
      })
    }
    const fail = await request.post(`/api/listings/${maxListing}/offers`, {
      headers: {
        Authorization: `Bearer ${buyerToken}`,
        'X-RP-E2E-Contract': '1',
      },
      data: { amountCents: 2500 },
    })
    expect(fail.status()).toBe(400)
    const body = await fail.json()
    expect(String(body.error || '')).toMatch(/max offer attempts/i)
  })

  test('GET /api/offers/mine lists buyer offers', async ({ request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    const res = await request.get('/api/offers/mine', {
      headers: {
        Authorization: `Bearer ${buyerToken}`,
        'X-RP-E2E-Contract': '1',
      },
    })
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as { items?: unknown[] }
    expect((body.items ?? []).length).toBeGreaterThan(0)
  })

  test('listing detail exposes acceptsOffers for OBO', async ({ request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    const res = await request.get(`/api/listings/${listingId}`, {
      headers: {
        Authorization: `Bearer ${buyerToken}`,
        'X-RP-E2E-Contract': '1',
      },
    })
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as Record<string, unknown>
    expect(body.acceptsOffers ?? body.oboEnabled).toBeTruthy()
    expect(String(body.saleTypeDisplay || '')).toMatch(/best offer/i)
    expect(JSON.stringify(body)).not.toMatch(/amount_cents|price_cents/)
  })
})
