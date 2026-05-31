import { test, expect } from '@playwright/test'

import {
  obtainAuthToken,
  obtainBuyerContractToken,
  signInWithBuyerContractApiToken,
} from './helpers/auth'
import { createListingWithShipping } from './helpers/listing-contract'
import {
  capturePageContentScreenshot,
  contractScreenshotPath,
} from './helpers/screenshot-readiness'
import {
  clearRecentlyViewedOnApi,
  ensureRecentlyViewedEntry,
  pollRecentlyViewedIds,
  timed,
} from './helpers/seed-lean'

test.describe.configure({ timeout: 180_000 })

test.describe.serial('Recently viewed product contract (7.7)', () => {
  const listingTitles: string[] = []
  const listingIds: string[] = []
  let removeTargetId = ''
  let buyerToken = ''

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const sellerToken = await timed('auth/seller', () => obtainAuthToken(ctx.request))
    buyerToken = await timed('auth/buyer', () => obtainBuyerContractToken(ctx.request))
    for (let i = 0; i < 3; i++) {
      const title = `E2E RV ${Date.now()}-${i}`
      listingTitles.push(title)
      const id = await timed(`listing/${i}`, () =>
        createListingWithShipping(ctx.request, sellerToken, { title }),
      )
      listingIds.push(id)
    }
    await ctx.close()
  })

  test.beforeEach(async ({ page, request }) => {
    buyerToken = await obtainBuyerContractToken(request)
    await clearRecentlyViewedOnApi(request, buyerToken)
    await pollRecentlyViewedIds(request, buyerToken, [], { timeoutMs: 15_000 })
    await signInWithBuyerContractApiToken(page)
  })

  test('three listings appear after API seed', async ({ page, request }) => {
    expect(listingIds.length).toBeGreaterThanOrEqual(3)
    removeTargetId = listingIds[0]!

    for (const id of listingIds.slice(0, 3)) {
      await ensureRecentlyViewedEntry(request, buyerToken, id)
    }
    await pollRecentlyViewedIds(request, buyerToken, listingIds.slice(0, 3))

    await page.goto('/recently-viewed')
    await expect(page.getByTestId('recently-viewed-page-ready')).toBeVisible({ timeout: 30_000 })
    for (const id of listingIds.slice(0, 3)) {
      await expect(page.locator(`a[href="/listings/${id}"]`).first()).toBeVisible({ timeout: 15_000 })
    }

    await page.getByTestId('recently-viewed-view-grid').click()
    await expect(page.getByTestId('recently-viewed-grid')).toBeVisible()
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-recently-viewed-grid-api.png'),
    )

    await page.getByTestId('recently-viewed-view-list').click()
    await expect(page.getByTestId('recently-viewed-list')).toBeVisible()
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-recently-viewed-list-api.png'),
    )

    await page.getByTestId('recently-viewed-view-compact').click()
    await expect(page.getByTestId('recently-viewed-compact')).toBeVisible()
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-recently-viewed-compact-api.png'),
    )
  })

  test('remove one item decreases count', async ({ page, request }) => {
    for (const id of listingIds.slice(0, 3)) {
      await ensureRecentlyViewedEntry(request, buyerToken, id)
    }
    await pollRecentlyViewedIds(request, buyerToken, listingIds.slice(0, 3))

    await page.goto('/recently-viewed')
    const row = page
      .getByTestId('recently-viewed-item')
      .filter({ has: page.locator(`a[href="/listings/${removeTargetId}"]`) })
      .first()
    await expect(row).toBeVisible({ timeout: 30_000 })
    await row.getByTestId('recently-viewed-remove').click()
    await pollRecentlyViewedIds(request, buyerToken, listingIds.slice(1, 3), {
      absentIds: [removeTargetId],
      timeoutMs: 45_000,
    })
    await expect(page.locator(`a[href="/listings/${removeTargetId}"]`)).toHaveCount(0, {
      timeout: 15_000,
    })
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-recently-viewed-after-remove-api.png'),
    )
  })

  test('clear history shows empty state', async ({ page, request }) => {
    for (const id of listingIds.slice(0, 3)) {
      await ensureRecentlyViewedEntry(request, buyerToken, id)
    }
    await pollRecentlyViewedIds(request, buyerToken, listingIds.slice(0, 3))

    await page.goto('/recently-viewed')
    await page.getByTestId('recently-viewed-clear').click()
    await pollRecentlyViewedIds(request, buyerToken, [], { timeoutMs: 15_000 })
    await expect(page.getByTestId('recently-viewed-empty')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('recently-viewed-item')).toHaveCount(0)
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-recently-viewed-cleared-api.png'),
    )
  })
})
