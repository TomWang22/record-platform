import { test, expect } from '@playwright/test'

import {
  obtainAuthToken,
  obtainSellerContractToken,
  signInWithContractApiToken,
  signInWithSellerContractApiToken,
} from './helpers/auth'
import { ensureTestCollection } from './helpers/seed-collection'
import {
  assertNoForbiddenContractStrings,
  captureTestIdScreenshot,
  contractScreenshotPath,
  waitForAiInsightsDashboardSettled,
  waitForNoLoadingStates,
} from './helpers/screenshot-readiness'

test.describe.configure({ timeout: 180_000 })

test.describe('AI profile summaries UI contract (T15.5D)', () => {
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const buyerToken = await obtainAuthToken(ctx.request)
    await ensureTestCollection(ctx.request, buyerToken)
    await obtainSellerContractToken(ctx.request)
    await ctx.close()
  })

  test('seller summary panel shows grounded insight with source_refs', async ({ page }) => {
    await signInWithSellerContractApiToken(page)
    await page.goto('/insights?panel=seller', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByTestId('ai-insight-seller-summary-ready')).toBeVisible({ timeout: 90_000 })

    const panel = page.getByTestId('ai-insight-seller-summary')
    await expect(panel.getByTestId('ai-insight-meta-seller_sales_summary')).toBeVisible()
    await expect(panel.getByTestId('ai-insight-source-status')).toHaveText(/live|degraded/)

    await waitForAiInsightsDashboardSettled(page)
    await waitForNoLoadingStates(page, 'seller summary')
    await assertNoForbiddenContractStrings(page, 'seller summary')
    await captureTestIdScreenshot(
      page,
      'ai-insight-seller-summary',
      contractScreenshotPath('authenticated-ai-seller-summary.png'),
    )
  })

  test('buyer collection summary panel cites record source_refs', async ({ page }) => {
    await signInWithContractApiToken(page)
    await page.goto('/insights?panel=buyer', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByTestId('ai-insight-buyer-summary-ready')).toBeVisible({ timeout: 90_000 })

    const panel = page.getByTestId('ai-insight-buyer-summary')
    await expect(panel.getByTestId('ai-insight-meta-buyer_collection_summary')).toBeVisible()
    await expect(panel.getByTestId('ai-source-ref-item').first()).toBeVisible()

    await waitForNoLoadingStates(page, 'buyer summary')
    await assertNoForbiddenContractStrings(page, 'buyer summary')
    await captureTestIdScreenshot(
      page,
      'ai-insight-buyer-summary',
      contractScreenshotPath('authenticated-ai-buyer-summary.png'),
    )
  })
})
