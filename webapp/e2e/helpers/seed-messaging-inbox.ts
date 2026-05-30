import type { APIRequestContext } from '@playwright/test'

import {
  obtainAuthToken,
  obtainBuyerContractToken,
  obtainSellerContractToken,
} from './auth'
import { createListingWithShipping } from './listing-contract'
import { userIdFromJwt } from './messaging-contract'

/** Ensure Test Collector inbox has at least one thread for filter/search E2E. */
export async function ensureInboxThreadForFilters(
  request: APIRequestContext,
): Promise<{ listingTitle: string }> {
  const listingTitle = `Filter inbox seed ${Date.now()}`
  const token = await obtainAuthToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  const list = await request.get('/api/messages/conversations', { headers })
  if (list.ok()) {
    const body = (await list.json()) as unknown
    const count = Array.isArray(body)
      ? body.length
      : ((body as { items?: unknown[] })?.items?.length ?? 0)
    if (count > 0) {
      return { listingTitle: 'Filter' }
    }
  }

  const sellerToken = await obtainSellerContractToken(request)
  const sellerId = userIdFromJwt(sellerToken)
  if (!sellerId) throw new Error('seller contract user id missing from JWT')

  const listingId = await createListingWithShipping(request, sellerToken, {
    title: listingTitle,
  })
  const buyerToken = await obtainBuyerContractToken(request)
  const send = await request.post('/api/messages/send', {
    headers: { Authorization: `Bearer ${buyerToken}`, 'Content-Type': 'application/json' },
    data: {
      recipient_id: sellerId,
      message_type: 'direct',
      subject: `[listing:${listingId}] ${listingTitle}`,
      content: `Filter inbox seed ${Date.now()}`,
    },
  })
  if (!send.ok()) {
    throw new Error(`seed direct message failed ${send.status()}: ${(await send.text()).slice(0, 300)}`)
  }
  return { listingTitle }
}
