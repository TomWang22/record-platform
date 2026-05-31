import { expect, type APIRequestContext, type Page } from '@playwright/test'

import { getJsonWith429Retry } from './http-retry'

export async function pollRecordsUntilArtist(
  request: APIRequestContext,
  token: string,
  artist: string,
  opts: { timeoutMs?: number } = {},
): Promise<{ id: string; artist?: string }> {
  const timeoutMs = opts.timeoutMs ?? 60_000
  const deadline = Date.now() + timeoutMs
  const headers = { Authorization: `Bearer ${token}`, 'X-RP-E2E-Contract': '1' }
  let last = '[]'
  while (Date.now() < deadline) {
    const rows = await getJsonWith429Retry<{ id: string; artist?: string }[]>(
      request,
      '/api/records',
      headers,
      `records poll ${artist}`,
    )
    last = JSON.stringify(rows)
    const hit = rows.find((r) => r.artist === artist)
    if (hit?.id) return hit
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`record artist not in API: ${artist} — last ${last.slice(0, 400)}`)
}

/** UI filter: Search triggers GET /api/records?q=…; purchase/date/listed filters are client-side. */
export async function waitForRecordVisibleAfterFilter(page: Page, artist: string): Promise<void> {
  await page.getByPlaceholder(/Search artist/i).fill(artist)
  await page.getByRole('button', { name: /^Search$/i }).click()
  await expect(page.getByTestId('records-ready')).toBeVisible({ timeout: 60_000 })
  await expect(
    page.getByTestId('record-card').filter({ hasText: artist }).first(),
  ).toBeVisible({ timeout: 60_000 })
}
