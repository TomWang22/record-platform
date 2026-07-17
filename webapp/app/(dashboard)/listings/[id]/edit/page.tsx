'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import {
  ListingEditForm,
  formValuesToPatchBody,
  listingToFormValues,
  type ListingFormValues,
} from '@/components/listings/listing-edit-form'
import { ValuationIntelligencePanel } from '@/components/ai/intelligence/valuation-intelligence-panel'
import { AuthRequiredCard } from '@/components/auth/auth-required-card'
import { ApiErrorAlert } from '@/components/ui/api-error-alert'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api-client'
import { fetchListing, patchListing } from '@/lib/listings-api'
import type { CollectionRecord } from '@/lib/records-types'
import { syncListingMedia } from '@/lib/listings-media-sync'
import { useRequireAuth } from '@/lib/use-require-auth'

export default function ListingEditPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const { authRequired, onApiError, isReady, isSignedIn } = useRequireAuth()

  const [values, setValues] = useState<ListingFormValues | null>(null)
  const [valuationSubject, setValuationSubject] = useState<CollectionRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [message, setMessage] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const formReady = isReady && isSignedIn && !authRequired && !loading && values !== null

  useEffect(() => {
    if (id && isReady && !authRequired) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, authRequired, isReady])

  async function load() {
    setLoading(true)
    setError(null)
    setMessage('')
    setSaveState('idle')
    try {
      const listing = await fetchListing(id, true)
      setValues(listingToFormValues(listing))
      setValuationSubject({
        id: String(
          (listing as { source_record_id?: string }).source_record_id || listing.id,
        ),
        artist: listing.artist || 'Unknown',
        name: listing.title || 'Untitled',
        format: listing.format || 'LP',
        catalogNumber: listing.catalogNumber ?? listing.catalog_number ?? null,
        label: listing.label ?? null,
        recordGrade: listing.mediaCondition ?? listing.grade ?? null,
      })
    } catch (err) {
      if (onApiError(err)) return
      setError(err)
      setValues(null)
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    if (!values || !formReady || saving) return
    setSaving(true)
    setSaveState('saving')
    setMessage('')
    setError(null)
    try {
      const body = formValuesToPatchBody(values)
      await patchListing(id, body)
      await syncListingMedia(id, values.images.filter(Boolean), values.primaryImageIndex)
      if (values.status) {
        await apiFetch(`/api/listings/${id}/status`, {
          method: 'PATCH',
          auth: true,
          data: { status: values.status },
        }).catch(() => {
          /* status endpoint may reject draft — non-fatal */
        })
      }
      setMessage('Listing saved.')
      setSaveState('saved')
      router.push(`/listings/${id}`)
    } catch (err) {
      if (onApiError(err)) return
      setError(err)
      setSaveState('error')
    } finally {
      setSaving(false)
    }
  }

  if (!isReady) {
    return <p className="text-sm text-slate-500">Loading session…</p>
  }

  if (authRequired) {
    return <AuthRequiredCard returnTo={`/listings/${id}/edit`} title="Sign in to edit" />
  }

  if (loading) {
    return <p className="text-sm text-slate-500" data-testid="listing-edit-loading">Loading listing…</p>
  }

  if (error) {
    return <ApiErrorAlert title="Cannot load listing" error={error} onRetry={() => void load()} />
  }

  if (!values) return null

  return (
    <div className="mx-auto max-w-4xl space-y-6" data-testid="listing-edit-ready">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Edit listing</h1>
        <Link href={`/listings/${id}`} className="text-sm text-brand">
          ← Back to listing
        </Link>
      </div>
      <ListingEditForm values={values} onChange={setValues} />
      {valuationSubject ? (
        <ValuationIntelligencePanel record={valuationSubject} advisoryOnly />
      ) : null}
      {saveState === 'saving' && (
        <p className="text-sm text-slate-600" data-testid="listing-edit-saving">
          Saving…
        </p>
      )}
      {saveState === 'saved' && message && (
        <p className="text-sm text-green-600" data-testid="listing-edit-saved">
          {message}
        </p>
      )}
      {saveState === 'error' && error ? (
        <div data-testid="listing-edit-save-error">
          <ApiErrorAlert title="Save failed" error={error} onRetry={() => void save()} />
        </div>
      ) : null}
      {message && saveState !== 'error' && saveState !== 'saving' && (
        <p className="text-sm text-green-600">{message}</p>
      )}
      <div className="flex gap-2">
        <Button
          onClick={() => void save()}
          disabled={!formReady || saving}
          data-testid="listing-edit-save"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
        <Button variant="secondary" asChild>
          <Link href={`/listings/${id}/revisions`}>View revisions</Link>
        </Button>
      </div>
    </div>
  )
}
