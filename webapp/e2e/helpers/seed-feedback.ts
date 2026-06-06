import type { APIRequestContext } from '@playwright/test'

import { with429Retry } from './http-retry'

/** Seed marketplace feedback via trust-service contract endpoint (requires TRUST_E2E_SEED=1). */
export async function ensureContractFeedback(
  request: APIRequestContext,
  token: string,
  opts: { listingId: string; sellerUserId: string; buyerUserId: string },
): Promise<string[]> {
  const res = await with429Retry('feedback seed-contract', () =>
    request.post('/api/feedback/seed-contract', {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: {
        listing_id: opts.listingId,
        seller_user_id: opts.sellerUserId,
        buyer_user_id: opts.buyerUserId,
      },
    }),
  )
  if (!res.ok()) {
    const body = await res.text()
    throw new Error(
      `feedback seed-contract failed ${res.status()}: ${body.slice(0, 300)} (trust-service needs TRUST_E2E_SEED=1)`,
    )
  }
  const body = (await res.json()) as { feedback_ids?: string[] }
  return body.feedback_ids ?? []
}
