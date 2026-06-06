import { test, expect } from '@playwright/test'

import { obtainAuthToken, signInWithContractApiToken } from './helpers/auth'
import { ensureTestCollection } from './helpers/seed-collection'
import {
  capturePageContentScreenshot,
  contractScreenshotPath,
} from './helpers/screenshot-readiness'
import { timed } from './helpers/seed-lean'

test.describe('Collection stats D3 contract (7.8)', () => {
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const token = await timed('auth', () => obtainAuthToken(ctx.request))
    await timed('records/seed', () => ensureTestCollection(ctx.request, token))
    await ctx.close()
  })

  test('D3 charts render on collection stats', async ({ page }) => {
    await signInWithContractApiToken(page)
    await page.goto('/profile/collection-stats')
    await expect(page.getByTestId('collection-stats-d3-ready')).toBeVisible({ timeout: 45_000 })
    await expect
      .poll(async () => page.getByTestId('collection-chart-acquisition').getAttribute('data-chart-rendered'))
      .toBe('true')
    await expect
      .poll(async () => page.getByTestId('collection-chart-spend').getAttribute('data-chart-rendered'))
      .toBe('true')
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-collection-stats-d3-clean.png'),
    )
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-collection-stats-d3-acquisition.png'),
    )
    await page.locator('[data-testid="collection-chart-spend"]').scrollIntoViewIfNeeded()
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-collection-stats-d3-spend.png'),
    )
  })
})
