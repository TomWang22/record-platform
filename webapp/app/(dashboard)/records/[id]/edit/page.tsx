'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import {
  RecordEditForm,
  formValuesToApiPayload,
  recordToFormValues,
  validateRecordForm,
  type RecordFormValues,
} from '@/components/records/record-edit-form'
import { RecordMediaUpload, recordMediaToApiPieces, type RecordMediaDraft } from '@/components/records/record-media-upload'
import { AuthRequiredCard } from '@/components/auth/auth-required-card'
import { ApiErrorAlert } from '@/components/ui/api-error-alert'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api-client'
import type { CollectionRecord } from '@/lib/records-types'
import { useRequireAuth } from '@/lib/use-require-auth'

export default function RecordEditPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const { authRequired, onApiError } = useRequireAuth()

  const [values, setValues] = useState<RecordFormValues | null>(null)
  const [media, setMedia] = useState<RecordMediaDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (id && !authRequired) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, authRequired])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const rec = await apiFetch<CollectionRecord>(`/api/records/${id}`, { auth: true })
      setValues(recordToFormValues(rec))
    } catch (err) {
      if (onApiError(err)) return
      setError(err)
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    if (!values) return
    const validationError = validateRecordForm(values)
    if (validationError) {
      setMessage(validationError)
      return
    }
    setSaving(true)
    setMessage('')
    try {
      await apiFetch(`/api/records/${id}`, {
        method: 'PUT',
        auth: true,
        data: {
          ...formValuesToApiPayload(values),
          ...(media.length ? { mediaPieces: recordMediaToApiPieces(media) } : {}),
        },
      })
      router.push(`/records/${id}?tab=revisions`)
    } catch (err) {
      if (onApiError(err)) return
      setMessage(err instanceof Error ? err.message : 'Save failed')
      setSaving(false)
    }
  }

  if (authRequired) {
    return (
      <AuthRequiredCard title="Sign in to edit" returnTo={`/records/${id}/edit`} />
    )
  }

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>

  if (error || !values) {
    return (
      <ApiErrorAlert title="Could not load record" error={error ?? new Error('Not found')} onRetry={() => void load()} />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Edit record</h1>
          <p className="text-sm text-slate-500">
            {values.artist} — {values.name}. Saving creates a new revision.
          </p>
        </div>
        <Button variant="ghost" asChild>
          <Link href={`/records/${id}`}>Cancel</Link>
        </Button>
      </div>

      {message && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
          {message}
        </div>
      )}

      <RecordEditForm values={values} onChange={setValues} disabled={saving} />

      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 dark:border-white/10 dark:bg-slate-950">
        <h3 className="mb-3 text-base font-semibold">Media</h3>
        <RecordMediaUpload value={media} onChange={setMedia} disabled={saving} />
      </div>

      <div className="flex gap-3">
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
        <Button variant="ghost" asChild disabled={saving}>
          <Link href={`/records/${id}`}>Discard</Link>
        </Button>
      </div>
    </div>
  )
}
