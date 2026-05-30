import { test, expect } from '@playwright/test'

import {
  BUYER_CONTRACT_EMAIL,
  obtainBuyerContractToken,
  obtainSellerContractToken,
  SELLER_CONTRACT_EMAIL,
  signInWithToken,
} from './helpers/auth'
import { createListingWithShipping } from './helpers/listing-contract'
import { assertNoUuidInMessagesUi, inboxListingTitleVisible } from './helpers/messaging-contract'
import { fillComposeAndSend } from './helpers/messaging-compose'
import { capturePageContentScreenshot, contractScreenshotPath } from './helpers/screenshot-readiness'
import { timed } from './helpers/seed-lean'

test.describe.configure({ timeout: 180_000 })

test.describe.serial('Direct message product contract (8.9A–B)', () => {
  let listingId = ''
  let listingTitle = ''
  let threadId = ''
  const buyerMsg = `Direct UX buyer ${Date.now()}`
  const sellerReply = `Direct UX seller reply ${Date.now()}`
  const editedMsg = `Direct UX edited ${Date.now()}`

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const sellerToken = await timed('seller/auth', () => obtainSellerContractToken(ctx.request))
    listingTitle = `Direct UX ${Date.now()}`
    listingId = await timed('listing', () =>
      createListingWithShipping(ctx.request, sellerToken, { title: listingTitle }),
    )
    await ctx.close()
  })

  test('buyer composes with listing context and human labels', async ({ page, request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    await signInWithToken(page, buyerToken, BUYER_CONTRACT_EMAIL)
    await page.goto(`/listings/${listingId}`)
    await expect(page.getByTestId('listing-detail-ready')).toBeVisible({ timeout: 45_000 })
    await page.getByTestId('contact-seller-button').click()
    await page.waitForURL(/\/messages\?/, { timeout: 30_000 })
    await expect(page.getByTestId('messages-compose-listing-context')).toBeVisible()
    await expect(page.getByTestId('messages-compose-listing-link')).toBeVisible()
    await expect(page.locator('[data-testid="messages-thread-panel"] p').first()).toBeVisible({
      timeout: 15_000,
    })
    await assertNoUuidInMessagesUi(page)
    await capturePageContentScreenshot(page, contractScreenshotPath('direct-message-compose.png'))
    await fillComposeAndSend(page, buyerMsg)
    await expect(page.getByTestId('messages-bubble-text').filter({ hasText: buyerMsg }).first()).toBeVisible({
      timeout: 45_000,
    })
    threadId = new URL(page.url()).searchParams.get('thread') ?? ''
    expect(threadId).toBeTruthy()
  })

  test('seller inbox preview and reply', async ({ page, request }) => {
    const inboxTitle = inboxListingTitleVisible(listingTitle)
    const sellerToken = await obtainSellerContractToken(request)
    await signInWithToken(page, sellerToken, SELLER_CONTRACT_EMAIL)
    await page.goto('/messages')
    await expect(page.getByTestId('messages-inbox-item').filter({ hasText: inboxTitle }).first()).toBeVisible({
      timeout: 45_000,
    })
    await assertNoUuidInMessagesUi(page)
    await capturePageContentScreenshot(page, contractScreenshotPath('direct-message-seller-inbox.png'))
    await page.getByTestId('messages-inbox-item').filter({ hasText: inboxTitle }).first().click()
    await expect(page.getByTestId('messages-bubble-text').filter({ hasText: buyerMsg }).first()).toBeVisible()
    await fillComposeAndSend(page, sellerReply)
    await expect(page.getByTestId('messages-bubble-text').filter({ hasText: sellerReply }).first()).toBeVisible({
      timeout: 45_000,
    })
  })

  test('buyer sees seller reply', async ({ page, request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    await signInWithToken(page, buyerToken, BUYER_CONTRACT_EMAIL)
    await page.goto(`/messages?thread=${encodeURIComponent(threadId)}`)
    await expect(page.getByTestId('messages-bubble-text').filter({ hasText: sellerReply }).first()).toBeVisible({
      timeout: 45_000,
    })
    await capturePageContentScreenshot(page, contractScreenshotPath('direct-message-thread-buyer-reply.png'))
  })

  test('edit, react, archive, delete for self', async ({ page, request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    await signInWithToken(page, buyerToken, BUYER_CONTRACT_EMAIL)
    await page.goto(`/messages?thread=${encodeURIComponent(threadId)}`)
    const ownBubble = page
      .getByTestId('messages-thread-bubble')
      .filter({ has: page.getByTestId('messages-bubble-text').filter({ hasText: buyerMsg }) })
      .first()
    await ownBubble.getByTestId('messages-action-edit').click()
    await page.getByTestId('messages-edit-body').fill(editedMsg)
    await page.getByTestId('messages-edit-save').click()
    await expect(page.getByTestId('messages-bubble-text').filter({ hasText: editedMsg }).first()).toBeVisible({
      timeout: 30_000,
    })
    await capturePageContentScreenshot(page, contractScreenshotPath('direct-message-edited.png'))

    const sellerBubble = page
      .getByTestId('messages-thread-bubble')
      .filter({ has: page.getByTestId('messages-bubble-text').filter({ hasText: sellerReply }) })
      .first()
    await sellerBubble.getByTestId('messages-action-react').click()
    await expect(page.getByTestId('messages-reaction-chip').first()).toBeVisible({ timeout: 15_000 })
    await capturePageContentScreenshot(page, contractScreenshotPath('direct-message-reaction.png'))

    const archiveRes = page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' &&
        res.url().includes('/api/messages/thread/') &&
        res.url().includes('/archive'),
      { timeout: 30_000 },
    )
    await page.getByTestId('messages-thread-archive').click()
    expect((await archiveRes).status()).toBeLessThan(400)
    await page.getByTestId('messages-filter-archived').click()
    await expect
      .poll(async () => page.getByTestId('messages-inbox-item').count(), { timeout: 45_000 })
      .toBeGreaterThan(0)
    await capturePageContentScreenshot(page, contractScreenshotPath('direct-message-archived.png'))

    await page.getByTestId('messages-filter-all').click()
    await page.goto(`/messages?thread=${encodeURIComponent(threadId)}`)
    await page.getByTestId('messages-thread-delete-self').click()
    await page.goto('/messages')
    const inboxTitle = inboxListingTitleVisible(listingTitle)
    await expect(page.getByTestId('messages-inbox-item').filter({ hasText: inboxTitle })).toHaveCount(0, {
      timeout: 30_000,
    })
    await capturePageContentScreenshot(page, contractScreenshotPath('direct-message-deleted-self-only.png'))

    const sellerToken = await obtainSellerContractToken(request)
    await signInWithToken(page, sellerToken, SELLER_CONTRACT_EMAIL)
    await page.goto('/messages')
    await expect(page.getByTestId('messages-inbox-item').filter({ hasText: inboxTitle }).first()).toBeVisible({
      timeout: 45_000,
    })
  })
})
