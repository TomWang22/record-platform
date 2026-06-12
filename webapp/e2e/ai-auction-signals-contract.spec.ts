import { test, expect } from '@playwright/test'

import { obtainAuthToken } from './helpers/auth'
import { getJsonWith429Retry } from './helpers/http-retry'

test.describe.configure({ timeout: 180_000 })

test.describe('AI auction-monitor signals contract', () => {
  test('GET /auctions/ai-signals returns at least 3 real signals', async ({ request }) => {
    const token = await obtainAuthToken(request)
    const body = await getJsonWith429Retry<{
      signal_count: number
      signals: Array<{
        signal_code: string
        source_refs: unknown[]
        detail?: string
      }>
      source_status: string
    }>(
      request,
      '/auctions/ai-signals?refresh=1',
      { Authorization: `Bearer ${token}` },
      'auction ai signals',
    )
    expect(body.signal_count).toBeGreaterThanOrEqual(3)
    expect(body.signals.length).toBeGreaterThanOrEqual(3)
    const codes = new Set(body.signals.map((s) => s.signal_code))
    expect(codes.size).toBeGreaterThanOrEqual(2)
    for (const s of body.signals) {
      expect(s.source_refs?.length ?? 0).toBeGreaterThan(0)
      expect(JSON.stringify(s)).not.toMatch(/max_bid_cents|proxy max/i)
    }
    expect(JSON.stringify(body)).not.toMatch(/demo|mock|sample fallback/i)
  })
})
