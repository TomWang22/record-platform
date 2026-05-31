import { test, expect } from '@playwright/test'

import { obtainAuthToken, signInWithContractApiToken } from './helpers/auth'
import {
  createListingWithShipping,
  dumpListingContractDebug,
  waitForListingRevisions,
} from './helpers/listing-contract'
import { timed } from './helpers/seed-lean'
import { captureScreenshot } from './helpers/screenshot-readiness'
import { assertNoStaleProductUi } from './helpers/stale-ui-guard'

test.describe.configure({ timeout: 120_000 })

test.describe.serial('Listing detail / edit / revisions contract', () => {
  let listingId = ''

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const request = ctx.request
    const token = await timed('auth/login', () => obtainAuthToken(request))
    listingId = await timed('listing/create', () => createListingWithShipping(request, token))
    await ctx.close()
  })

  test.beforeEach(async ({ page }) => {
    await signInWithContractApiToken(page)
  })

  test('listing detail shows RP fields and image', async ({ page }) => {
    await page.goto(`/listings/${listingId}`)
    await expect(page.getByTestId('listing-detail-ready')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.locator('text=Listing not found')).toHaveCount(0)
    await assertNoStaleProductUi(page, 'listing detail')
    const body = await page.locator('body').innerText()
    expect(body).toMatch(/Format/)
    expect(body).not.toMatch(/Format:\s*apartment/i)
    expect(body).not.toMatch(/\bapartment\b/i)
    const listingImg = page
      .getByTestId('listing-detail-ready')
      .locator('img.aspect-square')
      .first()
    await expect(listingImg).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: /watchlist/i })).toBeVisible()
    await captureScreenshot(
      page,
      'e2e/screenshots/authenticated/authenticated-listing-detail-rp-fields.png',
    )
  })

  test('edit listing and verify revisions', async ({ page, request }) => {
    const token = await obtainAuthToken(request)
    const revised = `E2E Revised ${Date.now()}`
    await page.goto(`/listings/${listingId}/edit`)
    await expect(page.getByTestId('listing-edit-ready')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByTestId('listing-edit-save')).toBeEnabled({ timeout: 15_000 })
    const titleInput = page.getByTestId('listing-edit-ready').locator('input').first()
    await titleInput.fill(revised)
    const priceInput = page.getByTestId('listing-edit-ready').locator('input[type="number"]').first()
    if (await priceInput.isVisible()) {
      await priceInput.fill('49.99')
    }
    const saveResponse = page.waitForResponse(
      (r) =>
        r.request().method() === 'PATCH' &&
        r.url().includes(`/api/listings/${listingId}`) &&
        !r.url().includes('/status') &&
        !r.url().includes('/media') &&
        r.status() < 500,
      { timeout: 60_000 },
    )
    await page.getByTestId('listing-edit-save').click()
    const saveRes = await saveResponse
    const saveBody = await saveRes.text().catch(() => '')
    expect(saveRes.status(), saveBody).toBeLessThan(400)

    await waitForListingRevisions(request, token, listingId, {
      minCount: 1,
      newestMatches: /title|revised|price/i,
    })

    await captureScreenshot(
      page,
      'e2e/screenshots/authenticated/authenticated-listing-edit-rp-fields.png',
    )

    await page.goto(`/listings/${listingId}/revisions`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await expect(page.getByTestId('listing-revisions-ready')).toBeVisible({ timeout: 45_000 })
    const lines = page.locator('[data-testid="listing-revision-lines"]')
    await expect(lines.first()).toBeVisible({ timeout: 45_000 })
    const revText = await lines.first().innerText()
    expect(revText).toMatch(/Title|Price|Sale type|Listing updated|Gallery|Domestic shipping/i)
    expect(await page.locator('body').innerText()).not.toMatch(/residence_type/i)
    await assertNoStaleProductUi(page, 'listing revisions')
    await captureScreenshot(
      page,
      'e2e/screenshots/authenticated/authenticated-listing-revisions-readable.png',
    )
  })

  test.afterEach(async ({ request }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      const token = await obtainAuthToken(request).catch(() => '')
      if (token && listingId) {
        await dumpListingContractDebug(request, token, listingId, testInfo.title)
      }
    }
  })
})
