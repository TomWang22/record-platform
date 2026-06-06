'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import {
  ListingRevisionPanel,
  ListingSellerCard,
  ListingShippingCard,
} from '@/components/listings/listing-detail-panels'
import { WatchlistHeart } from '@/components/listings/watchlist-heart'
import { ApiErrorAlert } from '@/components/ui/api-error-alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { apiFetch } from '@/lib/api-client'
import { listingStatusLabel, saleTypeLabel } from '@/lib/listing-format'
import { fetchListing } from '@/lib/listings-api'
import { listingToStoredRef, type MarketplaceListing } from '@/lib/listings-types'
import { addRecentlyViewedOnApi } from '@/lib/marketplace-shopping-api'
import { getClientSessionToken } from '@/lib/session'
import { useRequireAuth } from '@/lib/use-require-auth'
import { isSessionAuthenticated, useSession } from '@/lib/use-session'

export default function ListingDetailPage() {
  const params = useParams()
  const id = params.id as string
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

      <div className="grid gap-6 lg:grid-cols-2">
        <Card data-testid="listing-media-gallery">
          <div className="grid grid-cols-2 gap-2 p-2">
            {images.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`${src}-${i}`}
                src={src}
                alt=""
                data-testid={i === 0 ? 'listing-primary-image' : undefined}
                className="aspect-square rounded-lg object-cover"
              />
            ))}
            {images.length === 0 && (
              <div className="col-span-2 flex aspect-video items-center justify-center bg-slate-100 text-slate-500 dark:bg-slate-800">
                No media
              </div>
            )}
          </div>
        </Card>

        <div className="space-y-4">
          <ListingShippingCard listing={listing} />
          <ListingSellerCard listing={listing} listingId={id} />
        </div>
      </div>

      {listing.description && (
        <Card className="p-4">
          <p className="text-sm font-medium">Description</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
            {listing.description}
          </p>
        </Card>
      )}

      <ListingRevisionPanel listingId={id} />

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
