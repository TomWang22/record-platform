import { test, expect } from '@playwright/test'

import {
  obtainBuyerContractToken,
  obtainSellerContractToken,
  signInWithToken,
} from './helpers/auth'
import { createListingWithShipping } from './helpers/listing-contract'
import { fillComposeAndSend } from './helpers/messaging-compose'
import {
  capturePageContentScreenshot,
  contractScreenshotPath,
} from './helpers/screenshot-readiness'
import { timed } from './helpers/seed-lean'

test.describe.configure({ timeout: 180_000 })

test.describe.serial('Message notification event contract (7.4N)', () => {
  let listingId = ''
  const buyerMessage = `Notification probe ${Date.now()}`

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const sellerToken = await timed('seller/auth', () => obtainSellerContractToken(ctx.request))
    listingId = await timed('seller/listing', () =>
      createListingWithShipping(ctx.request, sellerToken, {
        title: `E2E Notify Listing ${Date.now()}`,
      }),
    )
    await ctx.close()
  })

  test('buyer message increments seller bell', async ({ page, request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    const sellerToken = await obtainSellerContractToken(request)

    await signInWithToken(page, buyerToken)
    await page.goto(`/listings/${listingId}`)
    await expect(page.getByTestId('listing-detail-ready')).toBeVisible({ timeout: 45_000 })
    await page.getByTestId('contact-seller-button').click()
    await page.waitForURL(/\/messages\?/, { timeout: 30_000 })
    await fillComposeAndSend(page, buyerMessage)
    await expect(
      page.getByTestId('messages-thread-bubble').filter({ hasText: buyerMessage }).first(),
    ).toBeVisible({
      timeout: 45_000,
    })

    await signInWithToken(page, sellerToken)
    await page.goto('/dashboard')
    await expect(page.getByTestId('notification-dropdown')).toBeVisible({ timeout: 30_000 })

    await expect
      .poll(async () => {
        const count = page.getByTestId('notification-unread-count')
        if (!(await count.isVisible())) return 0
        const text = (await count.innerText()).trim()
        if (text.endsWith('+')) return 10
        const n = Number(text)
        return Number.isFinite(n) ? n : 0
      }, { timeout: 60_000 })
      .toBeGreaterThan(0)

    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-notification-message-received.png'),
    )

    await page.getByTestId('notification-dropdown').click()
    await expect(page.getByTestId('notification-dropdown-panel')).toBeVisible()
    await expect(page.getByTestId('notification-item').first()).toContainText(/message/i)
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-notification-click-opens-thread.png'),
    )

    await page.getByTestId('notification-item').first().click()
    await page.waitForURL(/\/messages/, { timeout: 30_000 })
    await expect(page.locator('body')).toContainText(buyerMessage, { timeout: 45_000 })
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-notification-read-state.png'),
    )
  })
})
