import { test, expect } from '@playwright/test'

import { obtainAuthToken, signInAsTestCollector, signInAsTestCollectorWithSeed } from './helpers/auth'
import { getJsonWith429Retry } from './helpers/http-retry'
import { ensureTestCollection } from './helpers/seed-collection'
import { ensureContractFeedback } from './helpers/seed-feedback'
import { ensureWatchlistContains, pollRecentlyViewedIds } from './helpers/seed-lean'
import {
  captureScreenshot,
  contractScreenshotPath,
  guestContractScreenshotPath,
  capturePageContentScreenshot,
  waitForFeedbackReady,
  waitForListingsReady,
  waitForProfileReady,
  waitForRecordsReady,
  waitForSellingReady,
  waitForWatchlistCard,
} from './helpers/screenshot-readiness'
import { assertNoStaleProductUi } from './helpers/stale-ui-guard'

test.describe('Marketplace filled screenshots', () => {
  test.describe.configure({ timeout: 180_000 })

  test.beforeEach(async ({ page }) => {
    await signInAsTestCollector(page)
  })

  test('records grid list compact filled', async ({ page }) => {
    const { token } = await signInAsTestCollectorWithSeed(page)
    await ensureTestCollection(page.request, token)
    await getJsonWith429Retry<unknown[]>(
      page.request,
      '/api/records',
      { Authorization: `Bearer ${token}`, 'X-RP-E2E-Contract': '1' },
      'records filled gate',
    )
    for (const view of ['grid', 'list', 'compact'] as const) {
      await waitForRecordsReady(page, view, token)
      await assertNoStaleProductUi(page)
      await capturePageContentScreenshot(
        page,
        contractScreenshotPath(`authenticated-records-${view}-media-filled.png`),
      )
    }
    await page.goto('/records?view=grid')
    await waitForRecordsReady(page, 'grid', token)
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-records-lifecycle-dates.png'),
    )
  })

  test('marketplace grid list compact filled', async ({ page }) => {
    const token = await obtainAuthToken(page.request)
    const search = await getJsonWith429Retry<{ items?: unknown[] }>(
      page.request,
      '/api/listings/search?limit=5',
      { Authorization: `Bearer ${token}`, 'X-RP-E2E-Contract': '1' },
      'listings filled gate',
    )
    expect((search.items ?? []).length).toBeGreaterThan(0)
    for (const view of ['grid', 'list', 'compact'] as const) {
      await waitForListingsReady(page, view)
      await assertNoStaleProductUi(page)
      await capturePageContentScreenshot(
        page,
        contractScreenshotPath('authenticated-marketplace-browse-product-cards.png'),
      )
    }
  })

  test('profile selling feedback cart watchlist recently viewed', async ({ page }) => {
    const { token, seed } = await signInAsTestCollectorWithSeed(page)

    await waitForProfileReady(page, token!)
    await assertNoStaleProductUi(page)
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-profile-complete-stats.png'),
    )
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-profile-clickable-stats-filled.png'),
    )

    await waitForSellingReady(page, 'active')
    await captureScreenshot(page, contractScreenshotPath('authenticated-profile-selling-active-filled.png'))
    await waitForSellingReady(page, 'sold')
    await captureScreenshot(page, contractScreenshotPath('authenticated-profile-selling-sold-filled.png'))

    await waitForSellingReady(page, 'active')
    let seedListingId = seed.fixedListingId ?? null
    if (!seedListingId) {
      const hrefEarly = await page
        .locator('[data-testid="selling-listing-row"] a[href^="/listings/"]')
        .first()
        .getAttribute('href', { timeout: 15_000 })
        .catch(() => null)
      seedListingId = hrefEarly?.match(/\/listings\/([^/?#]+)/)?.[1] ?? null
    }
    expect(seedListingId).toBeTruthy()
    const jwtPayload = JSON.parse(
      Buffer.from(token!.split('.')[1]!, 'base64').toString(),
    ) as { sub?: string }
    const userId = jwtPayload.sub
    expect(userId).toBeTruthy()
    await ensureContractFeedback(page.request, token!, {
      listingId: seedListingId!,
      sellerUserId: userId!,
      buyerUserId: userId!,
    })
    await waitForFeedbackReady(page, token!)
    await captureScreenshot(page, contractScreenshotPath('authenticated-feedback-d3-filled.png'))

    const listingId = seedListingId
    if (listingId) {
      await page.goto(`/listings/${listingId}`)
      await expect(page.getByTestId('listing-detail-ready')).toBeVisible({ timeout: 30_000 })
      await ensureWatchlistContains(page.request, token!, listingId)
      await page.goto('/watchlist')
      await waitForWatchlistCard(page, listingId)
      await captureScreenshot(
        page,
        contractScreenshotPath('authenticated-watchlist-filled-product-cards.png'),
      )

      await page.goto(`/listings/${listingId}`)
      await expect(page.getByTestId('listing-detail-ready')).toBeVisible({ timeout: 30_000 })
      await pollRecentlyViewedIds(page.request, token!, [listingId], { timeoutMs: 45_000 })
      await page.goto('/recently-viewed')
      await expect(page.getByTestId('recently-viewed-page-ready')).toBeVisible({ timeout: 30_000 })
      await expect(page.locator('[data-testid="recently-viewed-item"]').first()).toBeVisible({
        timeout: 15_000,
      })
      await captureScreenshot(
        page,
        contractScreenshotPath('authenticated-recently-viewed-filled-product-cards.png'),
      )

      await page.goto(`/listings/${listingId}`)
      await expect(page.getByTestId('listing-detail-ready')).toBeVisible({ timeout: 30_000 })
      await expect(page.locator('body')).not.toContainText('Loading listing')
      await captureScreenshot(page, contractScreenshotPath('authenticated-listing-detail-with-image.png'), {
        fullPage: true,
      })
      await page.goto(`/listings/${listingId}/edit`)
      await expect(page.getByRole('button', { name: /save changes/i })).toBeVisible({
        timeout: 30_000,
      })
      await captureScreenshot(page, contractScreenshotPath('authenticated-listing-edit.png'))
      await page.goto(`/listings/${listingId}/revisions`)
      await expect(page.locator('ol').first()).toBeVisible({ timeout: 30_000 })
      await captureScreenshot(page, contractScreenshotPath('authenticated-listing-revisions.png'))
    }

    const recordId = await page.evaluate(() => {
      const raw = localStorage.getItem('record-platform.marketplace-seed')
      if (!raw) return null
      try {
        const s = JSON.parse(raw) as { recordIds?: string[] }
        return s.recordIds?.[0] ?? null
      } catch {
        return null
      }
    })
    if (recordId) {
      await page.goto(`/records/${recordId}`)
      await captureScreenshot(page, contractScreenshotPath('authenticated-record-detail.png'))
    }

    await page.goto('/dashboard')
    await page.getByRole('button', { name: /Cart/i }).click()
    await expect(page.getByText(/subtotal|cart/i).first()).toBeVisible({ timeout: 15_000 })
    await page.screenshot({
      path: contractScreenshotPath('authenticated-cart-popover-filled.png'),
      fullPage: true,
    })
    await page.goto('/cart')
    await expect(page.getByText(/Loading cart/i)).not.toBeVisible({ timeout: 30_000 })
    await captureScreenshot(page, contractScreenshotPath('authenticated-cart-filled.png'))
  })

  test('public profile filled', async ({ page }) => {
    await page.goto('/users/test-collector')
    await assertNoStaleProductUi(page)
    await captureScreenshot(
      page,
      guestContractScreenshotPath('authenticated-public-user-profile-filled.png'),
    )
  })
})
