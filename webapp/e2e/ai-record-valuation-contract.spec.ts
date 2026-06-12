import { test, expect } from '@playwright/test'

import { assertAiEnvelope, type AiEnvelope } from './helpers/ai-contract'
import { obtainAuthToken } from './helpers/auth'
import { postJsonWith429Retry, getJsonWith429Retry } from './helpers/http-retry'
import { ensureTestCollection } from './helpers/seed-collection'

test.describe.configure({ timeout: 180_000 })

test.describe('AI record valuation contract', () => {
  let recordId = ''

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const request = ctx.request
    const token = await obtainAuthToken(request)
    await ensureTestCollection(request, token)
    const recs = await getJsonWith429Retry<{ id: string }[]>(
      request,
      '/api/records',
      { Authorization: `Bearer ${token}` },
      'records for valuation',
    )
    recordId = recs[0]?.id ?? ''
    await ctx.close()
  })

  test('record valuation cites record and comparables', async ({ request }) => {
    test.skip(!recordId, 'no record in collection')
    const token = await obtainAuthToken(request)
    const body = await postJsonWith429Retry<AiEnvelope>(
      request,
      '/api/ai/records/valuation',
      { Authorization: `Bearer ${token}` },
      { record_id: recordId, include_comps: true },
      'record valuation',
    )
    assertAiEnvelope(body)
    expect(body.contract_id).toBe('record_valuation')
    expect(body.details?.valuation_band).toBeTruthy()
  })
})
