import { test, expect } from '@playwright/test'

import { obtainAuthToken, signInWithContractApiToken } from './helpers/auth'
import {
  PLACEHOLDER_C,
  createTwoImageListing,
  fetchListingApi,
  waitForListingRevisions,
} from './helpers/listing-contract'
import {
  capturePageContentScreenshot,
  contractScreenshotPath,
} from './helpers/screenshot-readiness'
import { timed } from './helpers/seed-lean'

test.describe.configure({ timeout: 180_000 })

test.describe.serial('Listing media edit persistence (7.5R)', () => {
  let listingId = ''

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const token = await timed('auth', () => obtainAuthToken(ctx.request))
    listingId = await timed('listing/2img', () => createTwoImageListing(ctx.request, token))
    await ctx.close()
  })

  test.beforeEach(async ({ page }) => {
    await signInWithContractApiToken(page)
  })

  test('add, reorder primary, remove — detail and revisions reflect media', async ({
    page,
    request,
  }) => {
    const token = await obtainAuthToken(request)
    await page.goto(`/listings/${listingId}/edit`)
    await expect(page.getByTestId('listing-edit-ready')).toBeVisible({ timeout: 45_000 })

    await page.locator('#listing-edit-new-image').fill(PLACEHOLDER_C)
    await page.locator('[data-testid="listing-edit-media"] button', { hasText: /^Add$/ }).click()
    const thirdRadio = page.locator('[data-testid="listing-edit-media"] input[type="radio"]').nth(2)
    await thirdRadio.check()
    await page
      .locator('[data-testid="listing-edit-media"] button', { hasText: /remove/i })
      .first()
      .click()

    const save = page.waitForResponse(
      (res) =>
        res.request().method() === 'PATCH' &&
        res.url().includes(`/api/listings/${listingId}`) &&
        !res.url().includes('/media') &&
        res.status() < 400,
      { timeout: 60_000 },
    )
    await page.getByTestId('listing-edit-save').click()
    await save
    await page.waitForURL(new RegExp(`/listings/${listingId}$`), { timeout: 60_000 })
    await expect(page.getByTestId('listing-detail-ready')).toBeVisible({ timeout: 45_000 })

    const api = await fetchListingApi(request, token, listingId)
    const images = (api.images as string[]) ?? []
    expect(images[0]).toContain('rp-contract-c')
    expect(images.length).toBe(2)

    const primarySrc = await page
      .locator('[data-testid="listing-detail-ready"] img.aspect-square')
      .first()
      .getAttribute('src')
    expect(primarySrc ?? '').toContain('rp-contract-c')

    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-listing-detail-primary-media-updated.png'),
    )

    await page.goto(`/listings/${listingId}/edit`)
    await expect(page.getByTestId('listing-edit-ready')).toBeVisible({ timeout: 45_000 })
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
