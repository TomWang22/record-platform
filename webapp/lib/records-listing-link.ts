import { apiFetch } from './api-client'
import type { ListingLinkStatus } from './records-types'

type MineListing = {
  id: string
  status?: string
  listing_status?: string
  source_record_id?: string | null
  amenities?: string[] | Record<string, unknown> | null
}

type MineResponse = {
  listings?: MineListing[]
  items?: MineListing[]
}

function amenityMap(raw: MineListing['amenities']): Record<string, string> {
  if (!raw) return {}
  if (Array.isArray(raw)) {
    const out: Record<string, string> = {}
    for (const item of raw) {
      const s = String(item).trim()
      const i = s.indexOf(':')
      if (i > 0) out[s.slice(0, i).trim().toLowerCase()] = s.slice(i + 1).trim()
    }
    return out
  }
  if (typeof raw === 'object') {
    return Object.fromEntries(
      Object.entries(raw)
        .filter(([, v]) => v != null && String(v).trim() !== '')
        .map(([k, v]) => [k.toLowerCase(), String(v).trim()]),
    )
  }
  return {}
}

function listingLinkStatus(listing: MineListing): ListingLinkStatus {
  const st = String(listing.status ?? listing.listing_status ?? 'active').toLowerCase()
  if (st === 'sold' || st === 'closed') return 'sold'
  if (st === 'draft') return 'draft'
  if (st === 'paused') return 'draft'
  return 'published'
}

/** Map collection record id → listing link from seller's active listings. */
export async function fetchListedRecordLinks(): Promise<
  Map<string, { listingId: string; status: ListingLinkStatus }>
> {
  const data = await apiFetch<MineResponse>('/api/listings/mine', { auth: true })
  const rows = data.items ?? data.listings ?? []
  const map = new Map<string, { listingId: string; status: ListingLinkStatus }>()
  for (const row of rows) {
    const meta = amenityMap(row.amenities)
    const recordId =
      meta.source_record_id ??
      (row.source_record_id != null ? String(row.source_record_id).trim() : '')
    if (!recordId) continue
    map.set(recordId, { listingId: row.id, status: listingLinkStatus(row) })
  }
  return map
}
