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

test.describe('Profile purchases analytics contract (T11.2)', () => {
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const token = await timed('auth', () => obtainAuthToken(ctx.request))
    await timed('profile-analytics/seed', () => ensureProfileAnalyticsSeed(ctx.request, token))
    await ctx.close()
  })

  test('buyer purchases dashboard and purchase type D3 from live APIs', async ({ page, request }) => {
    const token = await obtainAuthToken(request)
    const records = await request.get('/api/records', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(records.ok()).toBeTruthy()
    const recordsBody = await records.text()
    expect(recordsBody.toLowerCase()).not.toMatch(/\bdemo\b|\bmock\b|\bfallback\b/)

    const purchases = await request.get('/api/history/purchases?limit=50', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(purchases.ok()).toBeTruthy()

    await signInWithContractApiToken(page)
    await page.goto('/profile/purchases')
    await expect(page.getByTestId('purchases-page-ready')).toBeVisible({ timeout: 45_000 })
    await expect(
      page
        .getByTestId('buyer-purchases-ready')
        .or(page.getByTestId('buyer-purchases-empty-state')),
    ).toBeVisible({ timeout: 45_000 })
    await waitForNoLoadingStates(page, '/profile/purchases')
    await expect(page.getByTestId('purchases-date-filters')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByTestId('buyer-purchases-summary')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByTestId('buyer-purchases-d3-ready')).toBeVisible({ timeout: 45_000 })

    await expect
      .poll(async () =>
        page.getByTestId('buyer-chart-purchase-type').getAttribute('data-chart-rendered'),
      )
      .toBe('true')

    await assertNoForbiddenContractStrings(page, 'purchases analytics')

    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-profile-purchases-analytics.png'),
    )

    await page.locator('[data-testid="buyer-chart-purchase-type"]').scrollIntoViewIfNeeded()
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-profile-purchase-type-d3.png'),
    )
  })
})
