import { test, expect } from '@playwright/test'

import { obtainAuthToken, signInWithContractApiToken } from './helpers/auth'
import {
  createListingWithShipping,
  patchListingFields,
  waitForListingRevisions,
} from './helpers/listing-contract'
import {
  capturePageContentScreenshot,
  contractScreenshotPath,
} from './helpers/screenshot-readiness'
import { assertNoStaleProductUi } from './helpers/stale-ui-guard'
import { timed } from './helpers/seed-lean'

test.describe.configure({ timeout: 120_000 })

test.describe.serial('Listing revisions readable contract (7.6)', () => {
  let listingId = ''

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const token = await timed('auth/login', () => obtainAuthToken(ctx.request))
    listingId = await timed('listing/create', () => createListingWithShipping(ctx.request, token))
    await ctx.close()
  })

  test.beforeEach(async ({ page }) => {
    await signInWithContractApiToken(page)
  })

  test('revisions are human-readable', async ({ page, request }) => {
    const token = await obtainAuthToken(request)
    const newTitle = `E2E Readable ${Date.now()}`
    await patchListingFields(request, token, listingId, {
      title: newTitle,
      price_cents: 4999,
    })
    await waitForListingRevisions(request, token, listingId, {
      minCount: 1,
      newestMatches: /title|price/i,
    })

    await page.goto(`/listings/${listingId}/revisions`)
    await expect(page.getByTestId('listing-revisions-ready')).toBeVisible({ timeout: 45_000 })
    const lines = page.locator('[data-testid="listing-revision-lines"]')
    await expect(lines.first()).toBeVisible({ timeout: 45_000 })
    const text = await lines.first().innerText()
    expect(text).not.toMatch(/"to"\s*:/)
    expect(text).not.toMatch(/"from"\s*:/)
    expect(text).toMatch(/Title:|Price:|Sale type/i)
    expect(text).not.toMatch(/residence_type/i)
    await assertNoStaleProductUi(page, 'revisions 7.6')
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-listing-revisions-human-readable.png'),
    )

    await page.goto(`/listings/${listingId}`)
    await expect(page.getByTestId('listing-detail-ready')).toBeVisible({ timeout: 45_000 })
    await page.getByTestId('listing-revision-panel').getByRole('button').click()
    await expect(page.getByTestId('listing-revision-panel-loaded')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('listing-revision-panel-loaded')).toContainText(/Title|Price|Sale/i)
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-listing-detail-revision-panel.png'),
    )
  })
})
