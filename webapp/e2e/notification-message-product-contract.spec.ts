import { test, expect } from '@playwright/test'

import {
  obtainBuyerContractToken,
  obtainSellerContractToken,
  signInWithToken,
} from './helpers/auth'
import { createListingWithShipping } from './helpers/listing-contract'
import { fillComposeAndSend } from './helpers/messaging-compose'
import { capturePageContentScreenshot, contractScreenshotPath } from './helpers/screenshot-readiness'
import { timed } from './helpers/seed-lean'

test.describe.configure({ timeout: 180_000 })

test.describe.serial('Notification message product contract (8.9E)', () => {
  let listingId = ''
  const buyerMessage = `Notify product ${Date.now()}`

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const sellerToken = await timed('seller/auth', () => obtainSellerContractToken(ctx.request))
    listingId = await timed('listing', () =>
      createListingWithShipping(ctx.request, sellerToken, {
        title: `Notify product listing ${Date.now()}`,
      }),
    )
    await ctx.close()
  })

  test('direct message notification and thread link', async ({ page, request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    const sellerToken = await obtainSellerContractToken(request)

    await signInWithToken(page, buyerToken)
    await page.goto(`/listings/${listingId}`)
    await page.getByTestId('contact-seller-button').click()
    await fillComposeAndSend(page, buyerMessage)
    await expect(page.getByTestId('messages-bubble-text').filter({ hasText: buyerMessage }).first()).toBeVisible({
      timeout: 45_000,
    })
    await capturePageContentScreenshot(page, contractScreenshotPath('notification-message-direct.png'))

    await signInWithToken(page, sellerToken)
    await page.goto('/dashboard')
    await expect
      .poll(async () => {
        const count = page.getByTestId('notification-unread-count')
        if (!(await count.isVisible())) return 0
        const n = Number((await count.innerText()).replace('+', ''))
        return Number.isFinite(n) ? n : 0
      }, { timeout: 120_000 })
      .toBeGreaterThan(0)
    await capturePageContentScreenshot(page, contractScreenshotPath('notification-message-direct.png'))

    await page.getByTestId('notification-dropdown').click()
    await expect(page.getByTestId('notification-item').first()).toBeVisible()
    await capturePageContentScreenshot(page, contractScreenshotPath('notification-thread-link.png'))
    await page.getByTestId('notification-item').first().click()
    await page.waitForURL(/\/messages/, { timeout: 30_000 })
    await expect(page.locator('body')).toContainText(buyerMessage, { timeout: 45_000 })

    await page.getByRole('button', { name: /mark all read|read all/i }).click().catch(() => {})
    await expect
      .poll(async () => {
        const count = page.getByTestId('notification-unread-count')
        return (await count.isVisible()) ? await count.innerText() : '0'
      }, { timeout: 30_000 })
      .toMatch(/^(0|)$/)
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('notification-read-all-after-message.png'),
    )
  })
})
