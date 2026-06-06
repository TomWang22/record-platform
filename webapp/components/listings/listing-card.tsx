'use client'

import Link from 'next/link'

import { formatListingPrice, listingStatusLabel, saleTypeLabel } from '@/lib/listing-format'
import { listingToStoredRef, type MarketplaceListing } from '@/lib/listings-types'

import { WatchlistHeart } from './watchlist-heart'

type Props = {
  listing: MarketplaceListing
  compact?: boolean
}

export function ListingCard({ listing, compact }: Props) {
  const sold =
    listing.status === 'sold' ||
    listing.status === 'closed' ||
    listing.listing_status === 'sold'
  const obo = listing.pricing_mode === 'obo' || listing.listing_type === 'obo'

  return (
    <article
      data-testid="listing-card"
      className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm transition hover:shadow-md dark:border-white/10 dark:bg-slate-950"
    >
      <div className="absolute right-2 top-2 z-10">
        <WatchlistHeart listing={listingToStoredRef(listing)} />
      </div>
      <Link href={`/listings/${listing.id}`} className="block">
        <div className={compact ? 'aspect-[4/3]' : 'aspect-square'}>
          {listing.primaryImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={listing.primaryImageUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-brand/20 to-slate-200 text-sm font-semibold text-slate-600 dark:from-brand/30 dark:to-slate-800 dark:text-slate-300">
              {(listing.artist ?? listing.title)?.slice(0, 1)?.toUpperCase() ?? '♪'}
            </div>
          )}
        </div>
        <div className="space-y-1 p-3">
          {listing.artist && (
            <p className="truncate text-xs text-slate-500">{listing.artist}</p>
          )}
          <h3 className="line-clamp-2 font-semibold text-slate-900 dark:text-white">
            {listing.release ?? listing.title}
          </h3>
          <p className="text-xs text-slate-500">
            {[listing.format, listing.grade].filter(Boolean).join(' · ') || 'Vinyl'}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-lg font-bold">{formatListingPrice(listing)}</span>
            {obo && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                OBO
              </span>
            )}
            {sold && (
              <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase dark:bg-slate-700">
                Sold
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">
            {listing.seller ?? 'Seller'}
            {listing.seller_feedback_score != null
              ? ` · ${listing.seller_feedback_score}%`
              : ''}
          </p>
          <p className="text-[10px] uppercase text-slate-400">
            {saleTypeLabel(listing.pricing_mode ?? listing.listing_type)} ·{' '}
            {listingStatusLabel(listing.status)}
          </p>
        </div>
      </Link>
    </article>
  )
}
