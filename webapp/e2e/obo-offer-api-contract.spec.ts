import { test, expect } from '@playwright/test'

import {
  obtainBuyerContractToken,
  obtainSellerContractToken,
} from './helpers/auth'
import { createListingWithShipping, patchListingFields } from './helpers/listing-contract'

test.describe.configure({ timeout: 180_000 })

test.describe.serial('OBO offer API contract', () => {
  let listingId = ''
  let offerId = ''

  test.beforeAll(async ({ request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    listingId = await createListingWithShipping(request, sellerToken, {
      title: `OBO Offer API ${Date.now()}`,
    })
    await patchListingFields(request, sellerToken, listingId, {
      pricing_mode: 'obo',
      amenities: [
        'sale_type:obo',
        'max_offer_attempts:5',
        'allow_offers:true',
        'offer_expiration_hours:48',
        'min_offer_cents:1500',
      ],
    })
  })

  test('GET /api/listings/:id/offers/settings', async ({ request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    const res = await request.get(`/api/listings/${listingId}/offers/settings`, {
      headers: {
        Authorization: `Bearer ${buyerToken}`,
        'X-RP-E2E-Contract': '1',
      },
    })
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as Record<string, unknown>
    expect(body.oboEnabled).toBeTruthy()
    expect(body.maxAttempts).toBeGreaterThan(0)
    expect(body.minOfferDisplay).toBe('$15.00')
  })

  test('buyer cannot offer on own listing', async ({ request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    const res = await request.post(`/api/listings/${listingId}/offers`, {
      headers: {
        Authorization: `Bearer ${sellerToken}`,
        'X-RP-E2E-Contract': '1',
      },
      data: { amountCents: 2000 },
    })
    expect(res.status()).toBe(403)
  })

  test('offer below minimum rejected', async ({ request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    const res = await request.post(`/api/listings/${listingId}/offers`, {
      headers: {
        Authorization: `Bearer ${buyerToken}`,
        'X-RP-E2E-Contract': '1',
      },
      data: { amountCents: 1200 },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(String(body.error || '')).toMatch(/minimum/i)
  })

  test('buyer submits offer', async ({ request }) => {
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
  })

  test('seller inbox lists pending offer', async ({ request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    const res = await request.get('/api/offers/inbox', {
      headers: {
        Authorization: `Bearer ${sellerToken}`,
        'X-RP-E2E-Contract': '1',
      },
    })
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as { items?: { id?: string }[] }
    expect((body.items ?? []).some((i) => i.id === offerId)).toBeTruthy()
  })

  test('buyer sent lists submitted offer', async ({ request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    const res = await request.get('/api/offers/sent', {
      headers: {
        Authorization: `Bearer ${buyerToken}`,
        'X-RP-E2E-Contract': '1',
      },
    })
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as { items?: { id?: string }[] }
    expect((body.items ?? []).some((i) => i.id === offerId)).toBeTruthy()
  })

  test('seller accepts offer', async ({ request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    const res = await request.post(`/api/listings/${listingId}/offers/${offerId}/accept`, {
      headers: {
        Authorization: `Bearer ${sellerToken}`,
        'X-RP-E2E-Contract': '1',
      },
      data: {},
    })
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('accepted')
  })

  test('seller decline alias rejects competing offer listing', async ({ request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    const buyerToken = await obtainBuyerContractToken(request)
    const otherListing = await createListingWithShipping(request, sellerToken, {
      title: `OBO Decline ${Date.now()}`,
    })
    await patchListingFields(request, sellerToken, otherListing, {
      pricing_mode: 'obo',
      amenities: ['sale_type:obo', 'max_offer_attempts:3', 'allow_offers:true'],
    })
    const created = await request.post(`/api/listings/${otherListing}/offers`, {
      headers: { Authorization: `Bearer ${buyerToken}`, 'X-RP-E2E-Contract': '1' },
      data: { amountCents: 2100 },
    })
    expect(created.status()).toBe(201)
    const oid = String(((await created.json()) as { id: string }).id)
    const declined = await request.post(
      `/api/listings/${otherListing}/offers/${oid}/decline`,
      {
        headers: { Authorization: `Bearer ${sellerToken}`, 'X-RP-E2E-Contract': '1' },
        data: {},
      },
    )
    expect(declined.ok()).toBeTruthy()
    expect((await declined.json()).status).toBe('rejected')
  })
})
