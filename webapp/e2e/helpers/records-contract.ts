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

/** Collection finished initial load (works before/after records-ready testid is deployed). */
export async function waitForRecordsCollectionLoaded(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: /My collection/i })).toBeVisible({
    timeout: 60_000,
  })
  const ready = page.getByTestId('records-ready')
  const cards = page.getByTestId('record-card')
  const compactItems = page.getByTestId('record-compact-item')
  const rows = page.getByTestId('record-row')
  const articles = page.locator('article')
  const tableRows = page.locator('tbody tr')
  await expect
    .poll(
      async () => {
        if (await ready.count()) return 'ready'
        if (await cards.count()) return 'cards'
        if (await compactItems.count()) return 'compact'
        if (await rows.count()) return 'rows'
        if (await articles.count()) return 'articles'
        if (await tableRows.count()) return 'table'
        return ''
      },
      { timeout: 60_000 },
    )
    .not.toBe('')
}

/** UI filter: Search triggers GET /api/records?q=…; purchase/date/listed filters are client-side. */
export async function waitForRecordVisibleAfterFilter(page: Page, artist: string): Promise<void> {
  await waitForRecordsCollectionLoaded(page)
  await page.getByPlaceholder(/Search artist/i).fill(artist)
  await page.getByRole('button', { name: /^Search$/i }).click()
  const card = page
    .getByTestId('record-card')
    .filter({ hasText: artist })
    .first()
    .or(page.getByTestId('record-compact-item').filter({ hasText: artist }).first())
    .or(page.locator('article').filter({ hasText: artist }).first())
  await expect(card).toBeVisible({ timeout: 60_000 })
}
