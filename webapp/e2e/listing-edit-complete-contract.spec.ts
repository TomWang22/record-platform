import { test, expect } from '@playwright/test'

import { obtainAuthToken, signInWithContractApiToken } from './helpers/auth'
import { createListingWithShipping, waitForListingField } from './helpers/listing-contract'
import { timed } from './helpers/seed-lean'
import {
  capturePageContentScreenshot,
  contractScreenshotPath,
} from './helpers/screenshot-readiness'
import { assertNoStaleProductUi } from './helpers/stale-ui-guard'

test.describe.configure({ timeout: 180_000 })

test.describe.serial('Listing edit complete contract (7.5)', () => {
  test.beforeEach(async ({ page }) => {
    await signInWithContractApiToken(page)
  })

  test('edit media, shipping, fixed → OBO → auction', async ({ page, request }) => {
    const token = await obtainAuthToken(request)
    const listingId = await timed('listing/create', () =>
      createListingWithShipping(request, token, { title: `E2E Edit Complete ${Date.now()}` }),
    )
    await waitForListingField(request, token, listingId, (row) => Boolean(row.id))
    await page.goto(`/listings/${listingId}/edit`)
    await expect(page.getByTestId('listing-edit-ready')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByTestId('listing-edit-media')).toBeVisible()
    await expect(page.getByTestId('listing-edit-shipping')).toBeVisible()
    await page.locator('[data-testid="listing-edit-shipping"] input').nth(2).fill('Ground Advantage')
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-listing-edit-media-shipping.png'),
    )

    await page.locator('[data-testid="listing-edit-sale-mode"] select').selectOption('obo')
    await expect(page.getByTestId('listing-edit-obo')).toBeVisible()
    await page.locator('[data-testid="listing-edit-obo"] input').first().fill('5')
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-listing-edit-obo-settings.png'),
    )
    const saveObo = page.waitForResponse(
      (res) => {
        const u = res.url()
        return (
          res.request().method() === 'PATCH' &&
          u.includes(`/api/listings/${listingId}`) &&
          !u.includes('/status') &&
          res.status() < 400
        )
      },
      { timeout: 45_000 },
    )
    await page.getByRole('button', { name: /save changes/i }).click()
    const oboPatch = await saveObo
    expect(oboPatch.ok(), `OBO PATCH failed: ${oboPatch.status()}`).toBeTruthy()
    const oboBody = await (await oboPatch).json() as { id?: string }
    expect(oboBody.id).toBe(listingId)
    await page.goto(`/listings/${listingId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('listing-detail-ready')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('listing-shipping-card').getByText('OBO')).toBeVisible()
    await assertNoStaleProductUi(page, 'listing obo detail')

    await page.goto(`/listings/${listingId}/edit`)
    await expect(page.getByTestId('listing-edit-ready')).toBeVisible({ timeout: 45_000 })
    await page.locator('[data-testid="listing-edit-sale-mode"] select').selectOption('auction')
    await expect(page.getByTestId('listing-edit-auction')).toBeVisible()
    const ends = new Date(Date.now() + 48 * 3600 * 1000).toISOString().slice(0, 16)
    await page.locator('[data-testid="listing-edit-auction"] input[type="datetime-local"]').last().fill(ends)
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-listing-edit-auction-settings.png'),
    )
    const saveAuction = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/listings/${listingId}`) &&
        res.request().method() === 'PATCH' &&
        res.status() < 400,
      { timeout: 45_000 },
    )
    await page.getByRole('button', { name: /save changes/i }).click()
    const auctionPatch = await saveAuction
    expect(auctionPatch.ok(), `auction PATCH failed: ${auctionPatch.status()}`).toBeTruthy()
    await page.goto(`/listings/${listingId}`)
    await expect(page.getByTestId('listing-detail-ready')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByTestId('listing-shipping-card').getByText('Auction')).toBeVisible({
      timeout: 15_000,
    })
  })
})
