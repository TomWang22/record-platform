import { test, expect } from '@playwright/test'

import { signInAsTestCollectorWithSeed } from './helpers/auth'
import { ensureInboxThreadForFilters } from './helpers/seed-messaging-inbox'
import { capturePageContentScreenshot, contractScreenshotPath } from './helpers/screenshot-readiness'

test.describe('Message filters contract (8.9D)', () => {
  let searchNeedle = 'Filter'

  test.beforeAll(async ({ request }) => {
    test.setTimeout(120_000)
    const seed = await ensureInboxThreadForFilters(request)
    searchNeedle = seed.listingTitle.split(/\s+/).find((w) => w.length > 4) ?? 'Filter'
  })

  test.beforeEach(async ({ page }) => {
    await signInAsTestCollectorWithSeed(page)
    await page.goto('/messages', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('messages-product-page')).toBeVisible({ timeout: 45_000 })
  })

  test('direct filter tab', async ({ page }) => {
    await page.getByTestId('messages-filter-direct').click()
    await expect(page.getByTestId('messages-inbox-list')).toBeVisible()
    await capturePageContentScreenshot(page, contractScreenshotPath('messages-filter-direct.png'))
  })

  test('groups filter tab', async ({ page }) => {
    await page.getByTestId('messages-filter-groups').click()
    await capturePageContentScreenshot(page, contractScreenshotPath('messages-filter-groups.png'))
  })

  test('unread filter tab', async ({ page }) => {
    await page.getByTestId('messages-filter-unread').click()
    await capturePageContentScreenshot(page, contractScreenshotPath('messages-filter-unread.png'))
  })

  test('archived filter tab', async ({ page }) => {
    await page.getByTestId('messages-filter-archived').click()
    await capturePageContentScreenshot(page, contractScreenshotPath('messages-filter-archived.png'))
  })

  test('search by listing title', async ({ page }) => {
    await page.getByTestId('messages-filter-all').click()
    const itemCount = await page.getByTestId('messages-inbox-item').count()
    expect(itemCount, 'inbox threads seeded in beforeAll').toBeGreaterThan(0)
    await page.getByTestId('messages-inbox-search').fill(searchNeedle)
    await expect
      .poll(async () => page.getByTestId('messages-inbox-item').count(), { timeout: 45_000 })
      .toBeGreaterThan(0)
    await expect(
      page.getByTestId('messages-inbox-item').filter({ hasText: searchNeedle }).first(),
    ).toBeVisible({ timeout: 30_000 })
    await capturePageContentScreenshot(page, contractScreenshotPath('messages-search-listing.png'))
  })
})
