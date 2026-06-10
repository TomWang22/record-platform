'use client'

import { useState, useEffect } from 'react'

import { AuthRequiredCard } from '@/components/auth/auth-required-card'
import { BuyerPurchasesDashboard } from '@/components/profile/buyer-purchases-dashboard'
import { Card } from '@/components/ui/card'
import {
  fetchBuyerAnalytics,
  type BuyerAnalyticsBundle,
} from '@/lib/profile-buyer-analytics'
import { useRequireAuth } from '@/lib/use-require-auth'

export default function ProfilePurchasesPage() {
  const { authRequired } = useRequireAuth()
  const [data, setData] = useState<BuyerAnalyticsBundle | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [purchasedFrom, setPurchasedFrom] = useState('')
  const [purchasedTo, setPurchasedTo] = useState('')
  const [receivedFrom, setReceivedFrom] = useState('')
  const [receivedTo, setReceivedTo] = useState('')

  useEffect(() => {
    if (authRequired) return
    void fetchBuyerAnalytics()
      .then((bundle) => setData(bundle))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load purchases')
        setData(null)
      })
      .finally(() => setLoaded(true))
  }, [authRequired])

  if (authRequired) {
    return <AuthRequiredCard returnTo="/profile/purchases" title="Sign in" />
  }

  if (!loaded) {
    return <p className="text-sm text-slate-500">Loading purchase analytics…</p>
  }

  if (error) {
    return (
      <Card data-testid="buyer-purchases-error">
        <p className="text-sm text-rose-600">{error}</p>
      </Card>
    )
  }

  return (
    <div className="space-y-6" data-testid="purchases-page-ready">
      <h1 className="text-2xl font-semibold">Purchase analytics</h1>

      <div data-testid="purchases-date-filters">
      <Card className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs text-slate-500">
          Purchased from
          <input
            type="date"
            className="mt-1 block w-full rounded border border-slate-200 px-2 py-1 text-sm dark:border-slate-700"
            value={purchasedFrom}
            onChange={(e) => setPurchasedFrom(e.target.value)}
            data-testid="filter-purchased-from"
          />
        </label>
        <label className="text-xs text-slate-500">
          Purchased to
          <input
            type="date"
            className="mt-1 block w-full rounded border border-slate-200 px-2 py-1 text-sm dark:border-slate-700"
            value={purchasedTo}
            onChange={(e) => setPurchasedTo(e.target.value)}
            data-testid="filter-purchased-to"
          />
        </label>
        <label className="text-xs text-slate-500">
          Received from
          <input
            type="date"
            className="mt-1 block w-full rounded border border-slate-200 px-2 py-1 text-sm dark:border-slate-700"
            value={receivedFrom}
            onChange={(e) => setReceivedFrom(e.target.value)}
            data-testid="filter-received-from"
          />
        </label>
        <label className="text-xs text-slate-500">
          Received to
          <input
            type="date"
            className="mt-1 block w-full rounded border border-slate-200 px-2 py-1 text-sm dark:border-slate-700"
            value={receivedTo}
            onChange={(e) => setReceivedTo(e.target.value)}
            data-testid="filter-received-to"
          />
        </label>
      </Card>
      </div>

      {data ? (
        <BuyerPurchasesDashboard
          data={data}
          purchasedFrom={purchasedFrom || undefined}
          purchasedTo={purchasedTo || undefined}
          receivedFrom={receivedFrom || undefined}
          receivedTo={receivedTo || undefined}
        />
      ) : null}
    </div>
  )
}
