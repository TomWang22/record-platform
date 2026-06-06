import { apiFetch } from './api-client'
import type { ListingRevision, MarketplaceListing } from './listings-types'
import { normalizeListing } from './listings-types'

export async function fetchListing(id: string, auth = false): Promise<MarketplaceListing> {
  const data = await apiFetch<Record<string, unknown>>(`/api/listings/${id}`, { auth })
  return normalizeListing(data)
}

export async function fetchListingRevisions(
  id: string,
): Promise<ListingRevision[]> {
  const data = await apiFetch<{ items?: ListingRevision[] }>(
    `/api/listings/${id}/revisions`,
    { auth: true },
  )
  return data.items ?? []
}

export async function patchListing(
  id: string,
  body: Record<string, unknown>,
): Promise<MarketplaceListing> {
  const data = await apiFetch<Record<string, unknown>>(`/api/listings/${id}`, {
    method: 'PATCH',
    auth: true,
    data: body,
  })
  const row =
    data.listing && typeof data.listing === 'object'
      ? (data.listing as Record<string, unknown>)
      : data
  return normalizeListing(row)
}

export async function fetchMyListings(): Promise<MarketplaceListing[]> {
  const data = await apiFetch<{
    items?: Record<string, unknown>[]
    listings?: Record<string, unknown>[]
  }>('/api/listings/mine', { auth: true })
  const rows = data.items ?? data.listings ?? []
  return rows.map((row) => normalizeListing(row))
}

export type SearchListingsParams = {
  q?: string
  sort_by?: string
  limit?: number
  offset?: number
  min_price?: string
  max_price?: string
  format?: string
}

export async function browseListings(
  params: SearchListingsParams,
  opts?: { auth?: boolean },
) {
  const [search, mine] = await Promise.all([
    searchListings(params).catch(() => ({ listings: [] as MarketplaceListing[], total: 0 })),
    opts?.auth ? fetchMyListings().catch(() => [] as MarketplaceListing[]) : Promise.resolve([]),
  ])
  const byId = new Map<string, MarketplaceListing>()
  for (const l of [...search.listings, ...mine]) {
    if (l.id) byId.set(l.id, l)
  }
  const merged = [...byId.values()]
  return {
    listings: merged,
    total: Math.max(search.total, merged.length),
  }
}

export async function searchListings(params: SearchListingsParams) {
  const qs = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== '') qs.set(k, String(v))
  })
  const data = await apiFetch<{
    listings?: Record<string, unknown>[]
    items?: Record<string, unknown>[]
    total?: number
  }>(`/api/listings/search?${qs.toString()}`)
  const rows = data.listings ?? data.items ?? []
  return {
    listings: rows.map((r) => normalizeListing(r)),
    total: data.total ?? rows.length,
  }
}
