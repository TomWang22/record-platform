import { test, expect } from '@playwright/test'

import {
  obtainBuyerContractToken,
  obtainSellerContractToken,
  signInWithToken,
} from './helpers/auth'
import { createListingWithShipping } from './helpers/listing-contract'
import {
  capturePageContentScreenshot,
  contractScreenshotPath,
} from './helpers/screenshot-readiness'
import { assertNoHeaderOverlayInPageContent } from './helpers/page-content-guard'
import { fillComposeAndSend } from './helpers/messaging-compose'
import { timed } from './helpers/seed-lean'

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

test.describe.configure({ timeout: 180_000 })

test.describe.serial('Contact seller messaging contract (7.4M)', () => {
  let listingId = ''
  let sellerId = ''
  const buyerMessage = `Hi, is this still available?`
  const sellerReply = `Yes, it is still available.`

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const sellerToken = await timed('seller/auth', () => obtainSellerContractToken(ctx.request))
    listingId = await timed('seller/listing', () =>
      createListingWithShipping(ctx.request, sellerToken, {
        title: `E2E Lean Listing ${Date.now()}`,
      }),
    )
    const listingRes = await ctx.request.get(`/api/listings/${listingId}`, {
      headers: { Authorization: `Bearer ${sellerToken}` },
    })
    const listingBody = (await listingRes.json()) as { seller_id?: string; user_id?: string }
    sellerId = String(listingBody.seller_id ?? listingBody.user_id ?? '')
    await ctx.close()
    expect(sellerId).toBeTruthy()
  })

  test('buyer composes and sends message with listing context', async ({ page, request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    await signInWithToken(page, buyerToken)
    await page.goto(`/listings/${listingId}`)
    await expect(page.getByTestId('listing-detail-ready')).toBeVisible({ timeout: 45_000 })
    await page.getByTestId('contact-seller-button').click()
    await page.waitForURL(new RegExp(`/messages\\?.*listing=${listingId}`), { timeout: 30_000 })
    await expect(page.getByTestId('messages-compose-panel')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('messages-compose-listing-context')).toBeVisible()
    await expect(page.getByTestId('messages-compose-listing-link')).toBeVisible()
    const visible = await page.getByTestId('page-content').innerText()
    expect(visible).not.toMatch(UUID_RE)
    await assertNoHeaderOverlayInPageContent(page)
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-contact-seller-compose-product.png'),
    )
    const send = page.waitForResponse(
      (res) => res.url().includes('/api/messages/'),
      { timeout: 30_000 },
    )
    await fillComposeAndSend(page, buyerMessage)
    const sendRes = await send
    expect(sendRes.status(), `send failed: ${(await sendRes.text()).slice(0, 200)}`).toBeLessThan(400)
    await expect(page.getByTestId('messages-thread-panel')).toBeVisible({ timeout: 30_000 })
    await expect(
      page.getByTestId('messages-bubble-text').filter({ hasText: buyerMessage }).first(),
    ).toBeVisible({
      timeout: 45_000,
    })
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-contact-seller-sent-thread-product.png'),
    )
  })

  test('seller sees message in inbox', async ({ page, request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    await signInWithToken(page, sellerToken)
    await page.goto('/messages')
    await expect(page.getByTestId('messages-inbox-list')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('messages-inbox-list')).toContainText(buyerMessage, {
      timeout: 45_000,
    })
    expect(await page.getByTestId('page-content').innerText()).not.toMatch(UUID_RE)
    await assertNoHeaderOverlayInPageContent(page)
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-seller-inbox-listing-message-product.png'),
    )
    await page.getByTestId('messages-inbox-item').filter({ hasText: buyerMessage }).first().click()
    await expect(
      page.getByTestId('messages-thread-bubble').filter({ hasText: buyerMessage }).first(),
    ).toBeVisible({
      timeout: 30_000,
    })
  })

  test('seller replies and buyer sees reply', async ({ page, request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    await signInWithToken(page, sellerToken)
    await page.goto('/messages')
    await expect(page.getByTestId('messages-inbox-list')).toContainText(buyerMessage, {
      timeout: 45_000,
    })
    await page.getByTestId('messages-inbox-item').filter({ hasText: buyerMessage }).first().click()
    await expect(
      page.getByTestId('messages-bubble-text').filter({ hasText: buyerMessage }).first(),
    ).toBeVisible({ timeout: 30_000 })
    const send = page.waitForResponse(
      (res) => res.url().includes('/api/messages/') && res.request().method() === 'POST',
      { timeout: 30_000 },
    )
    await fillComposeAndSend(page, sellerReply)
    expect((await send).status()).toBeLessThan(400)
    await expect(
      page.getByTestId('messages-bubble-text').filter({ hasText: sellerReply }).first(),
    ).toBeVisible({ timeout: 30_000 })
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-seller-reply-thread-product.png'),
    )

    const buyerToken = await obtainBuyerContractToken(request)
    await signInWithToken(page, buyerToken)
    await page.goto('/messages')
    await expect(page.locator('body')).toContainText(sellerReply, { timeout: 45_000 })
    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-buyer-received-seller-reply-product.png'),
    )
  })
})
