'use client'

import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { RecordRevisionTimeline } from '@/components/records/record-revision-timeline'
import { RecordThumbnail } from '@/components/records/record-thumbnail'
import { RecommendationsIntelligencePanel } from '@/components/ai/intelligence/recommendations-intelligence-panel'
import { ScarcityIntelligencePanel } from '@/components/ai/intelligence/scarcity-intelligence-panel'
import { ValuationIntelligencePanel } from '@/components/ai/intelligence/valuation-intelligence-panel'
import { AuthRequiredCard } from '@/components/auth/auth-required-card'
import { ApiErrorAlert } from '@/components/ui/api-error-alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { apiFetch } from '@/lib/api-client'
import {
  formatDate,
  formatMoneyCents,
  gradeSummary,
  purchaseTypeLabel,
  recordSubtitle,
} from '@/lib/records-format'
import type { CollectionRecord, RecordRevision } from '@/lib/records-types'
import { getUserIdFromToken } from '@/lib/jwt-user'
import { getClientSessionToken } from '@/lib/session'
import { useRequireAuth } from '@/lib/use-require-auth'

type Tab = 'overview' | 'purchase' | 'media' | 'revisions' | 'listing'

export default function RecordDetailPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const id = params.id as string
  const { authRequired, onApiError, isReady } = useRequireAuth()

  useEffect(() => {
    if (id === 'new') {
      router.replace('/records/new')
    }
  }, [id, router])

  const tabParam = searchParams.get('tab') as Tab | null
  const [tab, setTab] = useState<Tab>(tabParam ?? 'overview')
  const [record, setRecord] = useState<CollectionRecord | null>(null)
  const [revisions, setRevisions] = useState<RecordRevision[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const principalId = getUserIdFromToken(getClientSessionToken())

  useEffect(() => {
    if (tabParam) setTab(tabParam)
  }, [tabParam])

  useEffect(() => {
    if (!id || !isReady || authRequired) return
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, authRequired, isReady])

  async function load() {
    setLoading(true)
    setError(null)
    setRecord(null)
    setRevisions([])
    try {
      const rec = await apiFetch<CollectionRecord>(`/api/records/${id}`, { auth: true })
      setRecord(rec)
    } catch (err) {
      if (onApiError(err)) return
      setError(err)
      return
    } finally {
      setLoading(false)
    }

    void apiFetch<RecordRevision[]>(`/api/records/${id}/revisions`, { auth: true })
      .then(setRevisions)
      .catch(() => setRevisions([]))
  }

  async function deleteRecord() {
    if (!confirm('Delete this record from your collection?')) return
    try {
      await apiFetch(`/api/records/${id}`, { method: 'DELETE', auth: true })
      router.push('/records')
    } catch (err) {
      if (onApiError(err)) return
      setError(err)
    }
  }

  if (authRequired) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Record</h1>
        <AuthRequiredCard title="Sign in to view this record" returnTo={`/records/${id}`} />
      </div>
    )
  }

  if (!isReady || loading) {
    return (
      <p className="text-sm text-slate-500" data-testid="record-detail-loading">
        Loading record…
      </p>
    )
  }

  if (error || !record) {
    return (
      <div className="space-y-4">
        <ApiErrorAlert title="Record not found" error={error ?? new Error('Not found')} onRetry={() => void load()} />
        <Button variant="ghost" asChild>
          <Link href="/records">Back to collection</Link>
        </Button>
      </div>
    )
  }

  const grades = gradeSummary(record)
  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'purchase', label: 'Purchase' },
    { id: 'media', label: 'Media' },
    { id: 'revisions', label: `Revisions (${revisions.length})` },
    { id: 'listing', label: 'Listing' },
  ]

  return (
    <div className="space-y-6" data-testid="record-detail-ready">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-4">
          <RecordThumbnail record={record} size="lg" />
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-slate-500">{record.artist}</p>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">{record.name}</h1>
            <p className="mt-1 text-slate-500">{recordSubtitle(record)}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {record.purchaseType && (
                <Badge variant="primary">{purchaseTypeLabel(record.purchaseType)}</Badge>
              )}
              {grades && <Badge variant="outline">{grades}</Badge>}
              <Badge variant="info">Not listed</Badge>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href={`/market?record=${record.id}`}>Create listing</Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link href={`/records/${id}/edit`}>Edit record</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link href={`/records/${id}/revisions`}>Revision history</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/records">Back</Link>
          </Button>
        </div>
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-white/10">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition ${
              tab === t.id
                ? 'border-brand text-brand'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Catalog">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <Detail label="Format" value={record.format} />
              <Detail label="Label" value={record.label} />
              <Detail label="Catalog #" value={record.catalogNumber} />
              <Detail label="Pressing year" value={record.pressingYear} />
              <Detail label="Release year" value={record.releaseYear} />
              <Detail label="Record grade" value={record.recordGrade} />
              <Detail label="Sleeve grade" value={record.sleeveGrade} />
            </dl>
            {record.notes && (
              <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">{record.notes}</p>
            )}
          </Card>
          <Card title="Acquisition summary">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <Detail label="Purchased" value={formatDate(record.purchasedAt)} />
              <Detail label="Received" value={formatDate(record.receivedAt)} />
              <Detail
                label="Paid"
                value={formatMoneyCents(record.purchasePriceCents, record.purchaseCurrency ?? 'USD')}
              />
              <Detail label="Source" value={record.purchaseSource} />
            </dl>
          </Card>
          <div className="space-y-4 lg:col-span-2">
            <ScarcityIntelligencePanel record={record} />
            <ValuationIntelligencePanel record={record} advisoryOnly />
            <RecommendationsIntelligencePanel
              principalId={principalId}
              candidates={[
                {
                  id: record.id,
                  title: `${record.artist} — ${record.name}`,
                  price:
                    record.purchasePriceCents != null
                      ? record.purchasePriceCents / 100
                      : null,
                  currency: record.purchaseCurrency ?? 'USD',
                },
              ]}
            />
          </div>
        </div>
      )}

      {tab === 'purchase' && (
        <Card title="Purchase details">
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Detail label="Type" value={purchaseTypeLabel(record.purchaseType)} />
            <Detail label="Purchased" value={formatDate(record.purchasedAt)} />
            <Detail label="Received" value={formatDate(record.receivedAt)} />
            <Detail label="Source" value={record.purchaseSource} />
            <Detail label="Seller" value={record.sellerName} />
            <Detail label="Order ref" value={record.orderReference} />
            <Detail
              label="Item price"
              value={formatMoneyCents(record.purchasePriceCents, record.purchaseCurrency ?? 'USD')}
            />
            <Detail
              label="Shipping"
              value={formatMoneyCents(record.shippingPaidCents, record.purchaseCurrency ?? 'USD')}
            />
            <Detail
              label="Taxes/fees"
              value={formatMoneyCents(record.taxesFeesPaidCents, record.purchaseCurrency ?? 'USD')}
            />
          </dl>
          {record.purchaseNotes && (
            <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-900">{record.purchaseNotes}</p>
          )}
        </Card>
      )}

      {tab === 'media' && (
        <Card title="Media">
          {(record.mediaPieces?.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-500">No media attached. Add images when editing the record.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-3">
              {record.mediaPieces!.map((m) => (
                <li key={m.id} className="rounded-lg border border-slate-200 p-2 text-sm dark:border-white/10">
                  {m.kind} #{m.index}
                  {m.grade ? ` · ${m.grade}` : ''}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'revisions' && (
        <Card title="Revision history">
          <RecordRevisionTimeline revisions={revisions} />
        </Card>
      )}

      {tab === 'listing' && (
        <Card title="Marketplace listing">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            This record is not linked to an active listing. Use Create listing to start a draft on Sell/List.
          </p>
          <Button className="mt-4" asChild>
            <Link href={`/market?record=${record.id}`}>Create listing</Link>
          </Button>
        </Card>
      )}

      <Card title="Danger zone">
        <Button variant="ghost" className="text-rose-600" onClick={() => void deleteRecord()}>
          Delete record
        </Button>
      </Card>
    </div>
  )
}

function Detail({
  label,
  value,
}: {
  label: string
  value?: string | number | null
}) {
  const display =
    value == null || value === '' ? '—' : typeof value === 'number' ? String(value) : value
  return (
    <div>
      <dt className="text-xs uppercase text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-800 dark:text-slate-100">{display}</dd>
    </div>
  )
}
