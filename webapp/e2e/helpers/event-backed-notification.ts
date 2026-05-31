import { expect, type APIRequestContext } from '@playwright/test'

import { obtainBuyerContractToken } from './auth'
import { with429Retry } from './http-retry'
import { createListingWithShipping, waitForListingField } from './listing-contract'
import { fillComposeAndSend } from './messaging-compose'
import type { Page } from '@playwright/test'

type NotificationRow = {
  read_at?: string | null
  event_type?: string
  payload?: Record<string, unknown> | string | null
}

function parsePayload(payload: NotificationRow['payload']): Record<string, unknown> {
  if (!payload) return {}
  if (typeof payload === 'object') return payload
  try {
    return JSON.parse(payload) as Record<string, unknown>
  } catch {
    return {}
  }
}

export async function countUnreadNotifications(
  request: APIRequestContext,
  token: string,
  opts?: { messageHint?: string },
): Promise<number> {
  const res = await with429Retry('notifications list', () =>
    request.get('/api/notifications', {
      headers: { Authorization: `Bearer ${token}`, 'X-RP-E2E-Contract': '1' },
    }),
  )
  if (!res.ok()) return 0
  const items = ((await res.json()) as { items?: NotificationRow[] }).items ?? []
  const hint = opts?.messageHint?.toLowerCase().slice(0, 24) ?? ''
  return items.filter((n) => {
    if (n.read_at) return false
    if (!hint) return true
    const p = parsePayload(n.payload)
    const text = JSON.stringify(p).toLowerCase()
    return (
      String(n.event_type ?? '').includes('message') ||
      text.includes('message') ||
      text.includes(hint)
    )
  }).length
}

export async function pollUnreadNotifications(
  request: APIRequestContext,
  token: string,
  minCount: number,
  opts?: { timeoutMs?: number; messageHint?: string },
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? 90_000
  await expect
    .poll(async () => countUnreadNotifications(request, token, { messageHint: opts?.messageHint }), {
      timeout: timeoutMs,
    })
    .toBeGreaterThanOrEqual(minCount)
}

export async function pollAllNotificationsRead(
  request: APIRequestContext,
  token: string,
  opts?: { timeoutMs?: number },
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? 45_000
  await expect
    .poll(async () => countUnreadNotifications(request, token), { timeout: timeoutMs })
    .toBe(0)
}

/** Buyer message on seller listing → seller unread notification (Kafka / HTTP push, not seed). */
export async function triggerSellerMessageNotification(opts: {
  request: APIRequestContext
  page: Page
  sellerToken: string
  listingId?: string
  buyerMessage?: string
}): Promise<{ listingId: string; buyerMessage: string }> {
  const buyerMessage = opts.buyerMessage ?? `Contract notify ${Date.now()}`
  const listingId =
    opts.listingId ??
    (await createListingWithShipping(opts.request, opts.sellerToken, {
      title: `Notify Listing ${Date.now()}`,
    }))

  await waitForListingField(opts.request, opts.sellerToken, listingId, () => true, {
    timeoutMs: 60_000,
  })
  const buyerToken = await obtainBuyerContractToken(opts.request)
  await opts.page.goto(`/listings/${listingId}`, { waitUntil: 'domcontentloaded' })
  await expect(opts.page.getByTestId('listing-detail-ready')).toBeVisible({ timeout: 90_000 })
  await opts.page.getByTestId('contact-seller-button').click()
  await opts.page.waitForURL(/\/messages\?/, { timeout: 30_000 })
  await fillComposeAndSend(opts.page, buyerMessage)
  await expect(
    opts.page.getByTestId('messages-bubble-text').filter({ hasText: buyerMessage }).first(),
  ).toBeVisible({ timeout: 90_000 })

  await pollUnreadNotifications(opts.request, opts.sellerToken, 1, { messageHint: buyerMessage })
  return { listingId, buyerMessage }
}

/** Parse bell badge count; treats `9+` as at least 9. */
export async function readNotificationUnreadBadge(page: Page): Promise<number> {
  const count = page.getByTestId('notification-unread-count')
  if (!(await count.isVisible().catch(() => false))) return 0
  const text = (await count.innerText()).trim()
  if (text.endsWith('+')) return 9
  const n = Number(text)
  return Number.isFinite(n) ? n : 0
}
