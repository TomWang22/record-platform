import { test, expect } from '@playwright/test'

import { signInAsTestCollector, signInAsTestCollectorWithSeed } from './helpers/auth'
import { getJsonWith429Retry, with429Retry } from './helpers/http-retry'

test.describe('Watchlist and recently viewed API persistence', () => {
  test.describe.configure({ timeout: 120_000 })

  test('watchlist survives reload', async ({ page, request }) => {
    await signInAsTestCollector(page)
    const token = await page.evaluate(() => localStorage.getItem('record-platform.token'))
    expect(token).toBeTruthy()

    const headers = { Authorization: `Bearer ${token!}` }
    const mine = await getJsonWith429Retry<{ items?: { id: string }[] }>(
      request,
      '/api/listings/mine',
      headers,
      'watchlist mine listings',
    )
    const listingId = mine.items?.[0]?.id
    expect(listingId).toBeTruthy()

    await with429Retry('watchlist delete', () =>
      request.delete(`/api/shopping/watchlist/listing/${listingId}`, { headers }),
    ).catch(() => {})

    const add = await with429Retry('watchlist add', () =>
      request.post('/api/shopping/watchlist', {
        headers: { ...headers, 'Content-Type': 'application/json' },
        data: {
          item_type: 'listing',
          item_id: listingId,
          listing_id: listingId,
          metadata: { title: 'API contract listing' },
        },
      }),
    )
    expect(add.ok()).toBeTruthy()

    const body1 = await getJsonWith429Retry<{ items?: { item_id: string }[] }>(
      request,
      '/api/shopping/watchlist',
      headers,
      'watchlist list1',
    )
    expect(body1.items?.some((i) => i.item_id === listingId)).toBeTruthy()

    await page.goto('/watchlist')
    await expect(page.getByRole('heading', { name: 'Watchlist' })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByText(/shopping-service API|API contract listing/i).first()).toBeVisible({
      timeout: 60_000,
    })
    await expect(page.locator('[data-testid="watchlist-item"]').first()).toBeVisible({
      timeout: 60_000,
    })
    await page.reload()
    await expect(page.locator('[data-testid="watchlist-item"]').first()).toBeVisible({
      timeout: 30_000,
    })

    await with429Retry('watchlist delete final', () =>
      request.delete(`/api/shopping/watchlist/listing/${listingId}`, { headers }),
    )
    const body2 = await getJsonWith429Retry<{ items?: { item_id: string }[] }>(
      request,
      '/api/shopping/watchlist',
      headers,
      'watchlist list2',
    )
    expect(body2.items?.some((i) => i.item_id === listingId)).toBeFalsy()
  })

  test('recently viewed from listing detail only', async ({ page, request }) => {
    const { token, seed } = await signInAsTestCollectorWithSeed(page)
    const listingId = seed.fixedListingId ?? seed.listingIds[0]
    expect(listingId).toBeTruthy()

    await page.goto(`/listings/${listingId}`)
    await expect(
      page.getByRole('button', { name: /add to watchlist|remove from watchlist/i }),
    ).toBeVisible({ timeout: 30_000 })

    const rv = await request.get('/api/shopping/recently-viewed?item_type=listing', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const items = ((await rv.json()) as { items?: { item_id: string }[] }).items ?? []
    expect(items.some((i) => i.item_id === listingId)).toBeTruthy()

    await page.goto('/recently-viewed')
    await expect(page.locator('[data-testid="recently-viewed-item"]').first()).toBeVisible({
      timeout: 30_000,
    })
  })
})
