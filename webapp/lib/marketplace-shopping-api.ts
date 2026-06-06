import { apiFetch } from './api-client'
import type { StoredListingRef } from './local-marketplace-storage'

/** Normalized product card from shopping-service BFF (matches listing public contract). */
export type ShoppingProductCard = {
  id: string
  listingId: string
  title: string
  seller: string | null
  sellerId: string | null
  priceDisplay: string | null
  saleTypeDisplay: string | null
  primaryImageUrl: string | null
  format: string | null
  mediaCondition: string | null
  sleeveCondition: string | null
  listedAtDisplay: string | null
  updatedAtDisplay: string | null
  watchlistedAtDisplay?: string | null
  viewedAtDisplay?: string | null
}

export function productCardToStoredRef(card: ShoppingProductCard): StoredListingRef {
  return {
    id: card.listingId,
    title: card.title,
    priceDisplay: card.priceDisplay ?? undefined,
    imageUrl: card.primaryImageUrl ?? undefined,
    saleTypeDisplay: card.saleTypeDisplay ?? undefined,
    sellerDisplay: card.seller ?? undefined,
    format: card.format ?? undefined,
    mediaCondition: card.mediaCondition ?? undefined,
    viewedAt: card.viewedAtDisplay ?? undefined,
  }
}

export function listingRefToMetadata(listing: StoredListingRef): Record<string, unknown> {
  return {
    title: listing.title,
    artist: listing.artist,
    priceDisplay: listing.priceDisplay,
    imageUrl: listing.imageUrl,
    primaryImageUrl: listing.imageUrl,
    saleType: listing.saleType,
    saleTypeDisplay: listing.saleTypeDisplay,
    sellerDisplay: listing.sellerDisplay,
    format: listing.format,
    mediaCondition: listing.mediaCondition,
  }
}

export async function fetchWatchlistFromApi(): Promise<StoredListingRef[]> {
  const data = await apiFetch<{ items?: ShoppingProductCard[] }>('/api/shopping/watchlist', {
    auth: true,
  })
  return (data.items ?? []).map(productCardToStoredRef)
}

export async function addWatchlistOnApi(listing: StoredListingRef): Promise<void> {
  await apiFetch('/api/shopping/watchlist', {
    method: 'POST',
    auth: true,
    data: {
      item_type: 'listing',
      item_id: listing.id,
      listing_id: listing.id,
      metadata: listingRefToMetadata(listing),
    },
  })
}

export async function removeWatchlistOnApi(listingId: string): Promise<void> {
  await apiFetch(`/api/shopping/watchlist/listing/${listingId}`, {
    method: 'DELETE',
    auth: true,
  })
}

export async function fetchRecentlyViewedFromApi(): Promise<StoredListingRef[]> {
  const data = await apiFetch<{ items?: ShoppingProductCard[] }>(
    '/api/shopping/recently-viewed?item_type=listing',
    { auth: true },
  )
  return (data.items ?? []).map(productCardToStoredRef)
}

export async function addRecentlyViewedOnApi(listing: StoredListingRef): Promise<void> {
  await apiFetch('/api/shopping/recently-viewed', {
    method: 'POST',
    auth: true,
    data: {
      item_type: 'listing',
      item_id: listing.id,
      metadata: listingRefToMetadata(listing),
    },
  })
}

export async function clearRecentlyViewedOnApi(itemType = 'listing'): Promise<void> {
  await apiFetch(
    `/api/shopping/recently-viewed?${new URLSearchParams({ item_type: itemType })}`,
    { method: 'DELETE', auth: true },
  )
}

export async function removeRecentlyViewedOnApi(
  listingId: string,
  itemType = 'listing',
): Promise<void> {
  await apiFetch(
    `/api/shopping/recently-viewed?${new URLSearchParams({ item_type: itemType, item_id: listingId })}`,
    { method: 'DELETE', auth: true },
  )
}
