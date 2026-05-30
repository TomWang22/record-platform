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
import { capturePageContentScreenshot, contractScreenshotPath } from './helpers/screenshot-readiness'
import { timed } from './helpers/seed-lean'

test.describe.configure({ timeout: 180_000 })

test.describe.serial('Group chat product contract (8.9C)', () => {
  let groupId = ''
  let groupName = ''
  const groupMsg = `Group hello ${Date.now()}`

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const ownerToken = await timed('owner/auth', () => obtainAuthToken(ctx.request))
    const buyerToken = await timed('buyer/auth', () => obtainBuyerContractToken(ctx.request))
    const sellerToken = await timed('seller/auth', () => obtainSellerContractToken(ctx.request))
    const ownerId = userIdFromJwt(ownerToken)
    const buyerId = userIdFromJwt(buyerToken)
    const sellerId = userIdFromJwt(sellerToken)
    expect(ownerId && buyerId && sellerId).toBeTruthy()

    groupName = `E2E Group ${Date.now()}`
    const createRes = await ctx.request.post('/api/messages/groups', {
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      data: { name: groupName, description: 'Contract group' },
    })
    expect(createRes.ok(), await createRes.text()).toBeTruthy()
    const group = (await createRes.json()) as { id: string }
    groupId = group.id
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

  test('group visible with human-readable title', async ({ page, request }) => {
    const ownerToken = await obtainAuthToken(request)
    await signInWithToken(page, ownerToken, AUTH_EMAIL)
    await page.goto('/messages')
    await page.getByTestId('messages-filter-groups').click()
    await expect(page.getByTestId('messages-inbox-item').filter({ hasText: groupName }).first()).toBeVisible({
      timeout: 45_000,
    })
    await assertNoUuidInMessagesUi(page)
    await capturePageContentScreenshot(page, contractScreenshotPath('group-chat-created.png'))
    await page.getByTestId('messages-inbox-item').filter({ hasText: groupName }).first().click()
    await expect(page.getByTestId('messages-bubble-text').filter({ hasText: groupMsg }).first()).toBeVisible({
      timeout: 45_000,
    })
    await capturePageContentScreenshot(page, contractScreenshotPath('group-chat-message-thread.png'))
  })

  test('member leaves and remaining member still sees history', async ({ page, request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    await signInWithToken(page, buyerToken, BUYER_CONTRACT_EMAIL)
    const leave = await request.delete(`/api/messages/groups/${groupId}/leave`, {
      headers: { Authorization: `Bearer ${buyerToken}` },
    })
    expect(leave.ok(), await leave.text()).toBeTruthy()
    await page.goto('/messages')
    await page.getByTestId('messages-filter-groups').click()
    await expect(page.getByTestId('messages-inbox-item').filter({ hasText: groupName })).toHaveCount(0, {
      timeout: 30_000,
    })
    await capturePageContentScreenshot(page, contractScreenshotPath('group-chat-member-left.png'))

    const sellerToken = await obtainSellerContractToken(request)
    await signInWithToken(page, sellerToken, SELLER_CONTRACT_EMAIL)
    await page.goto('/messages')
    await page.getByTestId('messages-filter-groups').click()
    await expect(page.getByTestId('messages-inbox-item').filter({ hasText: groupName }).first()).toBeVisible({
      timeout: 45_000,
    })
    await page.getByTestId('messages-inbox-item').filter({ hasText: groupName }).first().click()
    await expect(page.getByTestId('messages-bubble-text').filter({ hasText: groupMsg }).first()).toBeVisible()
  })

  test('archive and delete for self on group thread', async ({ page, request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    await signInWithToken(page, sellerToken, SELLER_CONTRACT_EMAIL)
    await page.goto('/messages')
    await page.getByTestId('messages-filter-groups').click()
    await page.getByTestId('messages-inbox-item').filter({ hasText: groupName }).first().click()
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
    await capturePageContentScreenshot(page, contractScreenshotPath('group-chat-archived.png'))

    await page.getByTestId('messages-filter-all').click()
    await page.goto('/messages')
    await page.getByTestId('messages-filter-groups').click()
    await page.getByTestId('messages-inbox-item').filter({ hasText: groupName }).first().click()
    await page.getByTestId('messages-thread-delete-self').click()
    await page.goto('/messages')
    await expect(page.getByTestId('messages-inbox-item').filter({ hasText: groupName })).toHaveCount(0)
    await capturePageContentScreenshot(page, contractScreenshotPath('group-chat-deleted-self-only.png'))
  })
})
