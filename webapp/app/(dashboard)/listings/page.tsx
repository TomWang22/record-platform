'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ApiError, apiFetch } from '@/lib/api-client'

type Listing = {
  id: string
  title: string
  description?: string
  price: number
  currency: string
  listing_type?: 'fixed_price' | 'auction' | 'obo' | 'best_offer'
  media_type?: string
  has_obi?: boolean
  label_type?: string
  condition?: string
  location?: string
  created_at: string
  expires_at?: string
  popularity_score?: number
  seller_rating?: number
  seller_rating_count?: number
  auction_info?: {
    end_time: string
    current_bid?: number
    starting_bid: number
    bid_count: number
    hours_remaining?: number
    status: 'active' | 'ending_soon' | 'ending_today' | 'ended'
  }
  primary_image?: Array<{
    id: string
    image_url: string
    thumbnail_url?: string
    is_primary: boolean
  }>
}

type MediaType = 'LP' | '12"' | '10"' | '7"' | 'CD' | 'EP' | 'CASSETTE' | 'OTHER'
type SortOption = 'created_at' | 'price' | 'popularity' | 'label_type'
type SortOrder = 'asc' | 'desc'

const MEDIA_TYPES: MediaType[] = ['LP', '12"', '10"', '7"', 'CD', 'EP', 'CASSETTE', 'OTHER']

export default function ListingsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  
  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  
  // Filters
  const [query, setQuery] = useState(searchParams.get('q') || '')
  const [mediaType, setMediaType] = useState<MediaType | ''>(searchParams.get('media_type') || '')
  const [hasObi, setHasObi] = useState<boolean | null>(
    searchParams.get('has_obi') === 'true' ? true : searchParams.get('has_obi') === 'false' ? false : null
  )
  const [minPrice, setMinPrice] = useState(searchParams.get('min_price') || '')
  const [maxPrice, setMaxPrice] = useState(searchParams.get('max_price') || '')
  const [labelType, setLabelType] = useState(searchParams.get('label_type') || '')
  const [sortBy, setSortBy] = useState<SortOption>((searchParams.get('sort_by') as SortOption) || 'created_at')
  const [sortOrder, setSortOrder] = useState<SortOrder>((searchParams.get('sort_order') as SortOrder) || 'desc')

  const searchListings = useCallback(async () => {
    setLoading(true)
    setError('')
    
    try {
      const params = new URLSearchParams()
      if (query) params.set('q', query)
      if (mediaType) params.set('media_type', mediaType)
      if (hasObi !== null) params.set('has_obi', String(hasObi))
      if (minPrice) params.set('min_price', minPrice)
      if (maxPrice) params.set('max_price', maxPrice)
      if (labelType) params.set('label_type', labelType)
      params.set('sort_by', sortBy)
      params.set('sort_order', sortOrder)
      params.set('limit', '50')

      const data = await apiFetch<{ listings: Listing[]; count: number }>(
        `/listings/search?${params.toString()}`
      )
      
      setListings(data.listings || [])
      
      // Update URL without navigation
      router.replace(`/listings?${params.toString()}`, { scroll: false })
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || 'Failed to load listings')
      } else {
        setError('An unexpected error occurred')
      }
    } finally {
      setLoading(false)
    }
  }, [query, mediaType, hasObi, minPrice, maxPrice, labelType, sortBy, sortOrder, router])

  useEffect(() => {
    void searchListings()
  }, [searchListings])

  const handleSortChange = (newSortBy: SortOption) => {
    if (sortBy === newSortBy) {
      // Toggle order if same sort
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(newSortBy)
      setSortOrder('desc')
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Browse Listings</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Discover vinyl records, CDs, and more from collectors worldwide.
        </p>
      </header>

      {/* Filters */}
      <Card>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {/* Search Query */}
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">
                Search
              </label>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Artist, title, catalog #..."
                className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
              />
            </div>

            {/* Media Type */}
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">
                Media Type
              </label>
              <select
                value={mediaType}
                onChange={(e) => setMediaType(e.target.value as MediaType | '')}
                className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
              >
                <option value="">All Types</option>
                {MEDIA_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            {/* Price Range */}
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">
                Min Price
              </label>
              <input
                type="number"
                step="0.01"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">
                Max Price
              </label>
              <input
                type="number"
                step="0.01"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                placeholder="No limit"
                className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* OBI Filter */}
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">
                OBI Strip
              </label>
              <select
                value={hasObi === null ? '' : hasObi ? 'true' : 'false'}
                onChange={(e) => {
                  const val = e.target.value
                  setHasObi(val === '' ? null : val === 'true')
                }}
                className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
              >
                <option value="">Any</option>
                <option value="true">Has OBI</option>
                <option value="false">No OBI</option>
              </select>
            </div>

            {/* Label Type */}
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">
                Label
              </label>
              <input
                type="text"
                value={labelType}
                onChange={(e) => setLabelType(e.target.value)}
                placeholder="e.g., Blue Note, Columbia..."
                className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
              />
            </div>

            {/* Sort */}
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">
                Sort By
              </label>
              <div className="flex gap-2">
                <select
                  value={sortBy}
                  onChange={(e) => handleSortChange(e.target.value as SortOption)}
                  className="flex-1 rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
                >
                  <option value="created_at">Arrival Date</option>
                  <option value="popularity">Popularity</option>
                  <option value="price">Price</option>
                  <option value="label_type">Label Type</option>
                </select>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                  className="px-3"
                >
                  {sortOrder === 'asc' ? '↑' : '↓'}
                </Button>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={() => void searchListings()} disabled={loading}>
              {loading ? 'Searching...' : 'Apply Filters'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setQuery('')
                setMediaType('')
                setHasObi(null)
                setMinPrice('')
                setMaxPrice('')
                setLabelType('')
                setSortBy('created_at')
                setSortOrder('desc')
              }}
            >
              Clear
            </Button>
          </div>
        </div>
      </Card>

      {/* Results */}
      {error && (
        <div className="rounded-xl border border-rose-200/80 bg-rose-50 p-3 text-sm text-rose-600 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-400">
          {error}
        </div>
      )}

      {loading && <p className="text-sm text-slate-500">Loading listings...</p>}

      {!loading && listings.length === 0 && !error && (
        <Card>
          <p className="text-sm text-slate-500 dark:text-slate-400">No listings found. Try adjusting your filters.</p>
        </Card>
      )}

      {!loading && listings.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {listings.map((listing) => (
            <Link key={listing.id} href={`/listings/${listing.id}`}>
              <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
                {listing.primary_image && listing.primary_image.length > 0 && (
                  <div className="aspect-square w-full overflow-hidden rounded-t-xl bg-slate-100 dark:bg-slate-800 mb-3">
                    <img
                      src={listing.primary_image[0].thumbnail_url || listing.primary_image[0].image_url}
                      alt={listing.title}
                      className="h-full w-full object-cover"
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <h3 className="font-semibold text-slate-900 dark:text-white line-clamp-2">
                    {listing.title}
                  </h3>
                  <div className="flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                    {listing.media_type && <span>{listing.media_type}</span>}
                    {listing.has_obi && <span className="text-brand">OBI</span>}
                    {listing.label_type && <span>{listing.label_type}</span>}
                    {listing.condition && <span>{listing.condition}</span>}
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-bold text-slate-900 dark:text-white">
                        {listing.listing_type === 'auction' && listing.auction_info?.current_bid
                          ? `${listing.currency} $${listing.auction_info.current_bid.toFixed(2)}`
                          : `${listing.currency} $${listing.price.toFixed(2)}`}
                      </span>
                      {listing.popularity_score !== undefined && listing.popularity_score > 0 && (
                        <span className="text-xs text-slate-500">
                          🔥 {listing.popularity_score}
                        </span>
                      )}
                    </div>
                    {listing.listing_type === 'auction' && listing.auction_info && (
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {listing.auction_info.status === 'ended' ? (
                          <span className="text-rose-600">Auction Ended</span>
                        ) : listing.auction_info.status === 'ending_soon' ? (
                          <span className="text-orange-600">
                            Ending in {Math.round(listing.auction_info.hours_remaining || 0)}h
                          </span>
                        ) : listing.auction_info.status === 'ending_today' ? (
                          <span className="text-yellow-600">
                            Ends today ({Math.round(listing.auction_info.hours_remaining || 0)}h left)
                          </span>
                        ) : (
                          <span>
                            {listing.auction_info.bid_count} bid{listing.auction_info.bid_count !== 1 ? 's' : ''} • 
                            Ends {new Date(listing.auction_info.end_time).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    )}
                    {listing.seller_rating !== undefined && listing.seller_rating > 0 && (
                      <div className="text-xs text-slate-500">
                        ⭐ {listing.seller_rating.toFixed(1)} ({listing.seller_rating_count || 0} reviews)
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

