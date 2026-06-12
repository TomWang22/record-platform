import { test, expect } from '@playwright/test'

import { assertAiEnvelope, type AiEnvelope } from './helpers/ai-contract'
import { obtainAuthToken, obtainSellerContractToken } from './helpers/auth'
import { postJsonWith429Retry } from './helpers/http-retry'
import { ensureTestCollection } from './helpers/seed-collection'

test.describe.configure({ timeout: 180_000 })

test.describe('AI seller/buyer profile summary contract', () => {
  test('seller summary cites listings and offer/auction docs', async ({ request }) => {
    const token = await obtainSellerContractToken(request)
    const body = await postJsonWith429Retry<AiEnvelope>(
      request,
      '/api/ai/seller/summary',
      { Authorization: `Bearer ${token}` },
      {},
      'seller summary',
    )
    assertAiEnvelope(body)
    expect(body.contract_id).toBe('seller_sales_summary')
    expect(body.details?.counts_by_source_type).toBeTruthy()
  })

  test('buyer collection summary cites records and acquisitions', async ({ request }) => {
    const token = await obtainAuthToken(request)
    await ensureTestCollection(request, token)
    const body = await postJsonWith429Retry<AiEnvelope>(
      request,
      '/api/ai/buyer/collection-summary',
      { Authorization: `Bearer ${token}` },
      {},
      'buyer collection summary',
    )
    assertAiEnvelope(body)
    expect(body.contract_id).toBe('buyer_collection_summary')
    expect(body.details?.record_count).toBeGreaterThanOrEqual(0)
    const recordRefs = body.source_refs.filter((r) => r.source_type === 'record')
    expect(recordRefs.length).toBeGreaterThan(0)
  })
})
