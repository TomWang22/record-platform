import { test, expect } from '@playwright/test'

import { obtainAuthToken, signInWithContractApiToken } from './helpers/auth'
import { ensureTestCollection } from './helpers/seed-collection'
import {
  assertNoForbiddenContractStrings,
  capturePageContentScreenshot,
  contractScreenshotPath,
  waitForNoLoadingStates,
} from './helpers/screenshot-readiness'

test.describe.configure({ timeout: 180_000 })

test.describe('AI insights dashboard contract (T15.5A)', () => {
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const token = await obtainAuthToken(ctx.request)
    await ensureTestCollection(ctx.request, token)
    await ctx.close()
  })

  test('dashboard shows live AI cards with source_status and source_refs', async ({ page }) => {
    await signInWithContractApiToken(page)
    await page.goto('/insights', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByTestId('ai-insights-dashboard-ready')).toBeVisible({ timeout: 90_000 })
    await expect(page.getByTestId('ai-insight-rag-ready')).toBeVisible({ timeout: 90_000 })
    await expect(page.getByTestId('ai-insight-record-valuation-ready')).toBeVisible({ timeout: 90_000 })
    await expect(page.getByTestId('ai-insight-pricing-ready')).toBeVisible({ timeout: 90_000 })
    await expect(page.getByTestId('ai-insight-auction-risk-ready')).toBeVisible({ timeout: 90_000 })
    await expect(page.getByTestId('ai-insight-seller-summary-ready')).toBeVisible({ timeout: 90_000 })
    await expect(page.getByTestId('ai-insight-buyer-summary-ready')).toBeVisible({ timeout: 90_000 })

    const meta = page.getByTestId('ai-insight-meta-rag_query')
    await expect(meta).toBeVisible()
    await expect(meta.getByTestId('ai-insight-source-status')).toHaveText(/live|degraded/)
    await expect(meta.getByTestId('ai-insight-model-used')).not.toBeEmpty()
    await expect(meta.getByTestId('ai-insight-source-count')).not.toHaveText('0')

    await waitForNoLoadingStates(page, '/insights')
    await assertNoForbiddenContractStrings(page, 'ai insights dashboard')
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-ai-insights-dashboard.png'),
    )
  })
})
