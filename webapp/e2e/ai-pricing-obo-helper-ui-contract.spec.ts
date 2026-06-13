import { test, expect } from '@playwright/test'

import { obtainSellerContractToken, signInWithSellerContractApiToken } from './helpers/auth'
import { ensureLeanListing } from './helpers/seed-lean'
import {
  assertNoForbiddenContractStrings,
  captureTestIdScreenshot,
  contractScreenshotPath,
  waitForNoLoadingStates,
} from './helpers/screenshot-readiness'

test.describe.configure({ timeout: 180_000 })

test.describe('AI pricing / OBO helper UI contract (T15.5B)', () => {
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const token = await obtainSellerContractToken(ctx.request)
    await ensureLeanListing(ctx.request, token)
    await ctx.close()
  })

  test('pricing and OBO panels cite source_refs without private message bodies', async ({ page }) => {
    await signInWithSellerContractApiToken(page)
    await page.goto('/insights?panel=pricing', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByTestId('ai-insight-pricing-ready')).toBeVisible({ timeout: 90_000 })
    await expect(page.getByTestId('ai-insight-pricing-obo-ready')).toBeVisible({ timeout: 90_000 })

    const pricing = page.getByTestId('ai-insight-pricing')
    await expect(pricing.getByTestId('ai-insight-meta-pricing_recommendation')).toBeVisible()
    await expect(pricing.getByTestId('ai-source-ref-item').first()).toBeVisible()

    const obo = page.getByTestId('ai-insight-pricing-obo')
    await expect(obo.getByTestId('ai-insight-meta-obo_helper')).toBeVisible()

    const body = await page.locator('body').innerText()
    expect(body).not.toMatch(/private message body|negotiation thread/i)
    expect(body).not.toMatch(/demo|mock|sample fallback/i)

    await waitForNoLoadingStates(page, 'pricing obo')
    await assertNoForbiddenContractStrings(page, 'pricing obo')
    await captureTestIdScreenshot(
      page,
      'ai-insight-pricing-obo',
      contractScreenshotPath('authenticated-ai-pricing-obo-helper.png'),
    )
  })
})
