import type { APIRequestContext } from '@playwright/test'

import { ensureContractFeedback } from './seed-feedback'
import { ensureMarketplaceSeed } from './seed-marketplace'
import { ensureTestCollection } from './seed-collection'
import { with429Retry } from './http-retry'

function decodeJwtSub(jwt: string): string {
  const payload = JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64').toString()) as {
    sub?: string
  }
  if (!payload.sub) throw new Error('JWT missing sub')
  return payload.sub
}

/** Seed listings, records, feedback for profile analytics contract pages. */
export async function ensureProfileAnalyticsSeed(
  request: APIRequestContext,
  token: string,
): Promise<{ listingId: string; soldListingId?: string; recordCount: number }> {
  await ensureTestCollection(request, token)
  const seed = await ensureMarketplaceSeed(request, token)

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const listingId = seed.fixedListingId ?? seed.listingIds[0]
  if (!listingId) throw new Error('profile analytics seed: no listing id')

  const userId = decodeJwtSub(token)
  await ensureContractFeedback(request, token, {
    listingId,
    sellerUserId: userId,
    buyerUserId: userId,
  }).catch((err) => {
    console.warn('[seed-profile-analytics] feedback seed skipped:', err)
  })

  if (seed.oboListingId) {
    await with429Retry('obo offer seed', () =>
      request.post(`/api/listings/${seed.oboListingId}/offers`, {
        headers,
        data: { amountCents: 4000, message: 'Analytics contract offer' },
      }),
    ).catch(() => {})
  }

  const records = await request.get('/api/records', { headers })
  const recordCount = records.ok() ? ((await records.json()) as unknown[]).length : 0

  return {
    listingId,
    soldListingId: seed.soldListingId,
    recordCount,
  }
}
