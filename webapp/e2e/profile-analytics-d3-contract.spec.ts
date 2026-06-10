import { test, expect } from '@playwright/test'

import { obtainAuthToken, signInWithContractApiToken } from './helpers/auth'
import { ensureProfileAnalyticsSeed } from './helpers/seed-profile-analytics'
import {
  assertNoForbiddenContractStrings,
  capturePageContentScreenshot,
  contractScreenshotPath,
  waitForNoLoadingStates,
} from './helpers/screenshot-readiness'
import { timed } from './helpers/seed-lean'

test.describe('Profile analytics D3 umbrella contract (T11.2)', () => {
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const token = await timed('auth', () => obtainAuthToken(ctx.request))
    await timed('profile-analytics/seed', () => ensureProfileAnalyticsSeed(ctx.request, token))
    await ctx.close()
  })

  test('feedback star D3 and collection stats filters use API-backed data only', async ({
    page,
    request,
  }) => {
    const token = await obtainAuthToken(request)
    const feedback = await request.get('/api/feedback/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(feedback.ok()).toBeTruthy()
    const fbBody = await feedback.text()
    expect(fbBody.toLowerCase()).not.toMatch(/\bdemo\b|\bmock\b|\bfallback\b/)
    const summary = JSON.parse(fbBody) as {
      distribution?: { stars: number; count: number }[]
      totalReviews?: number
    }
    expect((summary.totalReviews ?? 0)).toBeGreaterThanOrEqual(0)

    await signInWithContractApiToken(page)

    await page.goto('/profile/feedback')
    await expect(
      page.getByTestId('feedback-page-ready').or(page.getByTestId('feedback-empty-state-ready')),
    ).toBeVisible({ timeout: 45_000 })
    await waitForNoLoadingStates(page, '/profile/feedback')
    await expect(page.getByTestId('feedback-chart')).toBeVisible()
    await assertNoForbiddenContractStrings(page, 'feedback stars')
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-profile-feedback-stars-d3.png'),
    )

    await page.goto('/profile/collection-stats')
    await expect(page.getByTestId('collection-stats-summary')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByTestId('collection-stats-date-filters')).toBeVisible({ timeout: 45_000 })
    await waitForNoLoadingStates(page, '/profile/collection-stats')
    await expect
      .poll(async () =>
        page.getByTestId('collection-chart-type').getAttribute('data-chart-rendered'),
      )
      .toBe('true')
    await assertNoForbiddenContractStrings(page, 'collection stats')
  })
})
