'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { ListingRevisionTimeline } from '@/components/listings/listing-revision-timeline'
import { AuthRequiredCard } from '@/components/auth/auth-required-card'
import { ApiErrorAlert } from '@/components/ui/api-error-alert'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api-client'
import { fetchListingRevisions } from '@/lib/listings-api'
import type { ListingRevision } from '@/lib/listings-types'
import { useRequireAuth } from '@/lib/use-require-auth'

type PublicRevision = {
  id: string
  created_at: string
  editor_display?: string
  lines?: string[]
}

export default function ListingRevisionsPage() {
  const params = useParams()
  const id = params.id as string
  const { authRequired, onApiError, isReady } = useRequireAuth()

  const [revisions, setRevisions] = useState<ListingRevision[]>([])
  const [publicItems, setPublicItems] = useState<PublicRevision[] | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [ownerView, setOwnerView] = useState(false)

  useEffect(() => {
    if (!id || !isReady) return
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, authRequired, isReady])

  async function loadPublic() {
    const pub = await apiFetch<{ items?: PublicRevision[] }>(
      `/api/listings/${id}/revisions/public`,
    )
    setPublicItems(pub.items ?? [])
    setRevisions([])
    setOwnerView(false)
  }

  async function load() {
    setLoading(true)
    setError(null)
    try {
      if (!authRequired) {
        try {
          const revs = await fetchListingRevisions(id)
          setRevisions(revs)
          setOwnerView(true)
          setPublicItems(undefined)
        } catch (err) {
          if (onApiError(err)) return
          await loadPublic()
        }
      } else {
        await loadPublic()
      }
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading revision history…</p>

  const hasRevisions = revisions.length > 0 || (publicItems?.length ?? 0) > 0

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="listing-revisions-ready">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Listing revisions</h1>
          <p className="text-sm text-slate-500">
            {ownerView ? 'Owner view with field-level diffs.' : 'Public revision summary.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" asChild>
            <Link href={`/listings/${id}`}>Listing</Link>
          </Button>
          {ownerView && (
            <Button asChild>
              <Link href={`/listings/${id}/edit`}>Edit</Link>
            </Button>
          )}
        </div>
      </div>

      {authRequired && (
        <AuthRequiredCard
          returnTo={`/listings/${id}/revisions`}
          title="Sign in for full revision diffs"
          description="Public summary is shown below. Owners see field-level history."
        />
      )}

      {error && (
        <ApiErrorAlert title="Could not load revisions" error={error} onRetry={() => void load()} />
      )}

      <ListingRevisionTimeline revisions={revisions} publicItems={publicItems} />

      {!hasRevisions && !error && (
        <p className="text-sm text-slate-500">No revisions recorded yet.</p>
      )}
    </div>
  )
}
