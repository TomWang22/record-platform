import { test, expect } from '@playwright/test'

import { assertAiEnvelope, type AiEnvelope } from './helpers/ai-contract'
import { obtainAuthToken } from './helpers/auth'
import { postJsonWith429Retry, getJsonWith429Retry } from './helpers/http-retry'
import { ensureMarketplaceSeed } from './helpers/seed-marketplace'

test.describe.configure({ timeout: 180_000 })

test.describe('AI auction risk monitor contract', () => {
  let auctionListingId = ''

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const request = ctx.request
    const token = await obtainAuthToken(request)
    const seed = await ensureMarketplaceSeed(request, token)
    auctionListingId = seed.auctionListingId ?? ''
    await ctx.close()
  })

  test('auction risk cites bid summaries and masks bidders', async ({ request }) => {
    const token = await obtainAuthToken(request)
    const discover = await postJsonWith429Retry<AiEnvelope>(
      request,
      '/api/ai/rag/query',
      { Authorization: `Bearer ${token}` },
      { question: 'auction bid summary', source_types: ['auction_bid_summary'] },
      'discover auction listing',
    )
    const listingId =
      discover.source_refs.find((r) => r.source_type === 'auction_bid_summary')?.source_id ??
      auctionListingId
    test.skip(!listingId, 'no auction summaries in corpus')

    const body = await postJsonWith429Retry<AiEnvelope>(
      request,
      '/api/ai/auctions/risk',
      { Authorization: `Bearer ${token}` },
      { listing_id: listingId },
      'auction risk',
    )
    assertAiEnvelope(body, { requireLive: true })
    expect(body.contract_id).toBe('auction_risk')
    expect(body.details?.bidder_masking).toMatch(/hash/i)
    expect(JSON.stringify(body)).not.toMatch(/max_bid_cents|proxy max/i)
    const signals = body.details?.signals
    if (Array.isArray(signals)) {
      for (const s of signals) {
        expect(s.code).toBeTruthy()
      }
    }
  })
})
