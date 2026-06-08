import { test, expect } from '@playwright/test'

import { obtainAuthToken, signInWithContractApiToken } from './helpers/auth'
import {
  PLACEHOLDER_C,
  createTwoImageListing,
  fetchListingApi,
  pollListingUntil,
  waitForListingRevisions,
} from './helpers/listing-contract'
import {
  capturePageContentScreenshot,
  contractScreenshotPath,
} from './helpers/screenshot-readiness'
import { timed } from './helpers/seed-lean'

test.describe.configure({ timeout: 180_000 })

test.describe.serial('Listing media edit persistence (7.5R)', () => {
  test.beforeEach(async ({ page }) => {
    await signInWithContractApiToken(page)
  })

  test('add, reorder primary, remove — detail and revisions reflect media', async ({
    page,
    request,
  }) => {
    const token = await obtainAuthToken(request)
    const listingId = await timed('listing/2img', () => createTwoImageListing(request, token))

    await page.goto(`/listings/${listingId}/edit`)
    await expect(page.getByTestId('listing-edit-ready')).toBeVisible({ timeout: 60_000 })
    const media = page.locator('[data-testid="listing-edit-media"]')
    await expect(media).toBeAttached()

    await page.locator('#listing-edit-new-image').fill(PLACEHOLDER_C)
    await media.getByRole('button', { name: /^Add$/ }).click()
    await expect(media.locator('input[type="radio"]')).toHaveCount(3)

    await media.locator('input[type="radio"]').nth(2).check()
    await media
      .locator('div.flex.gap-2.rounded-xl', {
        has: page.locator('img[src*="rp-contract-a"]'),
      })
      .getByRole('button', { name: 'Remove' })
      .click()
    await expect(media.locator('input[type="radio"]')).toHaveCount(2)

    const savePatch = page.waitForResponse(
      (res) => {
        const u = res.url()
        return (
          res.request().method() === 'PATCH' &&
          u.includes(`/api/listings/${listingId}`) &&
          !u.includes('/status') &&
          res.status() < 400
        )
      },
      { timeout: 120_000 },
    )
    await page.getByTestId('listing-edit-save').click()
    const patchRes = await savePatch
    expect(patchRes.ok(), `media PATCH failed: ${patchRes.status()}`).toBeTruthy()

    await pollListingUntil(request, token, listingId, {
      imageCount: 2,
      primaryIncludes: 'rp-contract-c',
    })

    const api = await fetchListingApi(request, token, listingId)
    const images = (api.images as string[]) ?? []
    expect(images).toHaveLength(2)
    expect(String(api.primaryImageUrl ?? images[0])).toContain('rp-contract-c')
    expect(images.some((u) => u.includes('rp-contract-b'))).toBeTruthy()
    expect(images.some((u) => u.includes('rp-contract-c'))).toBeTruthy()
    expect(images.some((u) => u.includes('rp-contract-a'))).toBeFalsy()

    await page.goto(`/listings/${listingId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('listing-detail-ready')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('listing-primary-image')).toBeVisible({ timeout: 30_000 })
    const primarySrc = await page.getByTestId('listing-primary-image').getAttribute('src')
    expect(primarySrc ?? '').toContain('rp-contract-c')
    await expect(page.getByTestId('listing-gallery-thumbnails').locator('button')).toHaveCount(2)

    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-listing-detail-primary-media-updated.png'),
    )

    await page.goto(`/listings/${listingId}/edit`)
    await expect(page.getByTestId('listing-edit-ready')).toBeVisible({ timeout: 60_000 })
    await pollListingUntil(request, token, listingId, {
      imageCount: 2,
      primaryIncludes: 'rp-contract-c',
    })
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-listing-edit-media-persisted.png'),
    )

    await waitForListingRevisions(request, token, listingId, {
      minCount: 1,
      newestMatches: /media_event|primary|image|gallery/i,
    })
    await page.goto(`/listings/${listingId}/revisions`)
    await expect(page.getByTestId('listing-revisions-ready')).toBeVisible({ timeout: 45_000 })
    const revLines = page.locator('[data-testid="listing-revision-lines"]')
    await expect(revLines.first()).toBeVisible({ timeout: 30_000 })
    const body = await revLines.first().innerText()
    expect(body).toMatch(/Image:|Primary image|Gallery:/i)
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-listing-revisions-media-readable.png'),
    )
  })
})
