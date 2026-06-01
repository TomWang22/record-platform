import type { APIRequestContext } from '@playwright/test'

import { obtainAuthToken, obtainSellerContractToken } from './auth'
import { createListingWithShipping } from './listing-contract'
import { userIdFromJwt } from './messaging-contract'

/** Ensure Test Collector inbox has at least one thread for filter/search E2E. */
export async function ensureInboxThreadForFilters(
  request: APIRequestContext,
): Promise<{ listingTitle: string }> {
  const listingTitle = `Filter inbox seed ${Date.now()}`
  const token = await obtainAuthToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  const sellerToken = await obtainSellerContractToken(request)
  const collectorId = userIdFromJwt(token)
  if (!collectorId) throw new Error('test collector user id missing from JWT')

  const listingId = await createListingWithShipping(request, sellerToken, {
    title: listingTitle,
  })
  const send = await request.post('/api/messages/send', {
    headers: { Authorization: `Bearer ${sellerToken}`, 'Content-Type': 'application/json' },
    data: {
      recipient_id: collectorId,
      message_type: 'direct',
      subject: `[listing:${listingId}] ${listingTitle}`,
      content: `Filter inbox seed ${Date.now()}`,
    },
  })
  if (!send.ok()) {
    throw new Error(`seed direct message failed ${send.status()}: ${(await send.text()).slice(0, 300)}`)
  }

  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    const inbox = await request.get('/api/messages/conversations', { headers })
    if (inbox.ok()) {
      const body = (await inbox.json()) as unknown
      const rows = Array.isArray(body)
        ? body
        : ((body as { conversations?: unknown[] }).conversations ?? [])
      if (rows.length > 0) return { listingTitle }
    }
    await new Promise((r) => setTimeout(r, 800))
  }
  throw new Error('inbox seed: collector conversations empty after direct message')
}
