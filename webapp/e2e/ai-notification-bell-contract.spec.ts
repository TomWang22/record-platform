import { test, expect } from '@playwright/test'

import { obtainAuthToken, signInWithContractApiToken } from './helpers/auth'
import { getJsonWith429Retry } from './helpers/http-retry'
import {
  assertNoForbiddenContractStrings,
  capturePageContentScreenshot,
  contractScreenshotPath,
  waitForNoLoadingStates,
} from './helpers/screenshot-readiness'

test.describe.configure({ timeout: 180_000 })

test.describe('AI notification bell contract (T15.5D)', () => {
  test('marketplace_ai notifications deep-link to insights surfaces', async ({ page, request }) => {
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

    await signInWithContractApiToken(page)
    await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/api/notifications') && res.status() === 200,
        { timeout: 90_000 },
      ),
      page.goto('/dashboard', { waitUntil: 'domcontentloaded' }),
    ])
    await expect(page.getByTestId('notification-dropdown')).toBeVisible({ timeout: 30_000 })

    const notes = await getJsonWith429Retry<{ items?: Array<{ event_type?: string; payload?: Record<string, unknown> }> }>(
      request,
      '/api/notifications',
      { Authorization: `Bearer ${token}` },
      'notifications list',
    )
    const aiItems = (notes.items ?? []).filter(
      (n) =>
        n.event_type === 'AIInsightCreatedV1' ||
        n.event_type === 'AuctionRiskDetectedV1' ||
        n.event_type === 'PricingRecommendationCreatedV1' ||
        n.payload?.notification_category === 'marketplace_ai',
    )

    await page.getByTestId('notification-dropdown').click()
    await expect(page.getByTestId('notification-dropdown-panel')).toBeVisible()
    await expect(page.getByTestId('notification-dropdown-panel').getByText(/^Loading/)).toHaveCount(0, {
      timeout: 60_000,
    })

    if (aiItems.length > 0) {
      const aiLink = page.locator('[data-testid="notification-item"] a[href*="/insights"]')
      await expect(aiLink.first()).toBeVisible({ timeout: 30_000 })
      const href = await aiLink.first().getAttribute('href')
      expect(href).toMatch(/\/insights/)
    }

    await waitForNoLoadingStates(page, 'notification bell')
    await assertNoForbiddenContractStrings(page, 'notification bell')
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-ai-notification-bell.png'),
    )
  })
})
