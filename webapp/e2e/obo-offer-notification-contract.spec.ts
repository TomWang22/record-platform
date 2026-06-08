import { test, expect } from '@playwright/test'

import { obtainBuyerContractToken, obtainSellerContractToken } from './helpers/auth'
import { createListingWithShipping, patchListingFields } from './helpers/listing-contract'
import {
  pollAllNotificationsRead,
  pollUnreadNotifications,
} from './helpers/event-backed-notification'

test.describe.configure({ timeout: 180_000 })

test.describe.serial('OBO offer notification contract', () => {
  let listingId = ''

  test.beforeAll(async ({ request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    listingId = await createListingWithShipping(request, sellerToken, {
      title: `OBO Notify Offer ${Date.now()}`,
    })
    await patchListingFields(request, sellerToken, listingId, {
      pricing_mode: 'obo',
      amenities: ['sale_type:obo', 'max_offer_attempts:5', 'allow_offers:true'],
    })
  })

  test('OfferCreated notifies seller via Kafka consumer', async ({ request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    const buyerToken = await obtainBuyerContractToken(request)

    const offerRes = await request.post(`/api/listings/${listingId}/offers`, {
      headers: {
        Authorization: `Bearer ${buyerToken}`,
        'X-RP-E2E-Contract': '1',
      },
      data: { amountCents: 1750, message: 'Notify proof' },
    })
    expect(offerRes.status()).toBe(201)

    await pollUnreadNotifications(request, sellerToken, 1, {
      timeoutMs: 120_000,
    })

    const listRes = await request.get('/api/notifications', {
      headers: {
        Authorization: `Bearer ${sellerToken}`,
        'X-RP-E2E-Contract': '1',
      },
    })
    expect(listRes.ok()).toBeTruthy()
    const listBody = (await listRes.json()) as {
      items?: { event_type?: string; payload?: Record<string, unknown> }[]
    }
    const offerNote = (listBody.items ?? []).find((n) =>
      String(n.event_type || '').includes('Offer'),
    )
    expect(offerNote).toBeTruthy()
    const payload = offerNote?.payload ?? {}
    expect(payload.title).toBeTruthy()
    expect(String(payload.body || '')).not.toMatch(/[0-9a-f-]{36}/i)
    expect(payload.buyer_display ?? payload.seller_display).toBeTruthy()

    const readAll = await request.post('/api/notifications/read-all', {
      headers: {
        Authorization: `Bearer ${sellerToken}`,
        'X-RP-E2E-Contract': '1',
      },
      data: {},
    })
    expect(readAll.ok()).toBeTruthy()
    await pollAllNotificationsRead(request, sellerToken)
  })

  test('OfferAccepted notifies buyer', async ({ request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    const buyerToken = await obtainBuyerContractToken(request)
    const acceptListing = await createListingWithShipping(request, sellerToken, {
      title: `OBO Accept Notify ${Date.now()}`,
    })
    await patchListingFields(request, sellerToken, acceptListing, {
      pricing_mode: 'obo',
      amenities: ['sale_type:obo', 'max_offer_attempts:5', 'allow_offers:true'],
    })
    const created = await request.post(`/api/listings/${acceptListing}/offers`, {
      headers: { Authorization: `Bearer ${buyerToken}`, 'X-RP-E2E-Contract': '1' },
      data: { amountCents: 2200 },
    })
    expect(created.status()).toBe(201)
    const offerId = String(((await created.json()) as { id: string }).id)
    const accepted = await request.post(
      `/api/listings/${acceptListing}/offers/${offerId}/accept`,
      {
        headers: { Authorization: `Bearer ${sellerToken}`, 'X-RP-E2E-Contract': '1' },
        data: {},
      },
    )
    expect(accepted.ok()).toBeTruthy()

    await pollUnreadNotifications(request, buyerToken, 1, { timeoutMs: 120_000 })
    const listRes = await request.get('/api/notifications', {
      headers: { Authorization: `Bearer ${buyerToken}`, 'X-RP-E2E-Contract': '1' },
    })
    const listBody = (await listRes.json()) as {
      items?: { event_type?: string; payload?: Record<string, unknown> }[]
    }
    const acceptedNote = (listBody.items ?? []).find(
      (n) => n.event_type === 'OfferAccepted',
    )
    expect(acceptedNote).toBeTruthy()
    expect(acceptedNote?.payload?.deep_link).toBe('/cart')
  })
})
