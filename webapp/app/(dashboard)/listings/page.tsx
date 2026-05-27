'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

import { AuthRequiredCard } from '@/components/auth/auth-required-card'
import { ApiErrorAlert } from '@/components/ui/api-error-alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { apiFetch } from '@/lib/api-client'
import { isSessionAuthenticated, useSession } from '@/lib/use-session'

type Listing = {
  id: string
  title: string
  description?: string
  artist?: string
  release?: string
  format?: string
  label?: string
  catalog_number?: string
  grade?: string
  sleeve_grade?: string
  seller?: string
  shipping_summary?: string
  listing_status?: string
  price?: number
  currency?: string
  listing_type?: 'fixed_price' | 'auction' | 'obo'
  media_type?: string
  country?: string
  year?: number
  has_booklet?: boolean
  has_insert?: boolean
  is_promo?: boolean
  has_obi?: boolean
  location?: string
  fixed_price?: boolean
  created_at?: string
  primary_image?: Array<{
    id: string
    image_url?: string
    thumbnail_url?: string
  }>
}

type SortBy = 'created_at' | 'price' | 'year'
type View = 'grid' | 'list'

function ListingsPageContent() {
  const session = useSession()
  const signedIn = isSessionAuthenticated(session)

  const [listings, setListings] = useState<Listing[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [sortBy, setSortBy] = useState<SortBy>('created_at')
  const [view, setView] = useState<View>('grid')
  const [query, setQuery] = useState('')
  const [mediaType, setMediaType] = useState('')
  const [format, setFormat] = useState('')
  const [grade, setGrade] = useState('')
  const [sleeveGrade, setSleeveGrade] = useState('')
  const [label, setLabel] = useState('')
  const [country, setCountry] = useState('')
  const [year, setYear] = useState('')
  const [seller, setSeller] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [flags, setFlags] = useState({
    has_obi: false,
    has_booklet: false,
    has_insert: false,
    is_promo: false,
  })
  const [guestAction, setGuestAction] = useState('')

  const searchListings = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (query) params.set('q', query)
      if (mediaType) params.set('media_type', mediaType)
      if (format) params.set('format', format)
      if (grade) params.set('grade', grade)
      if (sleeveGrade) params.set('sleeve_grade', sleeveGrade)
      if (label) params.set('label', label)
      if (country) params.set('country', country)
      if (year) params.set('year', year)
      if (seller) params.set('seller', seller)
      if (minPrice) params.set('min_price', minPrice)
      if (maxPrice) params.set('max_price', maxPrice)
      Object.entries(flags).forEach(([key, val]) => {
        if (val) params.set(key, 'true')
      })
      params.set('sort_by', sortBy)
      params.set('limit', '36')

      const data = await apiFetch<{
        listings?: Listing[]
        items?: Listing[]
        total?: number
      }>(`/api/listings/search?${params.toString()}`)

      const rows = data.listings ?? data.items ?? []
      setListings(rows)
      setTotal(data.total ?? rows.length)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [country, flags, format, grade, label, maxPrice, mediaType, minPrice, query, seller, sleeveGrade, sortBy, year])

  useEffect(() => {
    void searchListings()
  }, [searchListings])

  const resultLabel = useMemo(() => {
    if (loading) return 'Loading listings...'
    return `${total} listing${total === 1 ? '' : 's'}`
  }, [loading, total])

  async function requireAuthAction(kind: 'watch' | 'cart', listing: Listing) {
    if (!signedIn) {
      setGuestAction(kind === 'watch' ? 'watch/save items' : 'add to cart')
      return
    }
    const endpoint =
      kind === 'watch' ? '/api/shopping/watchlist' : '/api/cart'
    await apiFetch(endpoint, {
      method: 'POST',
      auth: true,
      data: { itemType: 'listing', itemId: listing.id, quantity: 1 },
    })
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Marketplace Listings</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Browse live inventory with marketplace filters and seller signals.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[280px,1fr]">
        <Card>
          <div className="space-y-3">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search artist, album, label..." className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
            <input value={mediaType} onChange={(e) => setMediaType(e.target.value)} placeholder="Media Type" className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
            <input value={format} onChange={(e) => setFormat(e.target.value)} placeholder="Format" className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
            <div className="grid grid-cols-2 gap-2">
              <input value={minPrice} onChange={(e) => setMinPrice(e.target.value)} placeholder="Min $" className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
              <input value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="Max $" className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
            </div>
            <input value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="Grade" className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
            <input value={sleeveGrade} onChange={(e) => setSleeveGrade(e.target.value)} placeholder="Sleeve Grade" className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label / Catalog #" className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
            <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Country" className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
            <input value={year} onChange={(e) => setYear(e.target.value)} placeholder="Year" className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
            <input value={seller} onChange={(e) => setSeller(e.target.value)} placeholder="Seller / Location" className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
            <div className="grid grid-cols-2 gap-2 text-xs">
              {Object.keys(flags).map((flag) => (
                <label key={flag} className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={flags[flag as keyof typeof flags]}
                    onChange={(e) =>
                      setFlags((prev) => ({ ...prev, [flag]: e.target.checked }))
                    }
                  />
                  {flag}
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <Button onClick={() => void searchListings()} disabled={loading}>Apply</Button>
              <Button variant="secondary" onClick={() => {
                setQuery('')
                setMediaType('')
                setFormat('')
                setGrade('')
                setSleeveGrade('')
                setLabel('')
                setCountry('')
                setYear('')
                setSeller('')
                setMinPrice('')
                setMaxPrice('')
                setFlags({ has_obi: false, has_booklet: false, has_insert: false, is_promo: false })
              }}>Reset</Button>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{resultLabel}</p>
              <div className="flex items-center gap-2">
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} className="rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950">
                  <option value="created_at">Newest</option>
                  <option value="price">Price</option>
                  <option value="year">Year</option>
                </select>
                <div className="rounded-lg border border-slate-200/80 p-1 dark:border-white/10">
                  <button onClick={() => setView('grid')} className={`rounded px-2 py-1 text-xs ${view === 'grid' ? 'bg-brand text-white' : ''}`}>Grid</button>
                  <button onClick={() => setView('list')} className={`rounded px-2 py-1 text-xs ${view === 'list' ? 'bg-brand text-white' : ''}`}>List</button>
                </div>
              </div>
            </div>
          </Card>

          {guestAction && (
            <AuthRequiredCard
              title="Sign in required"
              description={`Sign in to ${guestAction} from marketplace listings.`}
              returnTo="/listings"
            />
          )}

          {error && (
            <ApiErrorAlert title="Listings request failed" error={error} onRetry={() => void searchListings()} />
          )}

          {loading && <p className="text-sm text-slate-500">Loading listings...</p>}

          {!loading && listings.length === 0 && !error && (
            <Card>
              <p className="text-sm text-slate-500 dark:text-slate-400">No listings found for this filter set.</p>
            </Card>
          )}

          {!loading && listings.length > 0 && (
            <div className={view === 'grid' ? 'grid gap-4 md:grid-cols-2 xl:grid-cols-3' : 'space-y-3'}>
              {listings.map((listing) => {
                const image = listing.primary_image?.[0]?.thumbnail_url ?? listing.primary_image?.[0]?.image_url
                return (
                  <Card key={listing.id} className={view === 'list' ? 'flex gap-4' : ''}>
                    <div className={view === 'list' ? 'h-28 w-28 shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800' : 'mb-3 aspect-square overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800'}>
                      {image ? (
                        <img src={image} alt={listing.title} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">No image</div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm text-slate-600 dark:text-slate-300">{listing.artist ?? 'Unknown artist'}</p>
                      <p className="font-semibold text-slate-900 dark:text-white">{listing.release ?? listing.title}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {listing.format ?? listing.media_type ?? 'Format n/a'} · {listing.label ?? 'Label n/a'} · {listing.catalog_number ?? 'Catalog n/a'}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Grade {listing.grade ?? 'N/A'} / Sleeve {listing.sleeve_grade ?? 'N/A'}
                      </p>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-lg font-bold text-slate-900 dark:text-white">
                          {(listing.currency ?? 'USD')} ${(listing.price ?? 0).toFixed(2)}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{listing.shipping_summary ?? 'Shipping details in listing'}</p>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Seller: {listing.seller ?? listing.location ?? 'Unknown'} · Status: {listing.listing_status ?? 'active'}</p>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" size="sm" onClick={() => void requireAuthAction('watch', listing)}>Watch</Button>
                        {listing.fixed_price !== false && listing.listing_type !== 'auction' && (
                          <Button size="sm" onClick={() => void requireAuthAction('cart', listing)}>Add to cart</Button>
                        )}
                        <Button asChild size="sm" variant="ghost">
                          <Link href={`/listings/${listing.id}`}>View details</Link>
                        </Button>
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ListingsPage() {
  return (
    <Suspense fallback={<div className="p-8">Loading listings...</div>}>
      <ListingsPageContent />
    </Suspense>
  )
}

