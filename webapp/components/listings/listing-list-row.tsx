'use client'

import Link from 'next/link'

import { formatListingPrice, listingStatusLabel } from '@/lib/listing-format'
import { listingToStoredRef, type MarketplaceListing } from '@/lib/listings-types'

import { WatchlistHeart } from './watchlist-heart'

type Props = {
  listing: MarketplaceListing
}

export function ListingListRow({ listing }: Props) {
  return (
    <div
      data-testid="listing-row"
      className="flex items-center gap-4 rounded-xl border border-slate-200/80 bg-white p-3 dark:border-white/10 dark:bg-slate-950"
    >
      <Link href={`/listings/${listing.id}`} className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
        {listing.primaryImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={listing.primaryImageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-500">No img</div>
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/listings/${listing.id}`} className="font-semibold hover:text-brand">
          {listing.release ?? listing.title}
        </Link>
        <p className="text-xs text-slate-500">
          {listing.format ?? 'Format n/a'} · Grade {listing.grade ?? 'N/A'}
        </p>
        <p className="text-xs text-slate-500">
          {listing.seller ?? 'Seller'} · {listingStatusLabel(listing.status)}
        </p>
      </div>
      <div className="text-right">
        <p className="font-bold">{formatListingPrice(listing)}</p>
        <p className="text-xs text-slate-500">{listing.shipping_summary ?? 'See listing'}</p>
      </div>
      <WatchlistHeart listing={listingToStoredRef(listing)} />
    </div>
  )
}
