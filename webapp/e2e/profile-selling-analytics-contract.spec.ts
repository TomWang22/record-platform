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

test.describe('Profile selling analytics contract (T11.2)', () => {
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const token = await timed('auth', () => obtainAuthToken(ctx.request))
    await timed('profile-analytics/seed', () => ensureProfileAnalyticsSeed(ctx.request, token))
    await ctx.close()
  })

  test('seller analytics dashboard and D3 charts from live APIs', async ({ page, request }) => {
    const token = await obtainAuthToken(request)
    const mine = await request.get('/api/listings/mine', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(mine.ok()).toBeTruthy()
    const mineBody = await mine.text()
    expect(mineBody.toLowerCase()).not.toMatch(/\bdemo\b|\bmock\b|\bfallback\b/)

    await signInWithContractApiToken(page)
    await page.goto('/profile/selling')
    await expect(page.getByTestId('selling-page-ready')).toBeVisible({ timeout: 45_000 })
    await expect(
      page
        .getByTestId('seller-analytics-ready')
        .or(page.getByTestId('seller-analytics-empty-state')),
    ).toBeVisible({ timeout: 45_000 })
    await waitForNoLoadingStates(page, '/profile/selling')
    await expect(page.getByTestId('seller-analytics-summary')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByTestId('seller-analytics-d3-ready')).toBeVisible({ timeout: 45_000 })

    await expect
      .poll(async () => page.getByTestId('seller-chart-sales').getAttribute('data-chart-rendered'))
      .toMatch(/true|empty/)
    await expect
      .poll(async () => page.getByTestId('seller-chart-revenue').getAttribute('data-chart-rendered'))
      .toMatch(/true|empty/)

    await assertNoForbiddenContractStrings(page, 'seller analytics')

    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-profile-selling-analytics.png'),
    )

    await page.locator('[data-testid="seller-chart-revenue"]').scrollIntoViewIfNeeded()
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-profile-sales-revenue-d3.png'),
    )

    await page.locator('[data-testid="seller-chart-obo"]').scrollIntoViewIfNeeded()
    await expect
      .poll(async () => page.getByTestId('seller-chart-obo').getAttribute('data-chart-rendered'))
      .toMatch(/true|empty/)
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-profile-obo-analytics-d3.png'),
    )

    await page.locator('[data-testid="seller-chart-auction"]').scrollIntoViewIfNeeded()
    await expect
      .poll(async () => page.getByTestId('seller-chart-auction').getAttribute('data-chart-rendered'))
      .toMatch(/true|empty/)
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-profile-auction-analytics-d3.png'),
    )
  })
})
