import { test, expect } from '@playwright/test'

import { obtainAuthToken, signInWithContractApiToken } from './helpers/auth'
import { ensureTestCollection } from './helpers/seed-collection'
import {
  assertNoForbiddenContractStrings,
  captureTestIdScreenshot,
  contractScreenshotPath,
  waitForNoLoadingStates,
} from './helpers/screenshot-readiness'

test.describe.configure({ timeout: 180_000 })

test.describe('AI record valuation UI contract (T15.5B)', () => {
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const token = await obtainAuthToken(ctx.request)
    await ensureTestCollection(ctx.request, token)
    await ctx.close()
  })

  test('record valuation panel cites source_refs from live API', async ({ page }) => {
    await signInWithContractApiToken(page)
    await page.goto('/insights?panel=valuation', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByTestId('ai-insight-record-valuation-ready')).toBeVisible({ timeout: 90_000 })

    const panel = page.getByTestId('ai-insight-record-valuation')
    await expect(panel.getByTestId('ai-insight-meta-record_valuation')).toBeVisible()
    await expect(panel.getByTestId('ai-insight-source-status')).toHaveText(/live|degraded/)
    await expect(panel.getByTestId('ai-source-ref-item').first()).toBeVisible()

    const body = await panel.innerText()
    expect(body).not.toMatch(/demo|mock|sample fallback/i)

    await waitForNoLoadingStates(page, 'record valuation')
    await assertNoForbiddenContractStrings(page, 'record valuation')
    await captureTestIdScreenshot(
      page,
      'ai-insight-record-valuation',
      contractScreenshotPath('authenticated-ai-record-valuation.png'),
    )
  })
})
