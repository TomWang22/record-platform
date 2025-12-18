'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
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
type DisplayStyle = 'grid' | 'list' | 'compact'

const MEDIA_TYPES: MediaType[] = ['LP', '12"', '10"', '7"', 'CD', 'EP', 'CASSETTE', 'OTHER']
const ITEMS_PER_PAGE_OPTIONS = [25, 50, 100, 200]

// Type guard to validate MediaType
function isValidMediaType(value: string | null): value is MediaType {
  return value !== null && MEDIA_TYPES.includes(value as MediaType)
}

// Type guard to validate SortOption
function isValidSortOption(value: string | null): value is SortOption {
  return value !== null && (value === 'created_at' || value === 'price' || value === 'popularity' || value === 'label_type')
}

// Type guard to validate SortOrder
function isValidSortOrder(value: string | null): value is SortOrder {
  return value !== null && (value === 'asc' || value === 'desc')
}

function ListingsPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  
  const [listings, setListings] = useState<Listing[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [currentPage, setCurrentPage] = useState(parseInt(searchParams.get('page') || '1', 10))
  
  // User preferences
  const [itemsPerPage, setItemsPerPage] = useState<number>(50)
  const [displayStyle, setDisplayStyle] = useState<DisplayStyle>('grid')
  const [preferencesLoaded, setPreferencesLoaded] = useState(false)
  
  // Filters
  const [query, setQuery] = useState(searchParams.get('q') || '')
  const [mediaType, setMediaType] = useState<MediaType | ''>(() => {
    const value = searchParams.get('media_type')
    return isValidMediaType(value) ? value : ''
  })
  const [hasObi, setHasObi] = useState<boolean | null>(
    searchParams.get('has_obi') === 'true' ? true : searchParams.get('has_obi') === 'false' ? false : null
  )
  const [minPrice, setMinPrice] = useState(searchParams.get('min_price') || '')
  const [maxPrice, setMaxPrice] = useState(searchParams.get('max_price') || '')
  const [labelType, setLabelType] = useState(searchParams.get('label_type') || '')
  const [sortBy, setSortBy] = useState<SortOption>(() => {
    const value = searchParams.get('sort_by')
    return isValidSortOption(value) ? value : 'created_at'
  })
  const [sortOrder, setSortOrder] = useState<SortOrder>(() => {
    const value = searchParams.get('sort_order')
    return isValidSortOrder(value) ? value : 'desc'
  })

  // Load user preferences
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const prefs = await apiFetch<{ items_per_page?: number; display_style?: DisplayStyle }>(
          '/listings/settings'
        )
        if (prefs.items_per_page) setItemsPerPage(prefs.items_per_page)
        if (prefs.display_style) setDisplayStyle(prefs.display_style)
        setPreferencesLoaded(true)
      } catch (err) {
        // If not authenticated or settings not found, use defaults
        setPreferencesLoaded(true)
      }
    }
    void loadPreferences()
  }, [])

  // Save display preference when changed
  const handleDisplayStyleChange = async (style: DisplayStyle) => {
    setDisplayStyle(style)
    try {
      await apiFetch('/listings/settings', {
        method: 'PUT',
        body: JSON.stringify({ display_style: style })
      })
    } catch (err) {
      // Silently fail - preference will be saved in URL
    }
  }

  // Save items per page preference when changed
  const handleItemsPerPageChange = async (items: number) => {
    setItemsPerPage(items)
    setCurrentPage(1) // Reset to first page when changing items per page
    try {
      await apiFetch('/listings/settings', {
        method: 'PUT',
        body: JSON.stringify({ items_per_page: items })
      })
    } catch (err) {
      // Silently fail - preference will be saved in URL
    }
  }

  const searchListings = useCallback(async () => {
    if (!preferencesLoaded) return // Wait for preferences to load
    
    setLoading(true)
    setError('')
    
    try {
      const offset = (currentPage - 1) * itemsPerPage
      const params = new URLSearchParams()
      if (query) params.set('q', query)
      if (mediaType) params.set('media_type', mediaType)
      if (hasObi !== null) params.set('has_obi', String(hasObi))
      if (minPrice) params.set('min_price', minPrice)
      if (maxPrice) params.set('max_price', maxPrice)
      if (labelType) params.set('label_type', labelType)
      params.set('sort_by', sortBy)
      params.set('sort_order', sortOrder)
      params.set('limit', String(itemsPerPage))
      params.set('offset', String(offset))
      if (currentPage > 1) params.set('page', String(currentPage))

      const data = await apiFetch<{ listings: Listing[]; total: number; limit: number; offset: number; hasMore: boolean }>(
        `/listings/search?${params.toString()}`
      )
      
      setListings(data.listings || [])
      setTotal(data.total || 0)
      
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
  }, [query, mediaType, hasObi, minPrice, maxPrice, labelType, sortBy, sortOrder, router, currentPage, itemsPerPage, preferencesLoaded])

  useEffect(() => {
    void searchListings()
  }, [searchListings])

  const totalPages = Math.ceil(total / itemsPerPage)
  const startItem = total > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0
  const endItem = Math.min(currentPage * itemsPerPage, total)

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

          <div className="flex items-center justify-between flex-wrap gap-4">
            {/* Display Style */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-slate-600 dark:text-slate-300">
                View:
              </label>
              <div className="flex gap-1 rounded-lg border border-slate-200/80 dark:border-white/10 p-1">
                <button
                  onClick={() => handleDisplayStyleChange('grid')}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    displayStyle === 'grid'
                      ? 'bg-brand text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                  title="Grid view (like Amazon product grid)"
                >
                  Grid
                </button>
                <button
                  onClick={() => handleDisplayStyleChange('list')}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    displayStyle === 'list'
                      ? 'bg-brand text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                  title="List view (like Amazon detailed list)"
                >
                  List
                </button>
                <button
                  onClick={() => handleDisplayStyleChange('compact')}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    displayStyle === 'compact'
                      ? 'bg-brand text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                  title="Compact view (more items per row)"
                >
                  Compact
                </button>
              </div>
            </div>
            
            {/* Items per page */}
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-slate-600 dark:text-slate-300">
                Items per page:
              </label>
              <select
                value={itemsPerPage}
                onChange={(e) => handleItemsPerPageChange(parseInt(e.target.value, 10))}
                className="rounded-xl border border-slate-200/80 bg-white px-3 py-1 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
              >
                {ITEMS_PER_PAGE_OPTIONS.map((num) => (
                  <option key={num} value={num}>
                    {num}
                  </option>
                ))}
              </select>
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
        <>
          <div className={
            displayStyle === 'grid' 
              ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
              : displayStyle === 'list'
              ? 'space-y-3'
              : 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
          }>
            {listings.map((listing) => (
              <Link key={listing.id} href={`/listings/${listing.id}`}>
                <Card className={`hover:shadow-lg transition-all cursor-pointer border-slate-200 dark:border-slate-800 ${
                  displayStyle === 'list' 
                    ? 'flex gap-4 p-4' 
                    : displayStyle === 'compact' 
                    ? 'p-2' 
                    : 'h-full flex flex-col p-4'
                }`}>
                  {listing.primary_image && listing.primary_image.length > 0 && (
                    <div className={`${
                      displayStyle === 'list' 
                        ? 'w-32 h-32 flex-shrink-0'
                        : displayStyle === 'compact'
                        ? 'w-full aspect-square mb-2'
                        : 'aspect-square w-full mb-3'
                    } overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800 ${displayStyle === 'list' ? '' : 'flex-shrink-0'}`}>
                      <img
                        src={listing.primary_image[0].thumbnail_url || listing.primary_image[0].image_url}
                        alt={listing.title}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  )}
                  <div className={`${displayStyle === 'list' ? 'flex-1 min-w-0' : 'flex-1 flex flex-col'} space-y-2`}>
                    <h3 className={`font-semibold text-slate-900 dark:text-white leading-tight ${
                      displayStyle === 'compact' 
                        ? 'text-xs line-clamp-2' 
                        : displayStyle === 'list'
                        ? 'text-base line-clamp-2'
                        : 'text-sm line-clamp-2'
                    }`}>
                      {listing.title}
                    </h3>
                    {displayStyle !== 'compact' && (
                      <div className="flex flex-wrap gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                        {listing.media_type && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                            {listing.media_type}
                          </span>
                        )}
                        {listing.has_obi && (
                          <span className="px-1.5 py-0.5 rounded bg-brand/10 text-brand font-medium">
                            OBI
                          </span>
                        )}
                        {listing.condition && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                            {listing.condition}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={`font-bold text-slate-900 dark:text-white ${
                          displayStyle === 'compact' ? 'text-sm' : displayStyle === 'list' ? 'text-xl' : 'text-lg'
                        }`}>
                          {listing.listing_type === 'auction' && listing.auction_info?.current_bid
                            ? `${listing.currency} $${listing.auction_info.current_bid.toFixed(2)}`
                            : `${listing.currency} $${listing.price.toFixed(2)}`}
                        </span>
                        {listing.popularity_score !== undefined && listing.popularity_score > 0 && displayStyle !== 'compact' && (
                          <span className="text-xs text-slate-500 flex items-center gap-1">
                            <span>🔥</span>
                            <span>{listing.popularity_score}</span>
                          </span>
                        )}
                      </div>
                      {listing.listing_type === 'auction' && listing.auction_info && displayStyle !== 'compact' && (
                        <div className="text-xs text-slate-600 dark:text-slate-400">
                          {listing.auction_info.status === 'ended' ? (
                            <span className="text-rose-600 font-medium">Auction Ended</span>
                          ) : listing.auction_info.status === 'ending_soon' ? (
                            <span className="text-orange-600 font-medium">
                              Ending in {Math.round(listing.auction_info.hours_remaining || 0)}h
                            </span>
                          ) : listing.auction_info.status === 'ending_today' ? (
                            <span className="text-yellow-600 font-medium">
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
                      {listing.seller_rating !== undefined && listing.seller_rating > 0 && displayStyle !== 'compact' && (
                        <div className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1">
                          <span className="text-yellow-500">⭐</span>
                          <span className="font-medium">{listing.seller_rating.toFixed(1)}</span>
                          <span className="text-slate-400">({listing.seller_rating_count || 0})</span>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
          
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 pt-4 mt-6">
              <div className="text-sm text-slate-600 dark:text-slate-400">
                Showing {startItem} to {endItem} of {total} results
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1 || loading}
                >
                  Previous
                </Button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                    let pageNum: number
                    if (totalPages <= 7) {
                      pageNum = i + 1
                    } else if (currentPage <= 4) {
                      pageNum = i + 1
                    } else if (currentPage >= totalPages - 3) {
                      pageNum = totalPages - 6 + i
                    } else {
                      pageNum = currentPage - 3 + i
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setCurrentPage(pageNum)}
                        disabled={loading}
                        className={`px-3 py-1 text-sm rounded transition-colors ${
                          currentPage === pageNum
                            ? 'bg-brand text-white font-medium'
                            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        {pageNum}
                      </button>
                    )
                  })}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages || loading}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
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

