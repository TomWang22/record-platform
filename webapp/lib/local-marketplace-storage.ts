const WATCHLIST_KEY = 'rp.watchlist'
const RECENT_KEY = 'rp.recently-viewed'
const GUEST_CART_KEY = 'rp.guest-cart-count'

export type StoredListingRef = {
  id: string
  title: string
  artist?: string
  priceCents?: number
  priceDisplay?: string
  imageUrl?: string
  saleType?: string
  saleTypeDisplay?: string
  sellerDisplay?: string
  format?: string
  mediaCondition?: string
  viewedAt?: string
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(key, JSON.stringify(value))
}

export function getWatchlist(): StoredListingRef[] {
  return readJson<StoredListingRef[]>(WATCHLIST_KEY, [])
}

export function isWatched(listingId: string): boolean {
  return getWatchlist().some((x) => x.id === listingId)
}

export function toggleWatchlist(item: StoredListingRef): boolean {
  const list = getWatchlist()
  const idx = list.findIndex((x) => x.id === item.id)
  if (idx >= 0) {
    list.splice(idx, 1)
    writeJson(WATCHLIST_KEY, list)
    return false
  }
  list.unshift(item)
  writeJson(WATCHLIST_KEY, list.slice(0, 200))
  return true
}

export function removeFromWatchlist(listingId: string): void {
  writeJson(
    WATCHLIST_KEY,
    getWatchlist().filter((x) => x.id !== listingId),
  )
}

export function getRecentlyViewed(): StoredListingRef[] {
  return readJson<StoredListingRef[]>(RECENT_KEY, [])
}

export function pushRecentlyViewed(item: StoredListingRef): void {
  const list = getRecentlyViewed().filter((x) => x.id !== item.id)
  list.unshift({ ...item, viewedAt: new Date().toISOString() })
  writeJson(RECENT_KEY, list.slice(0, 50))
}

export function clearRecentlyViewed(): void {
  writeJson(RECENT_KEY, [])
}

export function getGuestCartCount(): number {
  return readJson<number>(GUEST_CART_KEY, 0)
}

export function setGuestCartCount(count: number): void {
  writeJson(GUEST_CART_KEY, Math.max(0, count))
}
