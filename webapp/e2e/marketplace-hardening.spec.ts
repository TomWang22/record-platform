import { test, expect } from '@playwright/test'

import { signInAsTestCollector, signInAsTestCollectorWithSeed } from './helpers/auth'
import { assertNoStaleProductUi } from './helpers/stale-ui-guard'
import {
  captureBrowseResultsScreenshot,
  capturePageContentScreenshot,
  contractScreenshotPath,
  guestContractScreenshotPath,
  waitForFeedbackReady,
  waitForListingsReady,
  waitForProfileReady,
} from './helpers/screenshot-readiness'

test.describe('Marketplace hardening', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsTestCollector(page)
  })

  test('profile has no dev provider wording and clickable stats', async ({ page }) => {
    const { token } = await signInAsTestCollectorWithSeed(page)
    await waitForProfileReady(page, token)
    await assertNoStaleProductUi(page)
    await expect(page.getByText(/Signed in with/i)).toBeVisible()
    await expect(page.getByText(/Test account|Google|Discogs|Email/i)).toBeVisible()
    await page.getByRole('link').filter({ hasText: 'Records' }).first().click()
    await expect(page).toHaveURL(/\/records/)
    await waitForProfileReady(page, token)
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-profile-clickable-stats.png'),
    )
    await page.getByRole('link').filter({ hasText: 'Feedback score' }).first().click()
    await expect(page).toHaveURL(/\/profile\/feedback/)
  })

  test('marketplace browse grid and watchlist heart', async ({ page }) => {
    await signInAsTestCollectorWithSeed(page)
    await waitForListingsReady(page, 'grid')
    await assertNoStaleProductUi(page)
    await captureBrowseResultsScreenshot(
      page,
      contractScreenshotPath('authenticated-marketplace-browse-grid-polished.png'),
    )
    const heart = page
      .getByRole('button', { name: /add to watchlist|remove from watchlist/i })
      .first()
    await heart.click()
    await page.locator('button').filter({ hasText: /^list$/i }).first().click()
    await expect(page.locator('[data-testid="listing-row"]').first()).toBeVisible()
  })

  test('listing detail, edit, revisions when listing exists', async ({ page }) => {
    const { seed } = await signInAsTestCollectorWithSeed(page)
    const listingId = seed.fixedListingId ?? seed.listingIds[0]
    expect(listingId, 'seeded active listing required').toBeTruthy()
    await page.goto(`/listings/${listingId}`)
    await expect(page.getByTestId('listing-detail-ready')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByTestId('listing-revision-loading')).toHaveCount(0, { timeout: 30_000 })
    await expect(page.getByTestId('listing-revision-preview')).toBeVisible({ timeout: 30_000 })
    await assertNoStaleProductUi(page)
    await capturePageContentScreenshot(page, contractScreenshotPath('authenticated-listing-detail.png'))
    await page.goto(`/listings/${listingId}/edit`)
    await expect(page.getByTestId('listing-edit-ready')).toBeVisible({ timeout: 45_000 })
    await page.screenshot({
      path: contractScreenshotPath('authenticated-listing-edit.png'),
      fullPage: true,
    })
    await page.getByRole('link', { name: /view revisions/i }).click()
    await expect(page.getByTestId('listing-revisions-ready')).toBeVisible({ timeout: 45_000 })
    await page.screenshot({
      path: contractScreenshotPath('authenticated-listing-revisions.png'),
      fullPage: true,
    })
  })

  test('feedback D3 chart', async ({ page }) => {
    await waitForFeedbackReady(page)
    await expect(page.locator('svg[aria-label="Star rating distribution"]')).toBeVisible()
  })

  test('selling sold tab and notifications', async ({ page }) => {
    await page.goto('/profile/selling?status=sold')
    await page.screenshot({
      path: contractScreenshotPath('authenticated-profile-selling-sold.png'),
      fullPage: true,
    })
    await page.goto('/listings')
    await page.getByRole('button', { name: /Notifications/i }).click()
    await page.screenshot({
      path: contractScreenshotPath('notification-dropdown.png'),
    })
  })

  test('public profile', async ({ page }) => {
    await page.goto('/users/test-collector')
    await assertNoStaleProductUi(page)
    await page.screenshot({
      path: guestContractScreenshotPath('public-user-profile.png'),
      fullPage: true,
    })
  })
})
