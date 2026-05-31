import { test, expect } from '@playwright/test'

import {
  BUYER_CONTRACT_EMAIL,
  obtainBuyerContractToken,
  obtainSellerContractToken,
  signInWithToken,
} from './helpers/auth'
import { createListingWithShipping, waitForListingField } from './helpers/listing-contract'
import {
  pollAllNotificationsRead,
  pollUnreadNotifications,
  readNotificationUnreadBadge,
  triggerSellerMessageNotification,
} from './helpers/event-backed-notification'
import {
  capturePageContentScreenshot,
  contractScreenshotPath,
} from './helpers/screenshot-readiness'
import { timed } from './helpers/seed-lean'

test.describe.configure({ timeout: 180_000 })

test.describe.serial('Notification event-backed contract', () => {
  let listingId = ''
  const buyerMessage = `Event-backed notify ${Date.now()}`

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const sellerToken = await timed('seller/auth', () => obtainSellerContractToken(ctx.request))
    listingId = await timed('seller/listing', () =>
      createListingWithShipping(ctx.request, sellerToken, {
        title: `Notify Event Listing ${Date.now()}`,
      }),
    )
    await ctx.close()
  })

  test('message send creates seller notification and read-all persists', async ({
    page,
    request,
  }) => {
    const buyerToken = await obtainBuyerContractToken(request)
    const sellerToken = await obtainSellerContractToken(request)

    await waitForListingField(request, sellerToken, listingId, (row) => Boolean(row.id))
    await signInWithToken(page, buyerToken, BUYER_CONTRACT_EMAIL)
    await triggerSellerMessageNotification({
      request,
      page,
      sellerToken,
      listingId,
      buyerMessage,
    })

    await signInWithToken(page, sellerToken)
    await pollUnreadNotifications(request, sellerToken, 1, { messageHint: buyerMessage })

    await page.goto('/dashboard')
    await expect(page.getByTestId('notification-dropdown')).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(async () => readNotificationUnreadBadge(page), { timeout: 60_000 })
      .toBeGreaterThan(0)

    await page.getByTestId('notification-dropdown').click()
    await expect(page.getByTestId('notification-dropdown-panel')).toBeVisible()
    const firstItem = page.getByTestId('notification-item').first()
    await expect(firstItem).toBeVisible()
    const itemText = await firstItem.innerText()
    expect(itemText.toLowerCase()).toMatch(/message/)
    for (const word of ['demo', 'mock', 'seed', 'placeholder'] as const) {
      expect(itemText.toLowerCase()).not.toContain(word)
    }

    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-notification-message-event.png'),
    )

    const readAllRes = await request.post('/api/notifications/read-all', {
      headers: {
        Authorization: `Bearer ${sellerToken}`,
        'X-RP-E2E-Contract': '1',
      },
      data: {},
    })
    expect(readAllRes.ok()).toBeTruthy()
    await pollAllNotificationsRead(request, sellerToken)

    await page.reload()
    await expect(page.getByTestId('notification-dropdown')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('notification-unread-count')).toHaveCount(0)

    const listRes = await request.get('/api/notifications', {
      headers: {
        Authorization: `Bearer ${sellerToken}`,
        'X-RP-E2E-Contract': '1',
      },
    })
    expect(listRes.ok()).toBeTruthy()
    const body = (await listRes.json()) as { items?: { read_at?: string | null }[] }
    const items = body.items ?? []
    expect(items.length).toBeGreaterThan(0)
    for (const row of items.slice(0, 5)) {
      expect(row.read_at).toBeTruthy()
    }

    await capturePageContentScreenshot(
      page,
      contractScreenshotPath('authenticated-notification-read-all-persisted.png'),
    )
  })
})
