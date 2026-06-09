import { expect, type APIRequestContext, type Page } from '@playwright/test'

import { with429Retry } from './http-retry'

export const UUID_VISIBLE_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/** Matches messaging-service scrubUserFacingTitle (trailing 10+ digit run stripped). */
export function inboxListingTitleVisible(fullTitle: string): string {
  const stripped = fullTitle.replace(/\s+\d{10,}\s*$/u, '').trim()
  return stripped || fullTitle
}

export async function assertNoUuidInMessagesUi(page: Page, context = 'messages UI'): Promise<void> {
  const panel = page.getByTestId('messages-product-page')
  const text = await panel.innerText()
  expect(text, `${context} must not show raw UUIDs`).not.toMatch(UUID_VISIBLE_RE)
}

export function assertMessagingStartContract(body: Record<string, unknown>): void {
  expect(body['landlord_id']).toBeUndefined()
  expect(body['landlordId']).toBeUndefined()
  expect(body.seller_id ?? body.sellerId).toBeTruthy()
}

/** Resolve thread id from inbox after compose send (API-first; do not rely on client router URL). */
export async function pollThreadIdForListing(
  request: APIRequestContext,
  token: string,
  listingId: string,
  opts: { messageHint?: string; timeoutMs?: number } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 45_000
  const deadline = Date.now() + timeoutMs
  const headers = { Authorization: `Bearer ${token}` }
  let last = '[]'
  while (Date.now() < deadline) {
    const res = await with429Retry('messages threads', () =>
      request.get('/api/messages/threads', { headers }),
    )
    last = await res.text()
    if (res.ok()) {
      const data = JSON.parse(last) as { threads?: Record<string, unknown>[] }
      const rows = data.threads ?? []
      const byListing = rows.find(
        (t) => String(t.listingId ?? t.listing_id ?? '') === listingId,
      )
      if (byListing?.id) return String(byListing.id)
      if (opts.messageHint) {
        const byPreview = rows.find((t) =>
          String(t.lastMessagePreview ?? '').includes(opts.messageHint!),
        )
        if (byPreview?.id) return String(byPreview.id)
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(
    `thread id not found for listing ${listingId}${opts.messageHint ? ` hint=${opts.messageHint}` : ''}: ${last.slice(0, 400)}`,
  )
}

export function userIdFromJwt(token: string): string | null {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as { sub?: string }
    return payload.sub ? String(payload.sub) : null
  } catch {
    return null
  }
}
