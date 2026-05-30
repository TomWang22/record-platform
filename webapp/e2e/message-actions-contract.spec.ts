import { test, expect } from '@playwright/test'

import {
  BUYER_CONTRACT_EMAIL,
  obtainBuyerContractToken,
  obtainSellerContractToken,
  SELLER_CONTRACT_EMAIL,
  signInWithToken,
} from './helpers/auth'
import { createListingWithShipping } from './helpers/listing-contract'
import { inboxListingTitleVisible } from './helpers/messaging-contract'
import { fillComposeAndSend } from './helpers/messaging-compose'
import { timed } from './helpers/seed-lean'

test.describe.configure({ timeout: 180_000 })

test.describe.serial('Message reply, edit, and reaction contract', () => {
  let listingId = ''
  let listingTitle = ''
  let threadId = ''
  const buyerMessage = `Buyer thread seed ${Date.now()}`
  const sellerReply = `Seller threaded reply ${Date.now()}`
  const editedBuyerText = `Buyer edited message ${Date.now()}`

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const sellerToken = await timed('seller/auth', () => obtainSellerContractToken(ctx.request))
    listingTitle = `E2E Message Actions ${Date.now()}`
    listingId = await timed('seller/listing', () =>
      createListingWithShipping(ctx.request, sellerToken, {
        title: listingTitle,
      }),
    )
    await ctx.close()
  })

  test('buyer starts thread', async ({ page, request }) => {
    const inboxTitle = inboxListingTitleVisible(listingTitle)
    const buyerToken = await obtainBuyerContractToken(request)
    await signInWithToken(page, buyerToken, BUYER_CONTRACT_EMAIL)
    await page.goto(`/listings/${listingId}`)
    await expect(page.getByTestId('listing-detail-ready')).toBeVisible({ timeout: 45_000 })
    await page.getByTestId('contact-seller-button').click()
    await page.waitForURL(/\/messages\?/, { timeout: 30_000 })
    await fillComposeAndSend(page, buyerMessage)
    await expect(
      page.getByTestId('messages-bubble-text').filter({ hasText: buyerMessage }).first(),
    ).toBeVisible({ timeout: 45_000 })
    await expect
      .poll(async () => {
        const fromUrl = new URL(page.url()).searchParams.get('thread')
        if (fromUrl) return fromUrl
        await page.goto('/messages')
        const item = page.getByTestId('messages-inbox-item').filter({ hasText: inboxTitle }).first()
        if (!(await item.isVisible().catch(() => false))) return ''
        await item.click()
        return new URL(page.url()).searchParams.get('thread') ?? ''
      }, { timeout: 45_000 })
      .not.toBe('')
    threadId = new URL(page.url()).searchParams.get('thread') ?? ''
    expect(threadId).toBeTruthy()
  })

  test('seller replies with threaded reply action', async ({ page, request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    await signInWithToken(page, sellerToken, SELLER_CONTRACT_EMAIL)
    await page.goto(`/messages?thread=${encodeURIComponent(threadId)}`)
    await expect(page.getByTestId('messages-thread-panel')).toBeVisible({ timeout: 45_000 })
    await expect(
      page.getByTestId('messages-bubble-text').filter({ hasText: buyerMessage }).first(),
    ).toBeVisible({ timeout: 30_000 })
    const buyerBubble = page
      .getByTestId('messages-thread-bubble')
      .filter({ has: page.getByTestId('messages-bubble-text').filter({ hasText: buyerMessage }) })
      .first()
    await buyerBubble.getByTestId('messages-action-reply').click()
    await expect(page.getByTestId('messages-reply-compose-banner')).toBeVisible()
    await page.getByTestId('messages-compose-body').fill(sellerReply)
    const replyRes = page.waitForResponse(
      (res) => res.url().includes('/api/messages/') && res.url().includes('/reply'),
      { timeout: 30_000 },
    )
    await page.getByTestId('messages-compose-send').click()
    expect((await replyRes).status()).toBeLessThan(400)
    await expect(
      page.getByTestId('messages-bubble-text').filter({ hasText: sellerReply }).first(),
    ).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('messages-reply-quote').first()).toBeVisible()
  })

  test('buyer edits own message and adds reaction', async ({ page, request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    await signInWithToken(page, buyerToken, BUYER_CONTRACT_EMAIL)
    await page.goto(`/messages?thread=${encodeURIComponent(threadId)}`)
    await expect(
      page.getByTestId('messages-bubble-text').filter({ hasText: buyerMessage }).first(),
    ).toBeVisible({ timeout: 30_000 })
    const ownBubble = page
      .getByTestId('messages-thread-bubble')
      .filter({ has: page.getByTestId('messages-bubble-text').filter({ hasText: buyerMessage }) })
      .first()
    await ownBubble.getByTestId('messages-action-edit').click()
    await page.getByTestId('messages-edit-body').fill(editedBuyerText)
    const editRes = page.waitForResponse(
      (res) =>
        res.request().method() === 'PUT' &&
        res.url().includes('/api/messages/') &&
        !res.url().includes('/reply'),
      { timeout: 30_000 },
    )
    await page.getByTestId('messages-edit-save').click()
    expect((await editRes).status()).toBeLessThan(400)
    await expect(
      page.getByTestId('messages-bubble-text').filter({ hasText: editedBuyerText }).first(),
    ).toBeVisible({ timeout: 30_000 })

    const sellerBubble = page
      .getByTestId('messages-thread-bubble')
      .filter({ has: page.getByTestId('messages-bubble-text').filter({ hasText: sellerReply }) })
      .first()
    const reactRes = page.waitForResponse(
      (res) => res.url().includes('/reactions') && res.request().method() === 'POST',
      { timeout: 30_000 },
    )
    await sellerBubble.getByTestId('messages-action-react').click()
    expect((await reactRes).status()).toBeLessThan(400)
    await expect(page.getByTestId('messages-reaction-chip').filter({ hasText: '👍' }).first()).toBeVisible({
      timeout: 30_000,
    })
  })
})
