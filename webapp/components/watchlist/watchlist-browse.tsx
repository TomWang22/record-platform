'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ApiErrorAlert } from '@/components/ui/api-error-alert'
import { formatMoneyFromCents, saleTypeLabel } from '@/lib/listing-format'
import { fetchListing } from '@/lib/listings-api'
import { listingToStoredRef } from '@/lib/listings-types'
import type { StoredListingRef } from '@/lib/local-marketplace-storage'
import {
  fetchWatchlistFromApi,
  removeWatchlistOnApi,
} from '@/lib/marketplace-shopping-api'

const PAGE_SIZES = [24, 48, 72, 120] as const
type ViewMode = 'grid' | 'list' | 'compact'
type SortKey = 'newest' | 'oldest'

function displayPrice(item: StoredListingRef): string {
  if (item.priceDisplay) return item.priceDisplay
  if (item.priceCents != null) return formatMoneyFromCents(item.priceCents)
  return '—'
}

function displaySale(item: StoredListingRef): string {
  return item.saleTypeDisplay ?? saleTypeLabel(item.saleType)
}

function WatchlistCard({
  item,
  view,
  onRemove,
}: {
  item: StoredListingRef
  view: ViewMode
  onRemove: (id: string) => void
}) {
  const price = displayPrice(item)
  const sale = displaySale(item)
  const condition = item.mediaCondition ?? item.format ?? 'Vinyl'

  if (view === 'list') {
    return (
      <div
        data-testid="watchlist-item"
        className="flex items-center gap-4 rounded-xl border border-slate-200/80 bg-white p-3 dark:border-white/10 dark:bg-slate-950"
      >
        <Link
          href={`/listings/${item.id}`}
          className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800"
        >
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-lg text-slate-400">
              ♪
            </div>
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900 dark:text-white">{item.title}</p>
          {item.artist && <p className="text-xs text-slate-500">{item.artist}</p>}
          <p className="text-xs text-slate-500">
            {price} · {sale} · {item.format ?? 'LP'} · {condition}
          </p>
          <p className="text-xs text-slate-500">{item.sellerDisplay ?? 'Seller'}</p>
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          <Button size="sm" asChild>
            <Link href={`/listings/${item.id}`}>View listing</Link>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            data-testid="watchlist-remove"
            onClick={() => onRemove(item.id)}
          >
            Remove
          </Button>
        </div>
      </div>
    )
  }

  const compact = view === 'compact'
  return (
    <div data-testid="watchlist-item">
    <Card className="overflow-hidden p-0">
      <Link href={`/listings/${item.id}`} className="block">
        <div className={compact ? 'aspect-[4/3]' : 'aspect-square'}>
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand/20 to-slate-200 text-2xl text-slate-500 dark:from-brand/30 dark:to-slate-800">
              ♪
            </div>
          )}
        </div>
        <div className="space-y-1 p-3">
          {item.artist && <p className="truncate text-xs text-slate-500">{item.artist}</p>}
          <h3 className="line-clamp-2 font-semibold">{item.title}</h3>
          <p className="text-xs text-slate-500">
            {[item.format, condition].filter(Boolean).join(' · ')}
          </p>
          <p className="text-lg font-bold">{price}</p>
          <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase dark:bg-slate-800">
            {sale}
          </span>
          <p className="text-xs text-slate-500">{item.sellerDisplay ?? 'Seller'}</p>
        </div>
      </Link>
      <div className="flex gap-2 border-t border-slate-100 px-3 py-2 dark:border-white/5">
        <Button size="sm" className="flex-1" asChild>
          <Link href={`/listings/${item.id}`}>View listing</Link>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          data-testid="watchlist-remove"
          onClick={() => onRemove(item.id)}
        >
          Remove
        </Button>
      </div>
    </Card>
    </div>
  )
}

async function enrichWatchlistRow(row: StoredListingRef): Promise<StoredListingRef> {
  if (row.imageUrl && row.priceDisplay && row.sellerDisplay) return row
  try {
    const listing = await fetchListing(row.id, true)
    return listingToStoredRef(listing)
  } catch {
    return row
  }
}

export function WatchlistBrowse() {
  const [items, setItems] = useState<StoredListingRef[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [query, setQuery] = useState('')
  const [view, setView] = useState<ViewMode>('grid')
  const [sort, setSort] = useState<SortKey>('newest')
  const [pageSize, setPageSize] = useState<number>(24)
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await fetchWatchlistFromApi()
      const enriched = await Promise.all(rows.map(enrichWatchlistRow))
      setItems(enriched)
    } catch (err) {
      setError(err)
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = items
    if (q) {
      list = list.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          (i.artist?.toLowerCase().includes(q) ?? false) ||
          (i.sellerDisplay?.toLowerCase().includes(q) ?? false),
      )
    }
    return [...list].sort((a, b) => {
      const ta = new Date(a.viewedAt ?? 0).getTime()
      const tb = new Date(b.viewedAt ?? 0).getTime()
      return sort === 'newest' ? tb - ta : ta - tb
    })
  }, [items, query, sort])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const pageItems = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  async function handleRemove(id: string) {
    await removeWatchlistOnApi(id)
    await load()
  }

  return (
    <div className="space-y-6" data-testid="watchlist-page-ready">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Watchlist</h1>
          <p className="text-sm text-slate-500">Listings you are watching on the marketplace.</p>
        </div>
        <Button variant="ghost" asChild>
          <Link href="/listings">Browse listings</Link>
        </Button>
      </div>

      <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-white/10 dark:bg-slate-950">
        <div className="flex flex-wrap items-center gap-2">
          <input
            data-testid="watchlist-search"
            placeholder="Search title, artist, seller…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(1)
            }}
            className="min-w-[200px] flex-1 rounded-xl border border-slate-200/80 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-900"
          />
          <label className="flex items-center gap-2 text-sm">
            Sort
            <select
              data-testid="watchlist-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-lg border border-slate-200/80 px-2 py-1 text-sm dark:border-white/10 dark:bg-slate-900"
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-500">
            {filtered.length} listing{filtered.length === 1 ? '' : 's'}
          </p>
          <div className="flex gap-1">
            {(['grid', 'list', 'compact'] as const).map((mode) => (
              <Button
                key={mode}
                type="button"
                size="sm"
                variant={view === mode ? 'default' : 'ghost'}
                data-testid={`watchlist-view-${mode}`}
                onClick={() => setView(mode)}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <ApiErrorAlert title="Could not load watchlist" error={error} onRetry={() => void load()} />
      )}

      {loading && <p className="text-sm text-slate-500">Loading watchlist…</p>}

      {!loading && filtered.length === 0 && (
        <div data-testid="watchlist-empty-state-ready">
          <Card>
            <p className="text-sm text-slate-500">
              No watched listings yet. Use Watch on a listing card.
            </p>
          </Card>
        </div>
      )}

      {!loading && pageItems.length > 0 && view === 'grid' && (
        <div
          data-testid="watchlist-grid"
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {pageItems.map((item) => (
            <WatchlistCard key={item.id} item={item} view="grid" onRemove={handleRemove} />
          ))}
        </div>
      )}

      {!loading && pageItems.length > 0 && view === 'compact' && (
        <div
          data-testid="watchlist-compact"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {pageItems.map((item) => (
            <WatchlistCard key={item.id} item={item} view="compact" onRemove={handleRemove} />
          ))}
        </div>
      )}

      {!loading && pageItems.length > 0 && view === 'list' && (
        <div data-testid="watchlist-list" className="space-y-3">
          {pageItems.map((item) => (
            <WatchlistCard key={item.id} item={item} view="list" onRemove={handleRemove} />
          ))}
        </div>
      )}
    </div>
  )
}
