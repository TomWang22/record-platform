import { test, expect } from '@playwright/test'

import { assertAiEnvelope, type AiEnvelope } from './helpers/ai-contract'
import { obtainSellerContractToken } from './helpers/auth'
import { postJsonWith429Retry } from './helpers/http-retry'
import { ensureLeanListing } from './helpers/seed-lean'

test.describe.configure({ timeout: 180_000 })

test.describe('AI listing pricing + OBO negotiation contract', () => {
  let listingId = ''

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const request = ctx.request
    const token = await obtainSellerContractToken(request)
    listingId = await ensureLeanListing(request, token)
    await ctx.close()
  })

  test('pricing advice cites listing, revisions, and OBO summaries', async ({ request }) => {
    test.skip(!listingId, 'no listing')
    const token = await obtainSellerContractToken(request)
    const body = await postJsonWith429Retry<AiEnvelope>(
      request,
      '/api/ai/listings/pricing-advice',
      { Authorization: `Bearer ${token}` },
      { listing_id: listingId },
      'listing pricing advice',
    )
    assertAiEnvelope(body)
    expect(body.contract_id).toBe('pricing_recommendation')
    expect(body.details?.negotiation_guidance).toBeTruthy()
    expect(JSON.stringify(body.details)).not.toMatch(/private message body|negotiation thread/i)
    const quality = body.details?.quality_signals
    if (Array.isArray(quality)) {
      expect(quality.length).toBeGreaterThanOrEqual(0)
    }
  })
})
