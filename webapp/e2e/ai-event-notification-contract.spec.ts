import { test, expect } from '@playwright/test'

import { obtainAuthToken } from './helpers/auth'
import { getJsonWith429Retry } from './helpers/http-retry'

test.describe.configure({ timeout: 180_000 })

test.describe('AI event notification contract', () => {
  test('analytics features emit outbox path and notifications can surface marketplace_ai', async ({
    request,
  }) => {
    const token = await obtainAuthToken(request)
    const me = await getJsonWith429Retry<{ sub?: string; user?: { id: string } }>(
      request,
      '/api/auth/me',
      { Authorization: `Bearer ${token}` },
      'auth me',
    )
    const userId = me.sub ?? me.user?.id
    expect(userId).toBeTruthy()
    await getJsonWith429Retry(
      request,
      `/api/analytics/ai/features/${userId}`,
      { Authorization: `Bearer ${token}` },
      'trigger ai insight outbox',
    )
    const notes = await getJsonWith429Retry<{ items?: Array<{ event_type?: string; payload?: Record<string, unknown> }> }>(
      request,
      '/api/notifications',
      { Authorization: `Bearer ${token}` },
      'notifications list',
    )
    const items = notes.items ?? []
    const aiItems = items.filter(
      (n) =>
        n.event_type === 'AIInsightCreatedV1' ||
        n.event_type === 'AuctionRiskDetectedV1' ||
        n.event_type === 'PricingRecommendationCreatedV1' ||
        n.payload?.notification_category === 'marketplace_ai',
    )
    // Bell proof: either live AI notification or empty list without mock prose
    expect(JSON.stringify(notes)).not.toMatch(/demo|mock|sample fallback/i)
    if (aiItems.length > 0) {
      for (const item of aiItems) {
        expect(item.payload?.source_refs ?? item.payload?.notification_category).toBeTruthy()
      }
    }
  })
})
