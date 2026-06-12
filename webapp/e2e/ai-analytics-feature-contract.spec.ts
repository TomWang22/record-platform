import { test, expect } from '@playwright/test'

import { obtainAuthToken } from './helpers/auth'
import { getJsonWith429Retry } from './helpers/http-retry'

test.describe.configure({ timeout: 180_000 })

test.describe('AI analytics feature pipeline contract', () => {
  test('GET /api/analytics/ai/features returns grounded features with source_refs', async ({ request }) => {
    const token = await obtainAuthToken(request)
    const me = await getJsonWith429Retry<{ sub?: string; user?: { id: string } }>(
      request,
      '/api/auth/me',
      { Authorization: `Bearer ${token}` },
      'auth me',
    )
    const userId = me.sub ?? me.user?.id
    expect(userId).toBeTruthy()
    const body = await getJsonWith429Retry<{
      feature_count: number
      features: { feature_group: string; source_refs: unknown[] }[]
      source_refs: unknown[]
      source_status: string
    }>(
      request,
      `/api/analytics/ai/features/${userId}`,
      { Authorization: `Bearer ${token}` },
      'analytics ai features',
    )
    expect(body.source_status).toBe('live')
    expect(body.source_refs.length).toBeGreaterThan(0)
    expect(body.feature_count).toBeGreaterThan(0)
    for (const f of body.features) {
      expect(f.feature_group).toBeTruthy()
    }
    expect(JSON.stringify(body)).not.toMatch(/demo|mock|sample fallback/i)
  })
})
