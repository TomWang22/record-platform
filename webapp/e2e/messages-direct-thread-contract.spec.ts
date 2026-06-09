import { test, expect } from '@playwright/test'

import {
  BUYER_CONTRACT_EMAIL,
  obtainBuyerContractToken,
  obtainSellerContractToken,
  SELLER_CONTRACT_EMAIL,
  signInWithToken,
} from './helpers/auth'
import {
  assertMessagingStartContract,
  assertNoUuidInMessagesUi,
  userIdFromJwt,
} from './helpers/messaging-contract'
import { assertNoStaleProductUi } from './helpers/stale-ui-guard'
import { fillComposeAndSend } from './helpers/messaging-compose'
import { capturePageContentScreenshot, contractScreenshotPath } from './helpers/screenshot-readiness'
import { timed } from './helpers/seed-lean'

test.describe.configure({ timeout: 180_000 })

test.describe.serial('Direct thread messaging contract', () => {
  let sellerId = ''
  const buyerMsg = `Direct thread probe ${Date.now()}`

  test.beforeAll(async ({ request }) => {
    const sellerToken = await timed('seller/auth', () => obtainSellerContractToken(request))
    sellerId = userIdFromJwt(sellerToken) ?? ''
    expect(sellerId).toBeTruthy()
  })

  test('API: recipient_id only opens thread without initial message', async ({ request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    const res = await request.post('/api/messages/start', {
      headers: { Authorization: `Bearer ${buyerToken}` },
      data: { recipient_id: sellerId },
    })
    expect(res.status(), await res.text()).toBeLessThan(400)
    const body = (await res.json()) as Record<string, unknown>
    assertMessagingStartContract(body)
    expect(body.thread_id).toBeTruthy()
    expect(body.recipient_id).toBe(sellerId)
  })

  test('UI: new message search starts direct thread without listing card', async ({ page, request }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    await signInWithToken(page, buyerToken, BUYER_CONTRACT_EMAIL)
    await page.goto('/messages')
    await expect(page.getByTestId('messages-product-page')).toBeVisible({ timeout: 45_000 })
    await page.getByTestId('messages-new-message').click()
    await expect(page.getByTestId('messages-user-search-panel')).toBeVisible()
    await page.getByTestId('messages-user-search-input').fill('seller-contract')
    await expect(page.getByTestId('messages-user-search-result').first()).toBeVisible({
      timeout: 30_000,
    })
    await page.getByTestId('messages-user-search-result').first().click()
    await expect(page.getByTestId('messages-compose-ready')).toBeAttached({ timeout: 30_000 })
    await expect(page.getByTestId('messages-compose-listing-context')).toHaveCount(0)
    await assertNoUuidInMessagesUi(page)
    await assertNoStaleProductUi(page, 'messages UI')
    await capturePageContentScreenshot(page, contractScreenshotPath('direct-thread-compose.png'))
    const sent = await fillComposeAndSend(page, buyerMsg)
    await expect(page.getByTestId('messages-bubble-text').filter({ hasText: buyerMsg }).first()).toBeVisible({
      timeout: 45_000,
    })
    expect(sent.threadId).toBeTruthy()
  })

  test('seller inbox shows buyer display name', async ({ page, request }) => {
    const sellerToken = await obtainSellerContractToken(request)
    await expect
      .poll(async () => {
        const res = await request.get('/api/messages/threads', {
          headers: { Authorization: `Bearer ${sellerToken}` },
        })
        if (!res.ok()) return ''
        const data = (await res.json()) as {
          threads?: Array<{ participantDisplay?: string; lastMessagePreview?: string }>
        }
        const row = (data.threads ?? []).find((t) =>
          String(t.lastMessagePreview ?? '').includes(buyerMsg.slice(0, 24)),
        )
        return String(row?.participantDisplay ?? '').trim()
      })
      .not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)

    await signInWithToken(page, sellerToken, SELLER_CONTRACT_EMAIL)
    await page.goto('/messages')
    await expect(page.getByTestId('messages-inbox-list')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByTestId('messages-inbox-item').filter({ hasText: buyerMsg }).first()).toBeVisible({
      timeout: 45_000,
    })
    await assertNoUuidInMessagesUi(page)
    await assertNoStaleProductUi(page, 'messages UI')
    await capturePageContentScreenshot(page, contractScreenshotPath('direct-thread-seller-inbox.png'))
  })
})
