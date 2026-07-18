'use client'

import { useEffect, useMemo, useState } from 'react'

import { AuthRequiredCard } from '@/components/auth/auth-required-card'
import { CollectionStatsCharts } from '@/components/collection/collection-stats-charts'
import { MarketAnalyticsIntelligencePanel } from '@/components/ai/intelligence/market-analytics-intelligence-panel'
import { Card } from '@/components/ui/card'
import { apiFetch } from '@/lib/api-client'
import { getClientSessionToken } from '@/lib/session'
import { getUserIdFromToken } from '@/lib/jwt-user'
import type { CollectionRecord } from '@/lib/records-types'
import { isSessionAuthenticated, useSession } from '@/lib/use-session'
import { useRequireAuth } from '@/lib/use-require-auth'

function filterRecords(
  records: CollectionRecord[],
  opts: {
    purchasedFrom?: string
    purchasedTo?: string
    receivedFrom?: string
    receivedTo?: string
  },
): CollectionRecord[] {
  return records.filter((r) => {
    if (opts.purchasedFrom && r.purchasedAt && r.purchasedAt < opts.purchasedFrom) return false
    if (opts.purchasedTo && r.purchasedAt && r.purchasedAt > `${opts.purchasedTo}T23:59:59Z`) {
      return false
    }
    if (opts.receivedFrom && r.receivedAt && r.receivedAt < opts.receivedFrom) return false
    if (opts.receivedTo && r.receivedAt && r.receivedAt > `${opts.receivedTo}T23:59:59Z`) {
      return false
    }
    return true
  })
}

export default function ProfileCollectionStatsPage() {
  const { authRequired } = useRequireAuth()
  const session = useSession()
  const token = isSessionAuthenticated(session) ? session.token : getClientSessionToken()
  const principalId = getUserIdFromToken(token)
  const [records, setRecords] = useState<CollectionRecord[]>([])
  const [loaded, setLoaded] = useState(false)
  const [purchasedFrom, setPurchasedFrom] = useState('')
  const [purchasedTo, setPurchasedTo] = useState('')
  const [receivedFrom, setReceivedFrom] = useState('')
  const [receivedTo, setReceivedTo] = useState('')

  useEffect(() => {
    if (authRequired) return
    void apiFetch<CollectionRecord[]>('/api/records', { auth: true })
      .then((rows) => setRecords(rows))
      .catch(() => setRecords([]))
      .finally(() => setLoaded(true))
  }, [authRequired])

  const filtered = useMemo(
    () =>
      filterRecords(records, {
        purchasedFrom: purchasedFrom || undefined,
        purchasedTo: purchasedTo || undefined,
        receivedFrom: receivedFrom || undefined,
        receivedTo: receivedTo || undefined,
      }),
    [records, purchasedFrom, purchasedTo, receivedFrom, receivedTo],
  )

  if (authRequired) {
    return <AuthRequiredCard returnTo="/profile/collection-stats" title="Sign in" />
  }

  if (!loaded) {
    return <p className="text-sm text-slate-500">Loading collection stats…</p>
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Collection stats</h1>

      <div data-testid="collection-stats-date-filters">
      <Card className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs text-slate-500">
          Purchased from
          <input
            type="date"
            className="mt-1 block w-full rounded border border-slate-200 px-2 py-1 text-sm dark:border-slate-700"
            value={purchasedFrom}
            onChange={(e) => setPurchasedFrom(e.target.value)}
            data-testid="collection-filter-purchased-from"
          />
        </label>
        <label className="text-xs text-slate-500">
          Purchased to
          <input
            type="date"
            className="mt-1 block w-full rounded border border-slate-200 px-2 py-1 text-sm dark:border-slate-700"
            value={purchasedTo}
            onChange={(e) => setPurchasedTo(e.target.value)}
            data-testid="collection-filter-purchased-to"
          />
        </label>
        <label className="text-xs text-slate-500">
          Received from
          <input
            type="date"
            className="mt-1 block w-full rounded border border-slate-200 px-2 py-1 text-sm dark:border-slate-700"
            value={receivedFrom}
            onChange={(e) => setReceivedFrom(e.target.value)}
            data-testid="collection-filter-received-from"
          />
        </label>
        <label className="text-xs text-slate-500">
          Received to
          <input
            type="date"
            className="mt-1 block w-full rounded border border-slate-200 px-2 py-1 text-sm dark:border-slate-700"
            value={receivedTo}
            onChange={(e) => setReceivedTo(e.target.value)}
            data-testid="collection-filter-received-to"
          />
        </label>
      </Card>
      </div>

      <CollectionStatsCharts records={filtered} />
      <MarketAnalyticsIntelligencePanel principalId={principalId} currency="USD" events={[]} />
    </div>
  )
}
