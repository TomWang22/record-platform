import type { APIRequestContext } from '@playwright/test'

import { obtainAuthToken, obtainSellerContractToken } from './auth'
import { createListingWithShipping } from './listing-contract'
/** Ensure Test Collector inbox has at least one thread for filter/search E2E. */
export async function ensureInboxThreadForFilters(
  request: APIRequestContext,
): Promise<{ listingTitle: string }> {
  const listingTitle = `Filter inbox thread ${Date.now()}`
  const token = await obtainAuthToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  const sellerToken = await obtainSellerContractToken(request)

  const listingId = await createListingWithShipping(request, sellerToken, {
    title: listingTitle,
  })
  const start = await request.post('/api/messages/start', {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: {
      listing_id: listingId,
      initial_message: `Filter inbox thread ${Date.now()}`,
    },
  })
  if (!start.ok()) {
    throw new Error(`seed listing thread failed ${start.status()}: ${(await start.text()).slice(0, 300)}`)
  }

  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    const inbox = await request.get('/api/messages/conversations', { headers })
    if (inbox.ok()) {
      const body = (await inbox.json()) as unknown
      const rows = Array.isArray(body)
        ? body
        : ((body as { threads?: unknown[]; conversations?: unknown[] }).threads ??
          (body as { conversations?: unknown[] }).conversations ??
          [])
      if (rows.length > 0) return { listingTitle }
    }
    await new Promise((r) => setTimeout(r, 800))
  }
  throw new Error('inbox seed: collector conversations empty after direct message')
}
