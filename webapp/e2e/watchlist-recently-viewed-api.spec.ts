import { test, expect } from '@playwright/test'

import {
  obtainAuthToken,
  signInAsTestCollector,
  signInAsTestCollectorWithSeed,
} from './helpers/auth'
import { getJsonWith429Retry, with429Retry } from './helpers/http-retry'
import { pollRecentlyViewedIds } from './helpers/seed-lean'

test.describe('Watchlist and recently viewed API persistence', () => {
  test.describe.configure({ timeout: 120_000 })

  test('watchlist survives reload', async ({ page, request }) => {
    await signInAsTestCollector(page)
    const token = await obtainAuthToken(request)

    const headers = { Authorization: `Bearer ${token!}` }
    const mine = await getJsonWith429Retry<{ items?: { id: string }[] }>(
      request,
      '/api/listings/mine',
      headers,
      'watchlist mine listings',
    )
    const listingId = mine.listings?.[0]?.id ?? mine.items?.[0]?.id
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

    const body1 = await getJsonWith429Retry<{
      items?: { listingId: string; title?: string; priceDisplay?: string }[]
    }>(request, '/api/shopping/watchlist', headers, 'watchlist list1')
    const hit = body1.items?.find((i) => i.listingId === listingId)
    expect(hit).toBeTruthy()
    expect(hit?.title).toBeTruthy()
    expect(hit?.priceDisplay).toBeTruthy()
    expect(JSON.stringify(body1)).not.toMatch(/item_type|price_cents/)

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
    const body2 = await getJsonWith429Retry<{ items?: { listingId: string }[] }>(
      request,
      '/api/shopping/watchlist',
      headers,
      'watchlist list2',
    )
    expect(body2.items?.some((i) => i.listingId === listingId)).toBeFalsy()
  })

  test('recently viewed from listing detail only', async ({ page, request }) => {
    const { token, seed } = await signInAsTestCollectorWithSeed(page)
    const listingId = seed.fixedListingId ?? seed.listingIds[0]
    expect(listingId).toBeTruthy()

    await page.goto(`/listings/${listingId}`)
    await expect(page.getByTestId('listing-detail-ready')).toBeVisible({ timeout: 45_000 })
    await expect(
      page.getByRole('button', { name: /add to watchlist|remove from watchlist/i }),
    ).toBeVisible({ timeout: 30_000 })

    await pollRecentlyViewedIds(request, token, [listingId], { timeoutMs: 45_000 })

    const rvBody = await getJsonWith429Retry<{
      items?: { listingId: string; primaryImageUrl?: string; priceDisplay?: string }[]
    }>(
      request,
      '/api/shopping/recently-viewed?item_type=listing',
      { Authorization: `Bearer ${token}` },
      'recently viewed after detail',
    )
    const hit = rvBody.items?.find((i) => i.listingId === listingId)
    expect(hit).toBeTruthy()
    expect(hit?.priceDisplay).toBeTruthy()
    expect(JSON.stringify(rvBody)).not.toMatch(/item_type|price_cents/)

    await page.goto('/recently-viewed')
    await expect(page.locator('[data-testid="recently-viewed-item"]').first()).toBeVisible({
      timeout: 30_000,
    })
  })
})
