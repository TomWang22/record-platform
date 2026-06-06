'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { ApiErrorAlert } from '@/components/ui/api-error-alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { browseListings } from '@/lib/listings-api'
import { isSessionAuthenticated, useSession } from '@/lib/use-session'
import {
  LISTINGS_PAGE_SIZES,
  type ListingsSortKey,
  type ListingsViewMode,
  type MarketplaceListing,
} from '@/lib/listings-types'

import { ListingCard } from './listing-card'
import { ListingListRow } from './listing-list-row'

const VIEW_KEY = 'rp.listings.view'
const PAGE_SIZE_KEY = 'rp.listings.pageSize'

function sortListings(items: MarketplaceListing[], sort: ListingsSortKey): MarketplaceListing[] {
  const copy = [...items]
  switch (sort) {
    case 'price_asc':
      return copy.sort((a, b) => (a.price ?? 0) - (b.price ?? 0))
    case 'price_desc':
      return copy.sort((a, b) => (b.price ?? 0) - (a.price ?? 0))
    case 'recently_sold':
      return copy.sort(
        (a, b) =>
          new Date(b.sold_at ?? 0).getTime() - new Date(a.sold_at ?? 0).getTime(),
      )
    case 'newly_listed':
      return copy.sort(
        (a, b) =>
          new Date(b.listed_at ?? b.created_at ?? 0).getTime() -
          new Date(a.listed_at ?? a.created_at ?? 0).getTime(),
      )
    default:
      return copy
  }
}

export function ListingsBrowse() {
  const session = useSession()
  const signedIn = isSessionAuthenticated(session)
  const [listings, setListings] = useState<MarketplaceListing[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [query, setQuery] = useState('')
  const [format, setFormat] = useState('')
  const [grade, setGrade] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [saleType, setSaleType] = useState('')
  const [showSold, setShowSold] = useState(false)
  const [availableOnly, setAvailableOnly] = useState(true)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [sort, setSort] = useState<ListingsSortKey>('newly_listed')
  const [view, setView] = useState<ListingsViewMode>('grid')
  const [pageSize, setPageSize] = useState<number>(24)
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const v = localStorage.getItem(VIEW_KEY) as ListingsViewMode | null
    if (v === 'grid' || v === 'list' || v === 'compact') setView(v)
    const ps = Number(localStorage.getItem(PAGE_SIZE_KEY))
    if (LISTINGS_PAGE_SIZES.includes(ps as (typeof LISTINGS_PAGE_SIZES)[number])) {
      setPageSize(ps)
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const sort_by =
        sort === 'price_asc' || sort === 'price_desc'
          ? 'price'
          : sort === 'newly_listed'
            ? 'created_at'
            : 'created_at'
      const { listings: rows, total: t } = await browseListings(
        {
          q: query || undefined,
          format: format || undefined,
          min_price: minPrice || undefined,
          max_price: maxPrice || undefined,
          sort_by,
          limit: pageSize,
          offset,
        },
        { auth: signedIn },
      )
      let filtered = rows
      if (grade) filtered = filtered.filter((l) => l.grade?.includes(grade))
      if (saleType === 'obo') filtered = filtered.filter((l) => l.pricing_mode === 'obo')
      if (saleType === 'fixed') filtered = filtered.filter((l) => l.pricing_mode !== 'obo')
      if (!showSold) {
        filtered = filtered.filter((l) => {
          const s = String(l.status ?? l.listing_status ?? 'active').toLowerCase()
          return s !== 'sold' && s !== 'closed' && s !== 'archived'
        })
      }
      if (availableOnly) {
        filtered = filtered.filter((l) => {
          const s = String(l.status ?? l.listing_status ?? 'active').toLowerCase()
          return !['sold', 'closed', 'archived'].includes(s)
        })
      }
      setListings(sortListings(filtered, sort))
      setTotal(t)
    } catch (err) {
      setError(err)
      setListings([])
    } finally {
      setLoading(false)
    }
  }, [
    availableOnly,
    format,
    grade,
    maxPrice,
    minPrice,
    offset,
    pageSize,
    query,
    saleType,
    showSold,
    sort,
    signedIn,
  ])

  useEffect(() => {
    void load()
  }, [load])

  const resultLabel = useMemo(() => {
    if (loading) return 'Loading marketplace…'
    return `${listings.length} of ${total} listing${total === 1 ? '' : 's'}`
  }, [loading, listings.length, total])

  function persistView(v: ListingsViewMode) {
    setView(v)
    localStorage.setItem(VIEW_KEY, v)
  }

  function persistPageSize(n: number) {
    setPageSize(n)
    setOffset(0)
    localStorage.setItem(PAGE_SIZE_KEY, String(n))
  }

  const filterPanel = (
    <div className="space-y-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search artist, album, label…"
        className="w-full rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950"
      />
      <input
        value={format}
        onChange={(e) => setFormat(e.target.value)}
        placeholder="Format (LP, CD…)"
        className="w-full rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950"
      />
      <input
        value={grade}
        onChange={(e) => setGrade(e.target.value)}
        placeholder="Grade"
        className="w-full rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          value={minPrice}
          onChange={(e) => setMinPrice(e.target.value)}
          placeholder="Min $"
          className="w-full rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950"
        />
        <input
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
          placeholder="Max $"
          className="w-full rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950"
        />
      </div>
      <select
        value={saleType}
        onChange={(e) => setSaleType(e.target.value)}
        className="w-full rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950"
      >
        <option value="">All sale types</option>
        <option value="fixed">Buy it now</option>
        <option value="obo">Best offer</option>
        <option value="auction">Auction</option>
      </select>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={showSold} onChange={(e) => setShowSold(e.target.checked)} />
        Include sold listings
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={availableOnly}
          onChange={(e) => setAvailableOnly(e.target.checked)}
        />
        Available only
      </label>
      <div className="flex gap-2">
        <Button onClick={() => { setOffset(0); void load() }} disabled={loading}>
          Apply filters
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setQuery('')
            setFormat('')
            setGrade('')
            setMinPrice('')
            setMaxPrice('')
            setSaleType('')
            setShowSold(false)
            setAvailableOnly(true)
            setOffset(0)
          }}
        >
          Reset
        </Button>
      </div>
      <Button variant="ghost" className="w-full text-xs" disabled title="Coming soon">
        Save search (soon)
      </Button>
    </div>
  )

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold">Marketplace</h1>
        <p className="text-sm text-slate-500">Browse vinyl and media listings from collectors.</p>
      </header>

      <div className="flex gap-2 lg:hidden">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void load()}
          placeholder="Search marketplace…"
          className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950"
        />
        <Button variant="secondary" onClick={() => setMobileFiltersOpen((o) => !o)}>
          Filters
        </Button>
      </div>
      {mobileFiltersOpen && <Card className="lg:hidden">{filterPanel}</Card>}

      <div className="grid gap-5 lg:grid-cols-[260px,1fr]">
        <Card className="hidden lg:block">{filterPanel}</Card>

        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-medium">{resultLabel}</p>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as ListingsSortKey)}
                  className="rounded-xl border px-2 py-1.5 text-sm dark:border-white/10 dark:bg-slate-950"
                >
                  <option value="best_match">Best match</option>
                  <option value="newly_listed">Newly listed</option>
                  <option value="ending_soon">Ending soon</option>
                  <option value="price_asc">Price: low to high</option>
                  <option value="price_desc">Price: high to low</option>
                  <option value="recently_sold">Recently sold</option>
                </select>
                <select
                  value={pageSize}
                  onChange={(e) => persistPageSize(Number(e.target.value))}
                  className="rounded-xl border px-2 py-1.5 text-sm dark:border-white/10 dark:bg-slate-950"
                >
                  {LISTINGS_PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n} / page
                    </option>
                  ))}
                </select>
                <div className="rounded-lg border p-0.5 dark:border-white/10">
                  {(['grid', 'list', 'compact'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => persistView(v)}
                      className={`rounded px-2 py-1 text-xs capitalize ${view === v ? 'bg-brand text-white' : ''}`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          {error && (
            <ApiErrorAlert title="Could not load listings" error={error} onRetry={() => void load()} />
          )}

          {!loading && !error && listings.length === 0 && (
            <Card className="text-center">
              <p className="text-sm text-slate-500">No listings match your filters.</p>
              <Button className="mt-4" asChild>
                <Link href="/sell">Create a listing</Link>
              </Button>
            </Card>
          )}

          {loading && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-48 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800"
                />
              ))}
            </div>
          )}

          {!loading && !error && listings.length > 0 && (
            <div
              className={
                view === 'grid'
                  ? 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3'
                  : view === 'compact'
                    ? 'grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'
                    : 'space-y-3'
              }
            >
              {listings.map((listing) =>
                view === 'list' ? (
                  <ListingListRow key={listing.id} listing={listing} />
                ) : (
                  <ListingCard key={listing.id} listing={listing} compact={view === 'compact'} />
                ),
              )}
            </div>
          )}

          {total > pageSize && (
            <div className="flex justify-center gap-2">
              <Button
                variant="secondary"
                disabled={offset === 0 || loading}
                onClick={() => setOffset((o) => Math.max(0, o - pageSize))}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                disabled={offset + pageSize >= total || loading}
                onClick={() => setOffset((o) => o + pageSize)}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
