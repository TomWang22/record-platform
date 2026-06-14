import { test, expect } from '@playwright/test'

import { obtainAuthToken, signInWithContractApiToken } from './helpers/auth'
import { ensureMarketplaceSeed } from './helpers/seed-marketplace'
import {
  assertNoForbiddenContractStrings,
  captureTestIdScreenshot,
  contractScreenshotPath,
  waitForAiInsightsDashboardSettled,
  waitForNoLoadingStates,
} from './helpers/screenshot-readiness'

test.describe.configure({ timeout: 180_000 })

test.describe('AI auction risk UI contract (T15.5C)', () => {
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const token = await obtainAuthToken(ctx.request)
    await ensureMarketplaceSeed(ctx.request, token)
    await ctx.close()
  })

  test('auction risk panel shows signal codes and masked bidder context only', async ({ page }) => {
    await signInWithContractApiToken(page)
    await page.goto('/insights?panel=auction', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByTestId('ai-insight-auction-risk-ready')).toBeVisible({ timeout: 90_000 })

    const panel = page.getByTestId('ai-insight-auction-risk')
    await expect(panel.getByTestId('ai-insight-meta-auction_risk')).toBeVisible()
    await expect(panel.getByTestId('ai-auction-context')).toBeVisible()
    await expect(panel.getByTestId('ai-auction-bidder-masked')).toBeVisible()

    const body = await page.locator('body').innerText()
    expect(body).not.toMatch(/max_bid_cents|proxy max/i)
    expect(body).not.toMatch(/demo|mock|sample fallback/i)

    await waitForAiInsightsDashboardSettled(page)
    await waitForNoLoadingStates(page, 'auction risk')
    await assertNoForbiddenContractStrings(page, 'auction risk')
    await captureTestIdScreenshot(
      page,
      'ai-insight-auction-risk',
      contractScreenshotPath('authenticated-ai-auction-risk-monitor.png'),
    )
  })
})
