import { test, expect } from '@playwright/test'

import { signInAsTestCollectorWithSeed } from './helpers/auth'
import { ensureInboxThreadForFilters } from './helpers/seed-messaging-inbox'
import { capturePageContentScreenshot, contractScreenshotPath } from './helpers/screenshot-readiness'

test.describe('Message filters contract (8.9D)', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(120_000)
    await ensureInboxThreadForFilters(request)
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
    const term =
      (await page
        .getByTestId('messages-inbox-item')
        .first()
        .innerText()
        .catch(() => '')) || 'message'
    const needle = term.split(/\s+/).find((w) => w.length > 3) ?? 'message'
    await page.getByTestId('messages-inbox-search').fill(needle)
    await expect(page.getByTestId('messages-inbox-item').first()).toBeVisible({ timeout: 15_000 })
    await capturePageContentScreenshot(page, contractScreenshotPath('messages-search-listing.png'))
  })
})
