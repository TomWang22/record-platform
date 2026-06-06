import { test, expect } from '@playwright/test'

import {
  AUTH_EMAIL,
  obtainAuthToken,
  signInAsTestCollectorWithSeed,
} from './helpers/auth'
import {
  BUYER_CONTRACT_EMAIL,
  obtainBuyerContractToken,
  signInWithToken,
} from './helpers/auth'
import {
  pollAllNotificationsRead,
  pollUnreadNotifications,
  readNotificationUnreadBadge,
  triggerSellerMessageNotification,
} from './helpers/event-backed-notification'
import { ensureContractFeedback } from './helpers/seed-feedback'
import {
  captureScreenshot,
  contractScreenshotPath,
  waitForNoLoadingStates,
  assertNoForbiddenContractStrings,
} from './helpers/screenshot-readiness'
import { createListingWithShipping } from './helpers/listing-contract'

const CONTRACT_PASSWORD = 'ContractPass123!'

function decodeJwtUsername(jwt: string): { sub: string; username?: string } {
  const payload = JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64').toString()) as {
    sub?: string
    username?: string
  }
  if (!payload.sub) throw new Error('JWT missing sub')
  return { sub: payload.sub, username: payload.username }
}

function assertFeedbackHasNonZeroBar(distribution: Array<{ stars: number; count: number }>): void {
  expect(distribution.some((d) => d.count > 0)).toBeTruthy()
}

test.describe('Feedback and notifications API contract', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 })

  test('feedback D3 from trust-service API', async ({ page, request }) => {
    const { token, seed } = await signInAsTestCollectorWithSeed(page)

    const mine = await request.get('/api/listings/mine', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const mineBody = (await mine.json()) as {
      items?: { id: string }[]
      listings?: { id: string }[]
    }
    const listingId =
      seed.fixedListingId ?? mineBody.items?.[0]?.id ?? mineBody.listings?.[0]?.id
    expect(listingId).toBeTruthy()

    const { sub: userId } = decodeJwtUsername(token!)
    const feedbackIds = await ensureContractFeedback(request, token!, {
      listingId: listingId!,
      sellerUserId: userId,
      buyerUserId: userId,
    })
    expect(feedbackIds.length).toBeGreaterThanOrEqual(5)

    const me = await request.get('/api/feedback/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(me.ok()).toBeTruthy()
    const meBody = await me.text()
    expect(meBody.toLowerCase()).not.toMatch(/\bdemo\b|\bmock\b|\bfallback\b/)
    const summary = JSON.parse(meBody) as {
      totalReviews?: number
      distribution?: { stars: number; count: number }[]
    }
    expect((summary.totalReviews ?? 0)).toBeGreaterThanOrEqual(5)
    expect((summary.distribution ?? []).length).toBeGreaterThan(0)
    assertFeedbackHasNonZeroBar(summary.distribution ?? [])

    await page.goto('/profile/feedback')
    await expect(page.locator('[data-testid="feedback-page-ready"]')).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.locator('[data-testid="feedback-chart"]')).toBeVisible({ timeout: 15_000 })
    await waitForNoLoadingStates(page, '/profile/feedback')
    await captureScreenshot(
      page,
      'e2e/screenshots/authenticated/authenticated-feedback-d3-api.png',
      { fullPage: true },
    )
    const { username } = decodeJwtUsername(token)
    expect(username).toBeTruthy()

    const publicRes = await request.get(`/api/feedback/users/${encodeURIComponent(username!)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(publicRes.ok()).toBeTruthy()
    const publicBody = await publicRes.text()
    expect(publicBody.toLowerCase()).not.toMatch(/\bdemo\b|\bmock\b|\bfallback\b/)
    const publicSummary = JSON.parse(publicBody) as {
      distribution?: { stars: number; count: number }[]
    }
    assertFeedbackHasNonZeroBar(publicSummary.distribution ?? [])

    await page.goto(`/users/${username}/feedback`)
    await expect(page.locator('[data-testid="feedback-chart"]')).toBeVisible({ timeout: 30_000 })
    await waitForNoLoadingStates(page, `/users/${username}/feedback`)
    await captureScreenshot(
      page,
      'e2e/screenshots/guest/public-user-feedback-d3-api.png',
      { fullPage: true },
    )
  })

  test('notifications bell from notification-service API', async ({ page, request }) => {
    const { token } = await signInAsTestCollectorWithSeed(page)
    const listingId = await createListingWithShipping(request, token, {
      title: `Bell API Listing ${Date.now()}`,
    })

    const buyerToken = await obtainBuyerContractToken(request)
    const buyerMessage = `Bell API notify ${Date.now()}`
    await signInWithToken(page, buyerToken, BUYER_CONTRACT_EMAIL)
    await triggerSellerMessageNotification({
      request,
      page,
      sellerToken: token,
      listingId,
      buyerMessage,
    })

    await signInWithToken(page, token)
    await pollUnreadNotifications(request, token, 1, { messageHint: buyerMessage })
    await page.goto('/dashboard')
    await expect(page.getByTestId('notification-dropdown')).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(async () => readNotificationUnreadBadge(page), { timeout: 60_000 })
      .toBeGreaterThan(0)

    await page.locator('[data-testid="notification-dropdown"] button').first().click()
    const panel = page.locator('[data-testid="notification-dropdown-panel"]')
    await expect(panel).toBeVisible()
    const items = page.locator('[data-testid="notification-item"]')
    await expect(items.first()).toBeVisible({ timeout: 15_000 })
    expect(await items.count()).toBeGreaterThan(0)
    await assertNoForbiddenContractStrings(page, 'notification-dropdown-filled')
    await captureScreenshot(page, contractScreenshotPath('notification-dropdown-api-filled.png'))

    const readAllRes = await request.post('/api/notifications/read-all', {
      headers: { Authorization: `Bearer ${token}`, 'X-RP-E2E-Contract': '1' },
      data: {},
    })
    expect(readAllRes.ok()).toBeTruthy()
    await pollAllNotificationsRead(request, token)

    await page.reload()
    await expect(page.getByTestId('notification-unread-count')).toHaveCount(0)
    await page.locator('[data-testid="notification-dropdown"] button').first().click()
    await expect(panel).toBeVisible()
    await captureScreenshot(page, contractScreenshotPath('notification-dropdown-read-all.png'))
  })

  test('normal auth login proof without dev-auth', async ({ request }) => {
    const token = await obtainAuthToken(request)
    expect(token.length).toBeGreaterThan(20)
    const login = await request.post('/api/auth/login', {
      data: { email: AUTH_EMAIL, password: CONTRACT_PASSWORD },
    })
    expect(login.ok()).toBeTruthy()
    const body = await login.text()
    expect(body).not.toMatch(/dev-auth/i)
    expect(body.toLowerCase()).not.toMatch(/\bdemo\b|\bmock\b/)
  })
})
