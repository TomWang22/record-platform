'use client'

import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { AuctionIntelligencePanel } from '@/components/ai/intelligence/auction-intelligence-panel'
import { ScarcityIntelligencePanel } from '@/components/ai/intelligence/scarcity-intelligence-panel'
import { ListingAuctionPanel } from '@/components/listings/listing-auction-panel'
import { ListingMakeOfferPanel } from '@/components/listings/listing-make-offer-panel'
import { ValuationIntelligencePanel } from '@/components/ai/intelligence/valuation-intelligence-panel'
import {
  ListingRevisionPanel,
  ListingSellerCard,
  ListingShippingCard,
} from '@/components/listings/listing-detail-panels'
import { ListingImageGallery } from '@/components/listings/listing-image-gallery'
import { WatchlistHeart } from '@/components/listings/watchlist-heart'
import { ApiErrorAlert } from '@/components/ui/api-error-alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { apiFetch } from '@/lib/api-client'
import { listingStatusLabel, saleTypeLabel } from '@/lib/listing-format'
import { fetchListing } from '@/lib/listings-api'
import { listingIsAuction } from '@/lib/auctions-api'
import { listingAcceptsOffers } from '@/lib/offers-api'
import { listingToStoredRef, type MarketplaceListing } from '@/lib/listings-types'
import type { CollectionRecord } from '@/lib/records-types'
import { addRecentlyViewedOnApi } from '@/lib/marketplace-shopping-api'
import { getClientSessionToken } from '@/lib/session'
import { useRequireAuth } from '@/lib/use-require-auth'
import { isSessionAuthenticated, useSession } from '@/lib/use-session'

export default function ListingDetailPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const id = params.id as string
  const makeOfferOpen = searchParams.get('makeOffer') === '1'
  const session = useSession()
  const { authRequired, onApiError } = useRequireAuth()
  const signedIn = isSessionAuthenticated(session)
  const hasToken = Boolean(getClientSessionToken())

  const [listing, setListing] = useState<MarketplaceListing | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    if (!id) return
    if (session.status === 'loading' && !hasToken) return
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, session.status, signedIn, hasToken])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const item = await fetchListing(id, true)
      setListing(item)
      if (signedIn) {
        void addRecentlyViewedOnApi(listingToStoredRef(item)).catch(() => {})
      }
      if (signedIn) {
        try {
          const mine = await apiFetch<{ items?: { id: string }[]; listings?: { id: string }[] }>(
            '/api/listings/mine',
            { auth: true },
          )
          const rows = mine.items ?? mine.listings ?? []
          setCanEdit(rows.some((x) => x.id === id))
        } catch {
          setCanEdit(false)
        }
      }
    } catch (err) {
      if (onApiError(err)) return
      setError(err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading listing…</p>
  }

  if (error || !listing) {
    return (
      <ApiErrorAlert
        title="Listing not found"
        error={error ?? new Error('not found')}
        onRetry={() => void load()}
      />
    )
  }

  const images = (
    listing.images?.length
      ? listing.images
      : listing.media_items?.length
        ? listing.media_items.map((m) => m.url_or_path).filter(Boolean)
        : [listing.primaryImageUrl]
  ).filter(Boolean) as string[]

  const valuationSubject: CollectionRecord = {
    id: String((listing as MarketplaceListing & { source_record_id?: string }).source_record_id || listing.id),
    artist: listing.artist || 'Unknown',
    name: listing.title || 'Untitled',
    format: listing.format || 'LP',
    catalogNumber: listing.catalogNumber ?? listing.catalog_number ?? null,
    label: listing.label ?? null,
    recordGrade: listing.mediaCondition ?? listing.grade ?? null,
  }

  return (
    <div className="space-y-6" data-testid="listing-detail-ready">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {listing.artist ? (
            <p className="text-sm text-slate-500">{listing.artist}</p>
          ) : listing.seller ? (
            <p className="text-sm text-slate-500">{listing.seller}</p>
          ) : null}
          <h1 className="text-2xl font-semibold">{listing.title}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge>{saleTypeLabel(listing.listing_type ?? listing.pricing_mode)}</Badge>
            <Badge variant="outline">{listingStatusLabel(listing.status)}</Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <WatchlistHeart listing={listingToStoredRef(listing)} />
          {canEdit && (
            <>
              <Button variant="secondary" asChild>
                <Link href={`/listings/${id}/edit`}>Edit</Link>
              </Button>
              <Button variant="ghost" asChild>
                <Link href={`/listings/${id}/revisions`}>Revisions</Link>
              </Button>
            </>
          )}
        </div>
      </div>

      <div
        className="grid gap-6 lg:grid-cols-[minmax(420px,1.15fr)_minmax(300px,400px)] lg:items-start"
        data-testid="listing-detail-product-area"
      >
        <ListingImageGallery images={images} />
        <div className="space-y-4">
          <ListingShippingCard listing={listing} />
          {signedIn && listingIsAuction(listing) && (
            <>
              <ListingAuctionPanel listingId={id} canClose={canEdit} />
              <AuctionIntelligencePanel listingId={id} />
            </>
          )}
          {signedIn && !canEdit && listingAcceptsOffers(listing) && (
            <ListingMakeOfferPanel
              listingId={id}
              listingTitle={listing.title}
              autoOpen={makeOfferOpen}
            />
          )}
          <ListingSellerCard listing={listing} listingId={id} />
        </div>
      </div>

      <div className="space-y-4">
        <Card className="p-4" data-testid="listing-description-card">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Description</p>
          <p
            className="mt-2 min-h-[3rem] whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-300"
            data-testid="listing-description-text"
          >
            {listing.description?.trim() || 'No description provided for this listing.'}
          </p>
        </Card>
        {signedIn ? <ValuationIntelligencePanel record={valuationSubject} advisoryOnly /> : null}
        {signedIn ? <ScarcityIntelligencePanel record={valuationSubject} /> : null}
        <ListingRevisionPanel listingId={id} />
      </div>

      {!authRequired && (
        <p className="text-xs text-slate-400">
          Viewing this page adds the listing to{' '}
          <Link href="/recently-viewed" className="text-brand hover:underline">
            recently viewed
          </Link>{' '}
          (shopping API).
        </p>
      )}
    </div>
  )
}
