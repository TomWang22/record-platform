'use client'

import Link from 'next/link'

import {
  auctionEnded,
  browseConditionLine,
  browsePriceDisplay,
  browseSaleRibbon,
  browseShippingLine,
  listingIsSold,
  resolveBrowseSaleMode,
} from '@/lib/listing-browse-display'
import { listingToStoredRef, type MarketplaceListing } from '@/lib/listings-types'

import { Button } from '../ui/button'
import { ListingCardMedia } from './listing-card-media'
import { WatchlistHeart } from './watchlist-heart'

type Props = {
  listing: MarketplaceListing
  compact?: boolean
}

const RIBBON_CLASS: Record<string, string> = {
  auction: 'bg-rose-600 text-white',
  obo: 'bg-amber-500 text-white',
  fixed: 'bg-brand text-white',
  ended: 'bg-slate-700 text-white',
}

export function ListingCard({ listing, compact }: Props) {
  const mode = resolveBrowseSaleMode(listing)
  const sold = listingIsSold(listing)
  const ended = mode === 'auction' && auctionEnded(listing)
  const price = browsePriceDisplay(listing)
  const ribbon = browseSaleRibbon(listing)
  const detailHref = `/listings/${listing.id}`

  return (
    <article
      data-testid="listing-card"
      data-sale-mode={mode}
      className="group relative flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition hover:shadow-md dark:border-white/10 dark:bg-slate-950"
    >
      <div className="relative">
        <ListingCardMedia
          listing={listing}
          compact={compact}
          ended={ended}
          href={detailHref}
        />
        {ribbon && (
          <span
            data-testid="listing-card-sale-ribbon"
            className={`absolute left-0 top-0 z-10 px-2 py-0.5 text-[10px] font-bold tracking-wide ${RIBBON_CLASS[ribbon.tone]}`}
          >
            {ribbon.text}
          </span>
        )}
        <div className="absolute right-1 top-1 z-20 scale-90">
          <WatchlistHeart listing={listingToStoredRef(listing)} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-2.5">
        <Link href={detailHref} className="min-w-0 flex-1">
          <h3
            data-testid="listing-card-title"
            className="line-clamp-2 text-[13px] font-medium leading-snug text-slate-900 dark:text-white"
          >
            {listing.release ?? listing.title}
          </h3>
          {!compact && listing.artist && (
            <p className="mt-0.5 truncate text-[11px] text-slate-500">{listing.artist}</p>
          )}
          <p className="mt-1 text-[11px] text-slate-500" data-testid="listing-card-condition">
            {browseConditionLine(listing)}
          </p>
          <div className="mt-1.5" data-testid="listing-card-price">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
              {price.label}
            </p>
            <p
              className={`text-lg font-bold leading-tight ${
                price.accent === 'ended'
                  ? 'text-slate-500'
                  : price.accent === 'urgent'
                    ? 'text-rose-700 dark:text-rose-400'
                    : 'text-slate-900 dark:text-white'
              }`}
            >
              {price.amount}
            </p>
            {price.meta && (
              <p
                className={`text-[11px] ${
                  price.accent === 'ended' || price.accent === 'urgent'
                    ? 'font-medium text-rose-600 dark:text-rose-400'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
                data-testid="listing-card-price-meta"
              >
                {price.meta}
              </p>
            )}
          </div>
          {!compact && (
            <p className="mt-1 text-[11px] text-slate-500" data-testid="listing-card-shipping">
              {browseShippingLine(listing)}
            </p>
          )}
          <p className="mt-0.5 truncate text-[11px] text-slate-500" data-testid="listing-card-seller">
            {listing.seller ?? 'Seller'}
            {listing.seller_feedback_score != null
              ? ` (${listing.seller_feedback_score}% positive)`
              : ''}
          </p>
        </Link>

        {!compact && !sold && !ended && (
          <div className="mt-auto flex gap-1.5 pt-1">
            {mode === 'obo' && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 flex-1 rounded-full text-xs"
                asChild
                data-testid="listing-card-make-offer"
              >
                <Link href={`/listings/${listing.id}?makeOffer=1`}>Make offer</Link>
              </Button>
            )}
            {mode === 'auction' && (
              <Button
                size="sm"
                className="h-7 flex-1 rounded-full text-xs"
                asChild
                data-testid="listing-card-place-bid"
              >
                <Link href={`/listings/${listing.id}?placeBid=1`}>Place bid</Link>
              </Button>
            )}
            {mode === 'fixed' && (
              <Button
                size="sm"
                className="h-7 flex-1 rounded-full text-xs"
                asChild
                data-testid="listing-card-buy-now"
              >
                <Link href={detailHref}>Buy it now</Link>
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 shrink-0 rounded-full px-2 text-xs"
              asChild
              data-testid="listing-card-view"
            >
              <Link href={detailHref}>View</Link>
            </Button>
          </div>
        )}
      </div>
    </article>
  )
}
