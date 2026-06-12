import { test, expect } from '@playwright/test'

import { assertAiEnvelope, type AiEnvelope } from './helpers/ai-contract'
import { obtainSellerContractToken } from './helpers/auth'
import { getJsonWith429Retry } from './helpers/http-retry'
import { ensureLeanListing } from './helpers/seed-lean'

test.describe.configure({ timeout: 180_000 })

test.describe('AI OBO negotiation helper contract', () => {
  let listingId = ''

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const request = ctx.request
    const token = await obtainSellerContractToken(request)
    listingId = await ensureLeanListing(request, token)
    await ctx.close()
  })

  test('GET /api/ai/offer-insights returns OBO signals with source_refs', async ({ request }) => {
    test.skip(!listingId, 'no listing')
    const token = await obtainSellerContractToken(request)
    const body = await getJsonWith429Retry<AiEnvelope>(
      request,
      `/api/ai/offer-insights?listing_id=${listingId}`,
      { Authorization: `Bearer ${token}` },
      'offer insights',
    )
    assertAiEnvelope(body)
    const signals = body.details?.signals
    expect(Array.isArray(signals)).toBeTruthy()
    expect(JSON.stringify(body)).not.toMatch(/private message|negotiation thread/i)
  })
})
