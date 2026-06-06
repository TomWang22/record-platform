import { apiFetch } from './api-client'
import { normalizeListing, type MarketplaceListing } from './listings-types'

export type ListingMediaItem = {
  id: string
  url_or_path: string
  media_type: string
  sort_order: number
}

export function mediaItemsFromListing(row: Record<string, unknown>): ListingMediaItem[] {
  const raw = row.media_items ?? row.mediaItems
  if (!Array.isArray(raw)) return []
  const out: ListingMediaItem[] = []
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    const id = String(o.id ?? '')
    const url_or_path = String(o.url_or_path ?? '')
    if (!id || !url_or_path) continue
    out.push({
      id,
      url_or_path,
      media_type: String(o.media_type ?? 'image'),
      sort_order: Number(o.sort_order ?? 0),
    })
  }
  return out.sort((a, b) => a.sort_order - b.sort_order)
}

/** Persist gallery edits via media POST/DELETE/PATCH (PATCH listing ignores images[]). */
export async function syncListingMedia(
  listingId: string,
  desiredImageUrls: string[],
  primaryIndex = 0,
): Promise<MarketplaceListing> {
  const row = await apiFetch<Record<string, unknown>>(`/api/listings/${listingId}`, { auth: true })
  const existing = mediaItemsFromListing(row).filter((m) => m.media_type === 'image')
  const existingByUrl = new Map(existing.map((m) => [m.url_or_path, m]))

  const desiredOrdered =
    primaryIndex > 0 && primaryIndex < desiredImageUrls.length
      ? [
          desiredImageUrls[primaryIndex],
          ...desiredImageUrls.filter((_, i) => i !== primaryIndex),
        ]
      : desiredImageUrls.filter(Boolean)

  for (const url of desiredOrdered) {
    if (!existingByUrl.has(url)) {
      await apiFetch(`/api/listings/${listingId}/media`, {
        method: 'POST',
        auth: true,
        data: { media_url: url, media_type: 'image' },
      })
    }
  }

  const refreshed = await apiFetch<Record<string, unknown>>(`/api/listings/${listingId}`, {
    auth: true,
  })
  const current = mediaItemsFromListing(refreshed).filter((m) => m.media_type === 'image')
  const currentByUrl = new Map(current.map((m) => [m.url_or_path, m]))

  for (const m of current) {
    if (!desiredOrdered.includes(m.url_or_path)) {
      await apiFetch(`/api/listings/${listingId}/media/${m.id}`, {
        method: 'DELETE',
        auth: true,
      })
    }
  }

  const afterDelete = await apiFetch<Record<string, unknown>>(`/api/listings/${listingId}`, {
    auth: true,
  })
  const remaining = mediaItemsFromListing(afterDelete).filter((m) => m.media_type === 'image')
  const orderedIds = desiredOrdered
    .map((url) => remaining.find((m) => m.url_or_path === url)?.id)
    .filter((id): id is string => Boolean(id))

  if (orderedIds.length === remaining.length && orderedIds.length > 0) {
    await apiFetch(`/api/listings/${listingId}/media-order`, {
      method: 'PATCH',
      auth: true,
      data: { ordered_media_ids: orderedIds },
    })
  }

  const finalRow = await apiFetch<Record<string, unknown>>(`/api/listings/${listingId}`, {
    auth: true,
  })
  return normalizeListing(finalRow)
}
