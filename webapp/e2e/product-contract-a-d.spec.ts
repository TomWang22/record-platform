import { test, expect } from '@playwright/test'

import { obtainAuthToken, signInWithContractApiToken } from './helpers/auth'
import {
  clearWatchlist,
  ensureLeanListing,
  ensureRecentlyViewedEntry,
  ensureWatchlistEntry,
  timed,
} from './helpers/seed-lean'
import { captureScreenshot, contractScreenshotPath, waitForRecordsReady } from './helpers/screenshot-readiness'
import { assertNoStaleProductUi } from './helpers/stale-ui-guard'
import { ensureTestCollection } from './helpers/seed-collection'

test.describe.configure({ timeout: 120_000 })

test.describe.serial('Product contract A–D', () => {
  let listingId = ''
  let recordId = ''

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000)
    const ctx = await browser.newContext()
    const request = ctx.request
    const token = await timed('auth/login', () => obtainAuthToken(request))
    listingId = await timed('listing/create', () => ensureLeanListing(request, token))
    const seeded = await timed('records/seed', () => ensureTestCollection(request, token))
    const recs = await timed('records/list', async () => {
      const { getJsonWith429Retry } = await import('./helpers/http-retry')
      return getJsonWith429Retry<{ id: string }[]>(
        request,
        '/api/records',
        { Authorization: `Bearer ${token}`, 'X-RP-E2E-Contract': '1' },
        'records list beforeAll',
      )
    })
    recordId = recs[0]?.id ?? ''
    if (!recordId) {
      throw new Error(`no seeded record after ensureTestCollection (seeded=${seeded})`)
    }
    await ctx.close()
  })

  test.beforeEach(async ({ page }) => {
    await signInWithContractApiToken(page)
  })

  test('A — recently viewed API', async ({ page, request }) => {
    const token = await obtainAuthToken(request)
    await ensureRecentlyViewedEntry(request, token, listingId)
    await page.goto(`/listings/${listingId}`)
    await expect(page.getByTestId('listing-detail-ready')).toBeVisible({ timeout: 45_000 })
    await page.goto('/recently-viewed')
    await expect(page.getByTestId('recently-viewed-page-ready')).toBeVisible({ timeout: 30_000 })
    const body = await page.locator('body').innerText()
    expect(body).not.toMatch(/localStorage/i)
    expect(body).not.toMatch(/until API is wired/i)
    await captureScreenshot(
      page,
      contractScreenshotPath('authenticated-recently-viewed-filled-product-cards.png'),
    )
    await page.getByTestId('recently-viewed-clear').click()
    await expect(page.getByTestId('recently-viewed-item')).toHaveCount(0, { timeout: 15_000 })
    await captureScreenshot(
      page,
      contractScreenshotPath('authenticated-recently-viewed-cleared.png'),
    )
  })

  test('B — watchlist API', async ({ page, request }) => {
    const token = await obtainAuthToken(request)
    await timed('watchlist/clear', () => clearWatchlist(request, token))
    await ensureWatchlistEntry(request, token, listingId)
    await page.goto('/watchlist')
    await expect(page.getByTestId('watchlist-page-ready')).toBeVisible({ timeout: 30_000 })
    const body = await page.locator('body').innerText()
    expect(body).not.toMatch(/local until/i)
    expect(body).not.toMatch(/localStorage/i)
    await captureScreenshot(
      page,
      contractScreenshotPath('authenticated-watchlist-filled-product-cards.png'),
    )
    await timed('watchlist/clear', () => clearWatchlist(request, token))
    await page.goto('/watchlist')
    await expect(page.getByTestId('watchlist-empty-state-ready')).toBeVisible({ timeout: 15_000 })
    await captureScreenshot(
      page,
      contractScreenshotPath('authenticated-watchlist-empty-after-remove.png'),
    )
  })

  test('C — records grid with images', async ({ page, request }) => {
    const token = await obtainAuthToken(request)
    await waitForRecordsReady(page, 'grid', token)
    await expect(page.locator('[data-testid="record-card"]').first()).toBeVisible({
      timeout: 45_000,
    })
    await expect(page.locator('[data-testid="record-image"]').first()).toBeVisible()
    await assertNoStaleProductUi(page)
    await captureScreenshot(
      page,
      contractScreenshotPath('authenticated-records-grid-media-filled.png'),
    )
    await waitForRecordsReady(page, 'list', token)
    await expect(page.locator('[data-testid="record-row"]').first()).toBeVisible({ timeout: 30_000 })
    await captureScreenshot(
      page,
      contractScreenshotPath('authenticated-records-list-media-filled.png'),
    )
    await waitForRecordsReady(page, 'compact', token)
    await expect(page.locator('[data-testid="record-compact-item"]').first()).toBeVisible({
      timeout: 30_000,
    })
    await captureScreenshot(
      page,
      contractScreenshotPath('authenticated-records-compact-media-filled.png'),
    )
    await captureScreenshot(
      page,
      contractScreenshotPath('authenticated-records-lifecycle-dates.png'),
    )
  })

  test('D — record detail edit revisions', async ({ page }) => {
    expect(recordId, 'seeded record id from beforeAll').toBeTruthy()
    await page.goto(`/records/${recordId}`)
    await expect(page.getByTestId('record-detail-ready')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByTestId('record-detail-loading')).toHaveCount(0)
    await captureScreenshot(page, contractScreenshotPath('authenticated-record-detail-filled.png'))
    await page.getByRole('link', { name: 'Edit' }).click()
    await expect(page).toHaveURL(new RegExp(`/records/${recordId}/edit`))
    await captureScreenshot(page, contractScreenshotPath('authenticated-record-edit-filled.png'))
    await page.goto(`/records/${recordId}?tab=revisions`)
    await expect(page.getByText(/Revision/i).first()).toBeVisible({ timeout: 30_000 })
    await captureScreenshot(page, contractScreenshotPath('authenticated-record-revisions-filled.png'))
  })
})
