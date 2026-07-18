import type { APIRequestContext } from '@playwright/test'

import { getJsonWith429Retry, with429Retry } from './http-retry'
import { COVER_KENNY } from './vinyl-cover-fixtures'

const PLACEHOLDER = COVER_KENNY

export async function timed<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const t0 = Date.now()
  try {
    const out = await fn()
    console.info(`[seed] ${label} ok ${Date.now() - t0}ms`)
    return out
  } catch (err) {
    console.error(`[seed] ${label} fail ${Date.now() - t0}ms`, err)
    throw err
  }
}

export async function ensureLeanListing(
  request: APIRequestContext,
  token: string,
): Promise<string> {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  const res = await with429Retry('lean listing', () =>
    request.post('/api/listings/create', {
      headers,
      data: {
        title: `E2E Lean Listing ${Date.now()}`,
        description: 'Lean contract listing for A–D and detail proofs.',
        price_cents: 4599,
        effective_from: '2026-05-01',
        effective_until: '2027-05-01',
        format: 'LP',
        media_condition: 'VG+',
        sleeve_condition: 'VG',
        pricing_mode: 'fixed',
        initial_status: 'active',
        images: [PLACEHOLDER],
        city: 'Brooklyn',
        state_or_province: 'NY',
        country: 'US',
        domestic_shipping_cents: 500,
        shipping_service: 'Media Mail',
        package_type: 'LP mailer',
        domestic_shipping: true,
        local_pickup: false,
      },
    }),
  )
  if (!res.ok()) {
    throw new Error(`create listing failed ${res.status()}: ${(await res.text()).slice(0, 300)}`)
  }
  const row = (await res.json()) as { id?: string }
  if (!row.id) throw new Error('create listing missing id')
  return row.id
}

export async function clearWatchlist(
  request: APIRequestContext,
  token: string,
): Promise<void> {
  const headers = { Authorization: `Bearer ${token}` }
  const data = await getJsonWith429Retry<{
    items?: { listingId?: string; item_id?: string; item_type?: string }[]
  }>(request, '/api/shopping/watchlist', headers, 'watchlist list')
  for (const row of data.items ?? []) {
    const id = row.listingId ?? row.item_id
    const type = row.item_type ?? 'listing'
    if (!id) continue
    const del = await with429Retry('watchlist delete', () =>
      request.delete(`/api/shopping/watchlist/${type}/${id}`, { headers }),
    )
    if (!del.ok() && del.status() !== 404) {
      throw new Error(`watchlist delete failed ${del.status()}: ${(await del.text()).slice(0, 200)}`)
    }
  }
}

export async function fetchWatchlistListingIds(
  request: APIRequestContext,
  token: string,
): Promise<string[]> {
  const headers = { Authorization: `Bearer ${token}` }
  const data = await getJsonWith429Retry<{
    items?: { listingId?: string; item_id?: string }[]
  }>(request, '/api/shopping/watchlist', headers, 'watchlist fetch')
  return (data.items ?? [])
    .map((row) => row.listingId ?? row.item_id)
    .filter((id): id is string => Boolean(id))
}

/** Poll shopping-service until watchlist contains expected listing ids (API truth, not UI cache). */
export async function pollWatchlistListingIds(
  request: APIRequestContext,
  token: string,
  expectedIds: string[],
  opts?: { timeoutMs?: number },
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? 45_000
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ids = await fetchWatchlistListingIds(request, token)
    const have = new Set(ids)
    if (expectedIds.every((id) => have.has(id))) {
      return
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  const finalIds = await fetchWatchlistListingIds(request, token)
  throw new Error(
    `watchlist poll timeout: expected [${expectedIds.join(', ')}], got [${finalIds.join(', ')}]`,
  )
}

export async function ensureWatchlistEntry(
  request: APIRequestContext,
  token: string,
  listingId: string,
): Promise<void> {
  await ensureWatchlistContains(request, token, listingId)
}

/** Add listing to API-backed watchlist and poll until shopping-service reflects it. */
export async function ensureWatchlistContains(
  request: APIRequestContext,
  token: string,
  listingId: string,
  opts?: { title?: string },
): Promise<void> {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  const existing = await fetchWatchlistListingIds(request, token)
  if (!existing.includes(listingId)) {
    const res = await with429Retry('watchlist add', () =>
      request.post('/api/shopping/watchlist', {
        headers,
        data: {
          item_type: 'listing',
          item_id: listingId,
          listing_id: listingId,
          metadata: { title: opts?.title ?? 'Lean listing', imageUrl: PLACEHOLDER },
        },
      }),
    )
    if (!res.ok() && res.status() !== 409) {
      throw new Error(`watchlist add failed ${res.status()}: ${(await res.text()).slice(0, 200)}`)
    }
  }
  await pollWatchlistListingIds(request, token, [listingId])
}

export async function ensureRecentlyViewedEntry(
  request: APIRequestContext,
  token: string,
  listingId: string,
): Promise<void> {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-RP-E2E-Contract': '1',
  }
  const res = await with429Retry('recently-viewed add', () =>
    request.post('/api/shopping/recently-viewed', {
      headers,
      data: {
        item_type: 'listing',
        item_id: listingId,
        metadata: { title: 'Lean listing', imageUrl: PLACEHOLDER },
      },
    }),
  )
  if (!res.ok()) {
    throw new Error(`recently-viewed add failed ${res.status()}: ${(await res.text()).slice(0, 200)}`)
  }
}

export async function clearRecentlyViewedOnApi(
  request: APIRequestContext,
  token: string,
  itemType = 'listing',
): Promise<void> {
  const headers = { Authorization: `Bearer ${token}` }
  const res = await with429Retry('recently-viewed clear', () =>
    request.delete(
      `/api/shopping/recently-viewed?${new URLSearchParams({ item_type: itemType })}`,
      { headers },
    ),
  )
  if (!res.ok() && res.status() !== 404) {
    throw new Error(`recently-viewed clear failed ${res.status()}: ${(await res.text()).slice(0, 200)}`)
  }
}

export async function fetchRecentlyViewedIds(
  request: APIRequestContext,
  token: string,
): Promise<string[]> {
  const headers = { Authorization: `Bearer ${token}` }
  const res = await with429Retry('recently-viewed fetch', () =>
    request.get('/api/shopping/recently-viewed?item_type=listing', { headers }),
  )
  if (!res.ok()) {
    throw new Error(`recently-viewed fetch failed ${res.status()}: ${(await res.text()).slice(0, 200)}`)
  }
  const data = (await res.json()) as { items?: { listingId?: string; item_id?: string }[] }
  return (data.items ?? [])
    .map((row) => row.listingId ?? row.item_id)
    .filter((id): id is string => Boolean(id))
}

/** Poll shopping-service until recently-viewed matches expected listing ids (API truth, not UI cache). */
export async function pollRecentlyViewedIds(
  request: APIRequestContext,
  token: string,
  expectedIds: string[],
  opts?: { timeoutMs?: number; absentIds?: string[] },
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? 30_000
  const absentIds = opts?.absentIds ?? []
  const want = new Set(expectedIds)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ids = await fetchRecentlyViewedIds(request, token)
    const have = new Set(ids)
    const allPresent = expectedIds.every((id) => have.has(id))
    const noneAbsent = absentIds.every((id) => !have.has(id))
    if (allPresent && noneAbsent && (expectedIds.length === 0 || ids.length >= expectedIds.length)) {
      return
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  const finalIds = await fetchRecentlyViewedIds(request, token)
  throw new Error(
    `recently-viewed poll timeout: expected [${expectedIds.join(', ')}], absent [${absentIds.join(', ')}], got [${finalIds.join(', ')}]`,
  )
}
