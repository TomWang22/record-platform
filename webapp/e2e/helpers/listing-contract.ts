import { expect, type APIRequestContext, type Page } from '@playwright/test'

import { with429Retry } from './http-retry'

export type ListingPersistExpectation = {
  imageCount?: number
  primaryIncludes?: string
}

export async function pollListingUntil(
  request: APIRequestContext,
  token: string,
  listingId: string,
  expected: ListingPersistExpectation,
  opts: { timeoutMs?: number } = {},
): Promise<Record<string, unknown>> {
  return waitForListingField(
    request,
    token,
    listingId,
    (row) => {
      const images = (row.images as string[]) ?? []
      if (expected.imageCount !== undefined && images.length !== expected.imageCount) return false
      if (
        expected.primaryIncludes &&
        !String(images[0] ?? '').includes(expected.primaryIncludes)
      ) {
        return false
      }
      return true
    },
    opts,
  )
}

/** Save listing edit, wait for API persistence (incl. media sync), then open detail without relying on router load. */
export async function saveListingAndOpenDetail(
  page: Page,
  request: APIRequestContext,
  token: string,
  listingId: string,
  expected: ListingPersistExpectation,
): Promise<void> {
  await expect(page.getByTestId('listing-edit-ready')).toBeVisible({ timeout: 60_000 })
  const media = page.locator('[data-testid="listing-edit-media"]')
  await expect(media).toBeAttached()
  await expect(page.getByTestId('listing-edit-save')).toBeEnabled()

  const saveResponse = page.waitForResponse(
    (r) =>
      r.request().method() !== 'GET' &&
      r.url().includes(`/api/listings/${listingId}`) &&
      r.ok(),
    { timeout: 60_000 },
  )
  await page.getByTestId('listing-edit-save').click()
  await saveResponse
  await pollListingUntil(request, token, listingId, expected, { timeoutMs: 90_000 })

  const detailRe = new RegExp(`/listings/${listingId.replace(/-/g, '\\-')}$`)
  if (!detailRe.test(new URL(page.url()).pathname)) {
    await page.goto(`/listings/${listingId}`, { waitUntil: 'domcontentloaded' })
  }
  await expect(page.getByTestId('listing-detail-ready')).toBeVisible({ timeout: 60_000 })
}

const PLACEHOLDER_A = 'https://picsum.photos/seed/rp-contract-a/400/400'
const PLACEHOLDER_B = 'https://picsum.photos/seed/rp-contract-b/400/400'
const PLACEHOLDER_C = 'https://picsum.photos/seed/rp-contract-c/400/400'

export type FullShippingSeed = {
  domestic_shipping_cents: number
  international_shipping_cents: number
  shipping_service: string
  package_type: string
  domestic_shipping: boolean
  international_shipping: boolean
  local_pickup: boolean
  combined_shipping: boolean
  shipping_notes: string
  city: string
  state_or_province: string
  country: string
}

export const FULL_SHIPPING: FullShippingSeed = {
  domestic_shipping_cents: 500,
  international_shipping_cents: 1500,
  shipping_service: 'Media Mail',
  package_type: 'LP mailer',
  domestic_shipping: true,
  international_shipping: true,
  local_pickup: false,
  combined_shipping: true,
  shipping_notes: 'Ships within 2 business days.',
  city: 'Brooklyn',
  state_or_province: 'NY',
  country: 'US',
}

export async function createListingWithShipping(
  request: APIRequestContext,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  const payload = {
    title: `E2E Contract Listing ${Date.now()}`,
    description: 'Contract listing with full shipping.',
    price_cents: 4599,
    effective_from: '2026-05-01',
    effective_until: '2027-05-01',
    format: 'LP',
    media_condition: 'VG+',
    sleeve_condition: 'VG',
    pricing_mode: 'fixed',
    initial_status: 'active',
    images: [PLACEHOLDER_A],
    ...FULL_SHIPPING,
    ...overrides,
  }
  let res = await with429Retry('create listing', () =>
    request.post('/api/listings/create', { headers, data: payload }),
  )
  if (!res.ok() && res.status() >= 500) {
    await new Promise((r) => setTimeout(r, 2000))
    res = await with429Retry('create listing retry', () =>
      request.post('/api/listings/create', { headers, data: payload }),
    )
  }
  if (!res.ok()) {
    throw new Error(`create listing failed ${res.status()}: ${(await res.text()).slice(0, 300)}`)
  }
  const row = (await res.json()) as { id?: string }
  if (!row.id) throw new Error('create listing missing id')
  return row.id
}

export async function createTwoImageListing(
  request: APIRequestContext,
  token: string,
): Promise<string> {
  return createListingWithShipping(request, token, {
    images: [PLACEHOLDER_A, PLACEHOLDER_B],
    title: `E2E Media Listing ${Date.now()}`,
  })
}

export async function patchListingAmenitiesMerge(
  request: APIRequestContext,
  token: string,
  listingId: string,
  entries: string[],
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const current = await fetchListingApi(request, token, listingId)
  const existing = Array.isArray(current.amenities)
    ? (current.amenities as string[])
    : []
  const map = new Map<string, string>()
  for (const item of existing) {
    const s = String(item)
    const i = s.indexOf(':')
    if (i > 0) map.set(s.slice(0, i).toLowerCase(), s.slice(i + 1))
  }
  for (const item of entries) {
    const i = item.indexOf(':')
    if (i > 0) map.set(item.slice(0, i).toLowerCase(), item.slice(i + 1))
  }
  const merged = [...map.entries()].map(([k, v]) => `${k}:${v}`)
  return patchListingFields(request, token, listingId, { amenities: merged, ...extra })
}

export async function patchListingFields(
  request: APIRequestContext,
  token: string,
  listingId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await request.patch(`/api/listings/${listingId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: body,
  })
  if (!res.ok()) {
    throw new Error(`PATCH listing failed ${res.status()}: ${(await res.text()).slice(0, 300)}`)
  }
  const data = (await res.json()) as { listing?: Record<string, unknown> }
  return (data.listing ?? data) as Record<string, unknown>
}

export async function waitForListingRevisions(
  request: APIRequestContext,
  token: string,
  listingId: string,
  opts: {
    minCount?: number
    timeoutMs?: number
    newestMatches?: RegExp
  } = {},
): Promise<unknown[]> {
  const minCount = opts.minCount ?? 1
  const timeoutMs = opts.timeoutMs ?? 45_000
  const deadline = Date.now() + timeoutMs
  let last = '[]'
  while (Date.now() < deadline) {
    const res = await with429Retry('listing revisions', () =>
      request.get(`/api/listings/${listingId}/revisions`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    )
    last = await res.text()
    if (res.ok()) {
      const data = JSON.parse(last) as { items?: Record<string, unknown>[] }
      const items = data.items ?? []
      if (items.length >= minCount) {
        if (opts.newestMatches) {
          const sorted = [...items].sort(
            (a, b) =>
              new Date(String(b.created_at ?? 0)).getTime() -
              new Date(String(a.created_at ?? 0)).getTime(),
          )
          const blob = JSON.stringify(sorted[0]?.changes ?? {})
          if (opts.newestMatches.test(blob)) return items
        } else {
          return items
        }
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(
    `revisions not ready (need >=${minCount}${opts.newestMatches ? ' + pattern' : ''}) for ${listingId}: ${last.slice(0, 400)}`,
  )
}

export async function waitForListingField(
  request: APIRequestContext,
  token: string,
  listingId: string,
  assert: (row: Record<string, unknown>) => boolean,
  opts: { timeoutMs?: number } = {},
): Promise<Record<string, unknown>> {
  const timeoutMs = opts.timeoutMs ?? 45_000
  const deadline = Date.now() + timeoutMs
  let last = '{}'
  while (Date.now() < deadline) {
    const row = await fetchListingApi(request, token, listingId)
    last = JSON.stringify(row)
    if (assert(row)) return row
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`listing field not ready for ${listingId}: ${last.slice(0, 400)}`)
}

export async function dumpListingContractDebug(
  request: APIRequestContext,
  token: string,
  listingId: string,
  label: string,
): Promise<string> {
  const listing = await fetchListingApi(request, token, listingId).catch((e) => ({
    error: String(e),
  }))
  const revRes = await request.get(`/api/listings/${listingId}/revisions`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const revisions = await revRes.text().catch(() => '')
  const msg = [
    `[${label}] listingId=${listingId}`,
    `listing=${JSON.stringify(listing).slice(0, 800)}`,
    `revisions_status=${revRes.status()}`,
    `revisions=${revisions.slice(0, 800)}`,
  ].join('\n')
  console.log(msg)
  return msg
}

export async function fetchListingApi(
  request: APIRequestContext,
  token: string,
  listingId: string,
): Promise<Record<string, unknown>> {
  const res = await with429Retry('listing fetch', () =>
    request.get(`/api/listings/${listingId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  )
  if (!res.ok()) {
    throw new Error(`GET listing failed ${res.status()}: ${(await res.text()).slice(0, 300)}`)
  }
  return (await res.json()) as Record<string, unknown>
}

export { PLACEHOLDER_A, PLACEHOLDER_B, PLACEHOLDER_C }
