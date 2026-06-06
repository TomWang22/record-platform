'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  formatDate,
  formatListingPrice,
  formatListingTimestamp,
  formatMoneyFromCents,
  listingStatusLabel,
  saleTypeLabel,
} from '@/lib/listing-format'
import { formatRevisionDate } from '@/lib/listing-revision-format'
import { fetchListingRevisions } from '@/lib/listings-api'
import {
  humanReadableRevisionLines,
  isBadRevisionLine,
} from '@/lib/listing-revision-format'
import type { MarketplaceListing } from '@/lib/listings-types'

function shipsFromLabel(listing: MarketplaceListing): string {
  const s = listing.shipping
  if (s?.shipsFrom?.trim()) return s.shipsFrom.trim()
  const parts = [
    s?.shipsFromCity ?? listing.seller_city,
    s?.shipsFromRegion ?? listing.seller_region,
    s?.shipsFromCountry ?? listing.seller_country ?? listing.country,
  ].filter(Boolean)
  if (parts.length) return parts.join(', ')
  return listing.location ?? listing.country ?? '—'
}

type Props = {
  listing: MarketplaceListing
  listingId: string
}

function formatShippingMoney(
  s: MarketplaceListing['shipping'],
  which: 'domestic' | 'international',
): string {
  if (!s) return '—'
  const display =
    which === 'domestic' ? s.domesticDisplay : s.internationalDisplay
  if (display?.trim()) return display.trim()
  const cents =
    which === 'domestic' ? s.domesticCostCents : s.internationalCostCents
  if (cents != null) return formatMoneyFromCents(cents)
  const flag =
    which === 'domestic' ? s.domesticShipping : s.internationalShipping
  return flag ? (which === 'domestic' ? 'Calculated at checkout' : 'Available') : '—'
}

export function ListingShippingCard({ listing }: { listing: MarketplaceListing }) {
  const s = listing.shipping
  const sale = saleTypeLabel(
    listing.listing_type ?? listing.pricing_mode ?? listing.saleType,
  )
  return (
    <div data-testid="listing-shipping-card">
    <Card className="space-y-3 p-4" data-testid="listing-price-sale-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Price &amp; sale</p>
        <Badge>{sale}</Badge>
      </div>
      <p className="text-3xl font-bold tracking-tight" data-testid="listing-price-card">
        {formatListingPrice(listing)}
      </p>
      {listing.listing_type === 'auction' && listing.auction && (
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-slate-500">Starting bid</dt>
          <dd>{formatMoneyFromCents(listing.auction.startingBidCents)}</dd>
          {listing.auction.reserveCents != null && (
            <>
              <dt className="text-slate-500">Reserve</dt>
              <dd>{formatMoneyFromCents(listing.auction.reserveCents)}</dd>
            </>
          )}
          {listing.auction.endsAt && (
            <>
              <dt className="text-slate-500">Ends</dt>
              <dd>{formatDate(listing.auction.endsAt)}</dd>
            </>
          )}
        </dl>
      )}
      {listing.listing_type === 'obo' && listing.obo && (
        <ul className="list-inside list-disc text-sm text-slate-600 dark:text-slate-300">
          {listing.obo.maxOfferAttempts != null && (
            <li>Max offer attempts: {listing.obo.maxOfferAttempts}</li>
          )}
          {listing.obo.offerExpirationHours != null && (
            <li>Offer expires in {listing.obo.offerExpirationHours}h</li>
          )}
          {listing.obo.autoAcceptCents != null && (
            <li>Auto-accept at {formatMoneyFromCents(listing.obo.autoAcceptCents)}</li>
          )}
          {listing.obo.autoDeclineCents != null && (
            <li>Auto-decline below {formatMoneyFromCents(listing.obo.autoDeclineCents)}</li>
          )}
        </ul>
      )}
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Shipping</p>
      <dl className="grid grid-cols-[minmax(6.5rem,auto)_1fr] gap-x-3 gap-y-2 text-sm">
        <dt className="text-slate-500">Domestic</dt>
        <dd>{formatShippingMoney(s, 'domestic')}</dd>
        <dt className="text-slate-500">International</dt>
        <dd>{formatShippingMoney(s, 'international')}</dd>
        <dt className="text-slate-500">Service</dt>
        <dd>{s?.service ?? '—'}</dd>
        <dt className="text-slate-500">Package</dt>
        <dd>{s?.packageType ?? '—'}</dd>
        <dt className="text-slate-500">Ships from</dt>
        <dd>{shipsFromLabel(listing)}</dd>
        <dt className="text-slate-500">Local pickup</dt>
        <dd>{s?.localPickup ? 'Yes' : 'No'}</dd>
        <dt className="text-slate-500">Combined shipping</dt>
        <dd>{s?.combinedShipping ? 'Yes' : 'No'}</dd>
      </dl>
      {s?.notes && (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          <span className="font-medium">Notes:</span> {s.notes}
        </p>
      )}
      <dl className="grid grid-cols-[minmax(6.5rem,auto)_1fr] gap-x-3 gap-y-2 border-t border-slate-100 pt-3 text-sm dark:border-white/10">
        <dt className="text-slate-500">Format</dt>
        <dd>{listing.format ?? '—'}</dd>
        <dt className="text-slate-500">Grade</dt>
        <dd>{listing.grade ?? listing.mediaCondition ?? '—'}</dd>
        <dt className="text-slate-500">Status</dt>
        <dd>{listingStatusLabel(listing.status)}</dd>
        <dt className="text-slate-500">Listed</dt>
        <dd
          className="whitespace-nowrap text-slate-800 dark:text-slate-100"
          data-testid="listing-shipping-row-listed"
        >
          <span data-testid="listing-listed-at">
            {formatListingTimestamp(
              listing.listedAtDisplay,
              listing.listed_at ?? listing.created_at,
              listing.timezone,
            )}
          </span>
        </dd>
        {listing.updatedAtDisplay || listing.updated_at ? (
          <>
            <dt className="text-slate-500">Updated</dt>
            <dd
              className="whitespace-nowrap text-slate-800 dark:text-slate-100"
              data-testid="listing-shipping-row-updated"
            >
              <span data-testid="listing-updated-at">
                {formatListingTimestamp(
                  listing.updatedAtDisplay,
                  listing.updated_at,
                  listing.timezone,
                )}
              </span>
            </dd>
          </>
        ) : null}
      </dl>
    </Card>
    </div>
  )
}

export function ListingSellerCard({ listing, listingId }: Props) {
  const sellerSlug = (listing.seller ?? 'seller')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
  const sellerId = listing.seller_id ?? listing.user_id
  const contactHref = sellerId
    ? `/messages?user=${encodeURIComponent(sellerId)}&listing=${encodeURIComponent(listingId)}`
    : `/messages?listing=${encodeURIComponent(listingId)}`

  return (
    <div data-testid="listing-seller-card">
    <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Seller</p>
        <Link
          href={`/users/${sellerSlug || 'seller'}`}
          className="text-lg font-semibold text-brand hover:underline"
        >
          {listing.seller ?? 'Seller'}
        </Link>
        <p className="text-sm text-slate-500">
          Feedback:{' '}
          {listing.seller_feedback_score != null ? `${listing.seller_feedback_score}%` : '—'}
        </p>
      </div>
      <Button asChild data-testid="contact-seller-button">
        <Link href={contactHref}>Contact seller</Link>
      </Button>
    </Card>
    </div>
  )
}

export function ListingRevisionPanel({ listingId }: { listingId: string }) {
  const [open, setOpen] = useState(false)
  const [lines, setLines] = useState<string[]>([])
  const [previewWhen, setPreviewWhen] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)

  async function loadRevisions() {
    setLoading(true)
    try {
      const revs = await fetchListingRevisions(listingId)
      const sorted = [...revs].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
      const latest = sorted[0]
      if (latest) {
        const latestLines = humanReadableRevisionLines(latest).filter((l) => !isBadRevisionLine(l))
        setPreviewWhen(formatRevisionDate(latest.created_at))
        setLines(latestLines.slice(0, 6))
      } else {
        setPreviewWhen(null)
        setLines([])
      }
      setLoaded(true)
    } catch {
      setPreviewWhen(null)
      setLines([])
      setLoaded(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadRevisions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId])

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && !loaded) await loadRevisions()
  }

  return (
    <div data-testid="listing-revision-panel">
    <Card className="space-y-3 p-4">
      {loaded && (
        <div
          data-testid="listing-revision-preview"
          className="min-h-[4.5rem] rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-3 text-sm dark:border-white/10 dark:bg-slate-900/50"
        >
          {lines.length > 0 && previewWhen ? (
            <>
              <p className="text-xs font-medium text-slate-500" data-testid="listing-revision-preview-when">
                Latest change · {previewWhen}
              </p>
              <ul className="mt-2 space-y-1 text-slate-700 dark:text-slate-200">
                {lines.slice(0, 3).map((line, i) => (
                  <li key={`preview-${i}`}>{line}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-slate-500" data-testid="listing-revision-preview-empty">
              No revisions yet. Edits to price, shipping, or title will appear here.
            </p>
          )}
        </div>
      )}
      {!loaded && loading && (
        <div
          className="h-16 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800"
          data-testid="listing-revision-loading"
          aria-hidden
        />
      )}
      <button
        type="button"
        className="flex w-full items-center justify-between text-left text-sm font-medium"
        onClick={() => void toggle()}
        aria-expanded={open}
      >
        Revision history
        <span className="text-slate-500">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="mt-3">
          {loading && <p className="text-sm text-slate-500">Loading revisions…</p>}
          {!loading && lines.length === 0 && (
            <p className="text-sm text-slate-500">No revisions yet.</p>
          )}
          {!loading && loaded && lines.length > 0 && (
            <ul
              data-testid="listing-revision-panel-loaded"
              className="space-y-2 text-sm text-slate-700 dark:text-slate-200"
            >
              {lines.slice(0, 3).map((line, i) => (
                <li key={`${i}-${line.slice(0, 24)}`} className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-900/60">
                  {line.split('\n').map((part, j) => (
                    <span key={j} className="block">
                      {part}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          )}
          <Button variant="ghost" size="sm" className="mt-2" asChild>
            <Link href={`/listings/${listingId}/revisions`}>View all revisions</Link>
          </Button>
        </div>
      )}
    </Card>
    </div>
  )
}
