'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { RecordRevisionTimeline } from '@/components/records/record-revision-timeline'
import { AuthRequiredCard } from '@/components/auth/auth-required-card'
import { ApiErrorAlert } from '@/components/ui/api-error-alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { apiFetch } from '@/lib/api-client'
import type { CollectionRecord, RecordRevision } from '@/lib/records-types'
import { useRequireAuth } from '@/lib/use-require-auth'

export default function RecordRevisionsPage() {
  const params = useParams()
  const id = params.id as string
  const { authRequired, onApiError } = useRequireAuth()

  const [record, setRecord] = useState<CollectionRecord | null>(null)
  const [revisions, setRevisions] = useState<RecordRevision[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    if (id && !authRequired) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, authRequired])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [rec, revs] = await Promise.all([
        apiFetch<CollectionRecord>(`/api/records/${id}`, { auth: true }),
        apiFetch<RecordRevision[]>(`/api/records/${id}/revisions`, { auth: true }),
      ])
      setRecord(rec)
      setRevisions(revs)
    } catch (err) {
      if (onApiError(err)) return
      setError(err)
    } finally {
      setLoading(false)
    }
  }

  if (authRequired) {
    return <AuthRequiredCard title="Sign in to view revisions" returnTo={`/records/${id}/revisions`} />
  }

  if (loading) return <p className="text-sm text-slate-500">Loading revision history…</p>

  if (error || !record) {
    return (
      <ApiErrorAlert title="Could not load revisions" error={error ?? new Error('Not found')} onRetry={() => void load()} />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Revision history</h1>
          <p className="text-sm text-slate-500">
            {record.artist} — {record.name} · {revisions.length} revision
            {revisions.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" asChild>
            <Link href={`/records/${id}/edit`}>Edit record</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link href={`/records/${id}`}>Back to record</Link>
          </Button>
        </div>
      </div>

      <Card title="Timeline">
        <RecordRevisionTimeline revisions={revisions} />
      </Card>
    </div>
  )
}
