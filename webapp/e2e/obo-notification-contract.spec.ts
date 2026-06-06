import { test, expect } from '@playwright/test'

import { obtainBuyerContractToken, obtainSellerContractToken } from './helpers/auth'
import { createListingWithShipping, patchListingFields } from './helpers/listing-contract'
import {
  pollAllNotificationsRead,
  pollUnreadNotifications,
} from './helpers/event-backed-notification'

test.describe.configure({ timeout: 180_000 })

test.describe.serial('OBO notification contract', () => {
  let listingId = ''

  test.beforeAll(async ({ request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    listingId = await createListingWithShipping(request, sellerToken, {
      title: `OBO Notify ${Date.now()}`,
    })
    await patchListingFields(request, sellerToken, listingId, {
      pricing_mode: 'obo',
      amenities: ['sale_type:obo', 'max_offer_attempts:5', 'allow_offers:true'],
    })
  })

  test('OfferCreated notifies seller; read-all persists', async ({ request }) => {
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
      items?: { event_type?: string; read_at?: string | null }[]
    }
    const offerNote = (listBody.items ?? []).find((n) =>
      String(n.event_type || '').includes('Offer'),
    )
    expect(offerNote).toBeTruthy()

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
})
