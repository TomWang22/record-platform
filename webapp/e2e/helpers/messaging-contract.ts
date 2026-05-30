import { expect, type Page } from '@playwright/test'

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
