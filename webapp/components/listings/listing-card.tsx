'use client'

import Link from 'next/link'

import { formatListingPrice, listingStatusLabel, saleTypeLabel } from '@/lib/listing-format'
import { listingToStoredRef, type MarketplaceListing } from '@/lib/listings-types'

import { WatchlistHeart } from './watchlist-heart'

type Props = {
  listing: MarketplaceListing
  compact?: boolean
}

function conditionLine(listing: MarketplaceListing): string {
  return [listing.format, listing.grade ?? listing.mediaCondition].filter(Boolean).join(' · ') || 'Vinyl'
}

export function ListingCard({ listing, compact }: Props) {
  const sold =
    listing.status === 'sold' ||
    listing.status === 'closed' ||
    listing.listing_status === 'sold'
  const obo = listing.pricing_mode === 'obo' || listing.listing_type === 'obo'
  const sale = saleTypeLabel(listing.pricing_mode ?? listing.listing_type)
  const freeShip =
    listing.shipping?.domesticShipping || listing.shipping?.domesticCostCents === 0

  const imageHeight = compact ? 'max-h-[100px]' : 'max-h-[148px]'

  return (
    <article
      data-testid="listing-card"
      className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm transition hover:border-brand/30 hover:shadow-md dark:border-white/10 dark:bg-slate-950"
    >
      <div className="absolute right-1.5 top-1.5 z-10 scale-90">
        <WatchlistHeart listing={listingToStoredRef(listing)} />
      </div>
      <Link href={`/listings/${listing.id}`} className="flex min-h-0 flex-1 flex-col">
        <div className={`${imageHeight} w-full overflow-hidden bg-slate-100 dark:bg-slate-800`}>
          {listing.primaryImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={listing.primaryImageUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand/20 to-slate-200 text-lg font-semibold text-slate-600 dark:from-brand/30 dark:to-slate-800">
              {(listing.artist ?? listing.title)?.slice(0, 1)?.toUpperCase() ?? '♪'}
            </div>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1 p-2.5">
          {listing.artist && (
            <p className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500">
              {listing.artist}
            </p>
          )}
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900 dark:text-white">
            {listing.release ?? listing.title}
          </h3>
          <p className="truncate text-[11px] text-slate-500">{conditionLine(listing)}</p>
          <div className="mt-auto flex flex-wrap items-center gap-1 pt-1">
            <span className="text-base font-bold text-slate-900 dark:text-white">
              {formatListingPrice(listing)}
            </span>
            <span className="rounded bg-indigo-100 px-1 py-0.5 text-[9px] font-semibold uppercase text-indigo-900 dark:bg-indigo-900/40 dark:text-indigo-100">
              {sale}
            </span>
            {obo && (
              <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold uppercase text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                OBO
              </span>
            )}
            {freeShip && (
              <span className="rounded bg-emerald-100 px-1 py-0.5 text-[9px] font-semibold uppercase text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100">
                Free ship
              </span>
            )}
            {sold && (
              <span className="rounded bg-slate-200 px-1 py-0.5 text-[9px] font-semibold uppercase dark:bg-slate-700">
                Sold
              </span>
            )}
          </div>
          <p className="truncate text-[11px] text-slate-500">
            {listing.seller ?? 'Seller'}
            {listing.seller_feedback_score != null ? ` · ${listing.seller_feedback_score}%` : ''}
            {' · '}
            {listingStatusLabel(listing.status)}
          </p>
        </div>
      </Link>
    </article>
  )
}
