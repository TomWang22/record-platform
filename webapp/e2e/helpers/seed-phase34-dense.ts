/**
 * Dense deterministic seed for Phase 34 dated screenshot packs.
 * Synthetic contract-account data only — no production identities.
 */
import type { APIRequestContext } from '@playwright/test'

import { createListingWithShipping } from './listing-contract'
import { with429Retry } from './http-retry'
import { vinylCoverForIndex } from './vinyl-cover-fixtures'

function coverFor(index: number): string {
  return vinylCoverForIndex(index)
}

const ARTISTS = [
  'Kenny Dorham',
  'Art Blakey',
  'Miles Davis',
  'John Coltrane',
  'Thelonious Monk',
  'Bill Evans',
  'Charles Mingus',
  'Herbie Hancock',
  'Wayne Shorter',
  'Lee Morgan',
  'Horace Silver',
  'Cannonball Adderley',
] as const

const TITLES = [
  'Quiet Kenny',
  'Moanin',
  'Kind of Blue',
  'Blue Train',
  'Brilliant Corners',
  'Sunday at the Village Vanguard',
  'Mingus Ah Um',
  'Maiden Voyage',
  'Speak No Evil',
  'The Sidewinder',
  'Song for My Father',
  'Somethin Else',
] as const

const LABELS = ['Blue Note', 'Columbia', 'Impulse!', 'Prestige', 'Verve', 'Riverside'] as const
const FORMATS = ['LP', '12"', '7"', 'EP'] as const
const CURRENCIES = ['USD', 'EUR', 'GBP'] as const

export type Phase34DenseSeedSummary = {
  records: number
  listings: number
  watchlist: number
  exactPressingRecords: number
  ambiguousRecords: number
  auctionListings: number
  oboListings: number
  fixedListings: number
}

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-RP-E2E-Contract': '1',
  }
}

async function listRecords(request: APIRequestContext, token: string): Promise<{ id: string; artist?: string; catalogNumber?: string }[]> {
  const res = await with429Retry('records list dense', () =>
    request.get('/api/records', { headers: authHeaders(token) }),
  )
  if (!res.ok()) return []
  const body = (await res.json()) as unknown
  return Array.isArray(body) ? (body as { id: string; artist?: string; catalogNumber?: string }[]) : []
}

async function listMine(request: APIRequestContext, token: string): Promise<{ id: string }[]> {
  const res = await with429Retry('listings mine dense', () =>
    request.get('/api/listings/mine', { headers: authHeaders(token) }),
  )
  if (!res.ok()) return []
  const body = (await res.json()) as { items?: { id: string }[]; listings?: { id: string }[] }
  return body.items ?? body.listings ?? []
}

async function createRecord(
  request: APIRequestContext,
  token: string,
  index: number,
  ambiguous: boolean,
): Promise<string | null> {
  const artist = ARTISTS[index % ARTISTS.length]
  const name = TITLES[index % TITLES.length]
  const catalogNumber = ambiguous ? '' : `P34-${String(1000 + index).padStart(4, '0')}`
  const res = await with429Retry(`record create ${index}`, () =>
    request.post('/api/records', {
      headers: authHeaders(token),
      data: {
        artist,
        name: `${name} ${ambiguous ? 'Ambiguous' : 'Exact'} ${index}`,
        format: FORMATS[index % FORMATS.length],
        catalogNumber,
        label: LABELS[index % LABELS.length],
        country: index % 3 === 0 ? 'US' : index % 3 === 1 ? 'UK' : 'JP',
        releaseYear: 1958 + (index % 40),
        purchaseType: index % 2 === 0 ? 'fixed_price' : 'auction_win',
        purchasePriceCents: 1500 + index * 37,
        purchaseCurrency: CURRENCIES[index % CURRENCIES.length],
        purchasedAt: `2025-${String((index % 12) + 1).padStart(2, '0')}-15T00:00:00Z`,
        shippedAt: `2025-${String((index % 12) + 1).padStart(2, '0')}-18T00:00:00Z`,
        receivedAt: `2025-${String((index % 12) + 1).padStart(2, '0')}-22T00:00:00Z`,
        purchaseSource: 'Contract Seed',
        sellerName: 'Dense Seed Seller',
        mediaPieces: [{ kind: 'VINYL', index: 1, urlOrPath: coverFor(index) }],
      },
    }),
  )
  if (!res.ok()) return null
  const body = (await res.json()) as { id?: string }
  return body.id ?? null
}

/**
 * Ensure the contract account has dense synthetic inventory for screenshot packs.
 * Targets (best-effort with rate-limit retries):
 * - >=60 records (>=40 exact pressing, >=12 ambiguous)
 * - >=40 seller inventory listings (mix of fixed/obo/auction)
 * - >=30 watchlist entries when public listings exist
 */
export async function ensurePhase34DenseSeed(
  request: APIRequestContext,
  token: string,
  opts: {
    targetRecords?: number
    targetListings?: number
    targetWatchlist?: number
    /** Token used when posting watchlist entries (defaults to `token`). */
    watchlistActorToken?: string
    /** Prefer watching this account's mine listings (other seller/buyer). */
    listingPoolToken?: string
    /** Fail closed when watchlist is below this count (default 5). */
    requireMinWatchlist?: number
  } = {},
): Promise<Phase34DenseSeedSummary> {
  const targetRecords = opts.targetRecords ?? 60
  const targetListings = opts.targetListings ?? 40
  const targetWatchlist = opts.targetWatchlist ?? 30

  let records = await listRecords(request, token)
  let exactPressingRecords = records.filter((r) => Boolean(r.catalogNumber?.trim())).length
  let ambiguousRecords = records.filter((r) => !r.catalogNumber?.trim()).length

  let guard = 0
  while (records.length < targetRecords && guard < targetRecords + 20) {
    const ambiguous = ambiguousRecords < 12 || guard % 5 === 0
    const id = await createRecord(request, token, records.length + guard, ambiguous)
    guard += 1
    if (!id) continue
    if (ambiguous) ambiguousRecords += 1
    else exactPressingRecords += 1
    records.push({ id, catalogNumber: ambiguous ? '' : `P34-${records.length}` })
  }

  records = await listRecords(request, token)
  exactPressingRecords = records.filter((r) => Boolean(r.catalogNumber?.trim())).length
  ambiguousRecords = records.filter((r) => !r.catalogNumber?.trim()).length

  let mine = await listMine(request, token)
  let auctionListings = 0
  let oboListings = 0
  let fixedListings = 0
  let listingGuard = 0
  while (mine.length < targetListings && listingGuard < targetListings + 15) {
    const i = mine.length + listingGuard
    const mode = i % 3 === 0 ? 'auction' : i % 3 === 1 ? 'obo' : 'fixed'
    const source = records[i % Math.max(records.length, 1)]
    try {
      const overrides: Record<string, unknown> = {
        title: `Phase34 dense ${mode} ${i} — ${ARTISTS[i % ARTISTS.length]}`,
        price_cents: 2000 + i * 125,
        images: [coverFor(i)],
      }
      if (source?.id) overrides.source_record_id = source.id
      if (mode === 'auction') {
        overrides.pricing_mode = 'auction'
        overrides.auction_starts_at = new Date(Date.now() + 60_000).toISOString()
        overrides.auction_ends_at = new Date(Date.now() + 7 * 86_400_000).toISOString()
        overrides.starting_bid_cents = 1500 + i * 50
      } else if (mode === 'obo') {
        overrides.pricing_mode = 'obo'
        overrides.obo_enabled = true
        overrides.min_offer_cents = 1000 + i * 40
      } else {
        overrides.pricing_mode = 'fixed'
      }
      await createListingWithShipping(request, token, overrides)
      if (mode === 'auction') auctionListings += 1
      else if (mode === 'obo') oboListings += 1
      else fixedListings += 1
    } catch {
      /* rate limit / validation — continue */
    }
    listingGuard += 1
    if (listingGuard % 5 === 0) mine = await listMine(request, token)
  }
  mine = await listMine(request, token)

  let watchlist = 0
  const watcherToken = opts.watchlistActorToken || token
  const watcherMine = new Set((await listMine(request, watcherToken)).map((m) => m.id))
  const candidateIds: string[] = []
  // Cross-account: watch the pool account's mine list first (deterministic).
  if (opts.listingPoolToken) {
    for (const row of await listMine(request, opts.listingPoolToken)) {
      if (watcherMine.has(row.id)) continue
      if (!candidateIds.includes(row.id)) candidateIds.push(row.id)
    }
  }
  for (const q of [
    '/api/listings/search?limit=80',
    '/api/listings/search?q=Blue&limit=80',
    '/api/listings/search?q=Kenny&limit=80',
  ]) {
    const search = await with429Retry(`listings search dense ${q}`, () =>
      request.get(q, { headers: authHeaders(watcherToken) }),
    )
    if (!search.ok()) continue
    const body = (await search.json()) as { items?: { id: string }[]; listings?: { id: string }[] }
    for (const item of body.items ?? body.listings ?? []) {
      if (!item?.id || watcherMine.has(item.id)) continue
      if (!candidateIds.includes(item.id)) candidateIds.push(item.id)
    }
  }
  for (const listingId of candidateIds.slice(0, targetWatchlist)) {
    const res = await request.post('/api/shopping/watchlist', {
      headers: authHeaders(watcherToken),
      data: {
        item_type: 'listing',
        item_id: listingId,
        listing_id: listingId,
      },
    })
    if (res.ok() || res.status() === 409) watchlist += 1
  }
  const minWatch = opts.requireMinWatchlist ?? 5
  if (watchlist < minWatch) {
    throw new Error(
      `WATCHLIST_UNDERFILLED: dense seed watchlist=${watchlist} (need >=${minWatch} other-seller lots); candidates=${candidateIds.length}`,
    )
  }

  return {
    records: records.length,
    listings: mine.length,
    watchlist,
    exactPressingRecords,
    ambiguousRecords,
    auctionListings,
    oboListings,
    fixedListings,
  }
}
