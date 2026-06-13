import { test, expect } from '@playwright/test'

import {
  AUTH_EMAIL,
  BUYER_CONTRACT_EMAIL,
  obtainAuthToken,
  obtainBuyerContractToken,
  obtainSellerContractToken,
  SELLER_CONTRACT_EMAIL,
  signInWithToken,
} from './helpers/auth'
import { assertNoUuidInMessagesUi, userIdFromJwt } from './helpers/messaging-contract'
import { fillComposeAndSend } from './helpers/messaging-compose'
import { capturePageContentScreenshot, contractScreenshotPath } from './helpers/screenshot-readiness'
import { timed } from './helpers/seed-lean'

test.describe.configure({ timeout: 180_000 })

test.describe.serial('Group thread messaging contract (T15.4S)', () => {
  let groupId = ''
  let groupName = ''
  const groupMsg = `Group thread probe ${Date.now()}`
  const replyMsg = `Group threaded reply ${Date.now()}`

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const ownerToken = await timed('owner/auth', () => obtainAuthToken(ctx.request))
    const buyerToken = await timed('buyer/auth', () => obtainBuyerContractToken(ctx.request))
    const sellerToken = await timed('seller/auth', () => obtainSellerContractToken(ctx.request))
    const ownerId = userIdFromJwt(ownerToken)
    const buyerId = userIdFromJwt(buyerToken)
    const sellerId = userIdFromJwt(sellerToken)
    expect(ownerId && buyerId && sellerId).toBeTruthy()

    groupName = `E2E Group Thread ${Date.now()}`
    const createRes = await ctx.request.post('/api/messages/groups', {
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      data: { name: groupName, description: 'T15.4S group contract' },
    })
    expect(createRes.ok(), await createRes.text()).toBeTruthy()
    groupId = ((await createRes.json()) as { id: string }).id
    for (const memberId of [buyerId, sellerId]) {
      const add = await ctx.request.post(`/api/messages/groups/${groupId}/members`, {
        headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
        data: { user_id: memberId },
      })
      expect(add.ok(), await add.text()).toBeTruthy()
    }
    const send = await ctx.request.post('/api/messages/send', {
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      data: {
        group_id: groupId,
        message_type: 'group',
        subject: 'Group message',
        content: groupMsg,
      },
    })
    expect(send.ok(), await send.text()).toBeTruthy()
    await ctx.close()
  })

  test('create group, add users, send — visible in groups filter', async ({ page, request }) => {
    const ownerToken = await obtainAuthToken(request)
    await signInWithToken(page, ownerToken, AUTH_EMAIL)
    await page.goto('/messages')
    await page.getByTestId('messages-filter-groups').click()
    await expect(page.getByTestId('messages-inbox-item').filter({ hasText: groupName }).first()).toBeVisible({
      timeout: 45_000,
    })
    await assertNoUuidInMessagesUi(page)
    await page.getByTestId('messages-inbox-item').filter({ hasText: groupName }).first().click()
    await expect(page.getByTestId('messages-bubble-text').filter({ hasText: groupMsg }).first()).toBeVisible({
      timeout: 45_000,
    })
    await capturePageContentScreenshot(page, contractScreenshotPath('group-thread-message.png'))
  })

  test('member replies in group thread', async ({ page, request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    await signInWithToken(page, buyerToken, BUYER_CONTRACT_EMAIL)
    await page.goto('/messages')
    await page.getByTestId('messages-filter-groups').click()
    await page.getByTestId('messages-inbox-item').filter({ hasText: groupName }).first().click()
    const bubble = page
      .getByTestId('messages-thread-bubble')
      .filter({ has: page.getByTestId('messages-bubble-text').filter({ hasText: groupMsg }) })
      .first()
    await bubble.getByTestId('messages-action-reply').click()
    await page.getByTestId('messages-compose-body').fill(replyMsg)
    const replyRes = page.waitForResponse(
      (res) => res.url().includes('/api/messages/') && res.url().includes('/reply'),
      { timeout: 30_000 },
    )
    await page.getByTestId('messages-compose-send').click()
    expect((await replyRes).status()).toBeLessThan(400)
    await expect(page.getByTestId('messages-bubble-text').filter({ hasText: replyMsg }).first()).toBeVisible({
      timeout: 30_000,
    })
  })

  test('reaction on group message', async ({ page, request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    await signInWithToken(page, sellerToken, SELLER_CONTRACT_EMAIL)
    await page.goto('/messages')
    await page.getByTestId('messages-filter-groups').click()
    await page.getByTestId('messages-inbox-item').filter({ hasText: groupName }).first().click()
    const bubble = page
      .getByTestId('messages-thread-bubble')
      .filter({ has: page.getByTestId('messages-bubble-text').filter({ hasText: groupMsg }) })
      .first()
    const reactRes = page.waitForResponse(
      (res) => res.url().includes('/reactions') && res.request().method() === 'POST',
      { timeout: 30_000 },
    )
    await bubble.getByTestId('messages-action-react').click()
    expect((await reactRes).status()).toBeLessThan(400)
    await expect(page.getByTestId('messages-reaction-chip').first()).toBeVisible({ timeout: 15_000 })
  })

  test('member leaves — remaining users still see thread', async ({ page, request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    const leave = await request.delete(`/api/messages/groups/${groupId}/leave`, {
      headers: { Authorization: `Bearer ${buyerToken}` },
    })
    expect(leave.ok(), await leave.text()).toBeTruthy()
    await signInWithToken(page, buyerToken, BUYER_CONTRACT_EMAIL)
    await page.goto('/messages')
    await page.getByTestId('messages-filter-groups').click()
    await expect(page.getByTestId('messages-inbox-item').filter({ hasText: groupName })).toHaveCount(0, {
      timeout: 30_000,
    })

    const sellerToken = await obtainSellerContractToken(request)
    await signInWithToken(page, sellerToken, SELLER_CONTRACT_EMAIL)
    await page.goto('/messages')
    await page.getByTestId('messages-filter-groups').click()
    await expect(page.getByTestId('messages-inbox-item').filter({ hasText: groupName }).first()).toBeVisible({
      timeout: 45_000,
    })
    await page.getByTestId('messages-inbox-item').filter({ hasText: groupName }).first().click()
    await expect(page.getByTestId('messages-bubble-text').filter({ hasText: groupMsg }).first()).toBeVisible()
    await capturePageContentScreenshot(page, contractScreenshotPath('group-thread-after-leave.png'))
  })
})
