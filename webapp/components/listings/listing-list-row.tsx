'use client'

import Link from 'next/link'

import {
  browseCardImageUrls,
  browseConditionLine,
  browsePriceDisplay,
  browseSaleRibbon,
  browseShippingLine,
  listingIsSold,
  resolveBrowseSaleMode,
} from '@/lib/listing-browse-display'
import { listingToStoredRef, type MarketplaceListing } from '@/lib/listings-types'

import { Button } from '../ui/button'
import { WatchlistHeart } from './watchlist-heart'

type Props = {
  listing: MarketplaceListing
}

export function ListingListRow({ listing }: Props) {
  const mode = resolveBrowseSaleMode(listing)
  const sold = listingIsSold(listing)
  const price = browsePriceDisplay(listing)
  const ribbon = browseSaleRibbon(listing)
  const images = browseCardImageUrls(listing)
  const thumb = images[0]

  return (
    <div
      data-testid="listing-row"
      data-sale-mode={mode}
      className="flex items-center gap-4 rounded-lg border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-slate-950"
    >
      <Link
        href={`/listings/${listing.id}`}
        className="relative h-[140px] w-[140px] shrink-0 overflow-hidden rounded-md bg-slate-100 dark:bg-slate-800"
      >
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">♪</div>
        )}
        {ribbon && (
          <span className="absolute left-0 top-0 bg-slate-900/80 px-1 text-[8px] font-bold text-white">
            {ribbon.text}
          </span>
        )}
        {images.length > 1 && (
          <span className="absolute bottom-0 right-0 bg-slate-900/75 px-1 text-[8px] text-white">
            {images.length}
          </span>
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <Link
          href={`/listings/${listing.id}`}
          className="line-clamp-2 text-base font-medium text-slate-900 hover:text-brand dark:text-white"
        >
          {listing.release ?? listing.title}
        </Link>
        <p className="text-[11px] text-slate-500">{browseConditionLine(listing)}</p>
        <p className="text-[11px] text-slate-500">
          {listing.seller ?? 'Seller'}
          {listing.seller_feedback_score != null ? ` · ${listing.seller_feedback_score}%` : ''}
        </p>
        <p className="text-[11px] text-slate-500">{browseShippingLine(listing)}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[10px] uppercase text-slate-500">{price.label}</p>
        <p className="text-lg font-bold">{price.amount}</p>
        {price.meta && <p className="text-[11px] text-rose-600">{price.meta}</p>}
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        {!sold && mode === 'obo' && (
          <Button size="sm" variant="outline" className="h-7 text-xs" asChild data-testid="listing-card-make-offer">
            <Link href={`/listings/${listing.id}?makeOffer=1`}>Make offer</Link>
          </Button>
        )}
        {!sold && mode === 'auction' && (
          <Button size="sm" className="h-7 text-xs" asChild data-testid="listing-card-place-bid">
            <Link href={`/listings/${listing.id}?placeBid=1`}>Place bid</Link>
          </Button>
        )}
        {!sold && mode === 'fixed' && (
          <Button size="sm" className="h-7 text-xs" asChild data-testid="listing-card-buy-now">
            <Link href={`/listings/${listing.id}`}>Buy it now</Link>
          </Button>
        )}
        <WatchlistHeart listing={listingToStoredRef(listing)} />
      </div>
    </div>
  )
}
