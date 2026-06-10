'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'

import { AuthRequiredCard } from '@/components/auth/auth-required-card'
import { SellerAnalyticsDashboard } from '@/components/profile/seller-analytics-dashboard'
import { Card } from '@/components/ui/card'
import {
  fetchSellerAnalytics,
  type SellerAnalyticsBundle,
} from '@/lib/profile-seller-analytics'
import { useRequireAuth } from '@/lib/use-require-auth'

function ProfileSellingContent() {
  const searchParams = useSearchParams()
  const statusParam = searchParams.get('status')
  const statusTab =
    statusParam === 'active' || statusParam === 'sold' ? statusParam : 'all'

  const [data, setData] = useState<SellerAnalyticsBundle | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void fetchSellerAnalytics()
      .then((bundle) => setData(bundle))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load seller analytics')
        setData(null)
      })
      .finally(() => setLoaded(true))
  }, [])

  if (!loaded) {
    return <p className="text-sm text-slate-500">Loading seller analytics…</p>
  }

  if (error) {
    return (
      <Card data-testid="seller-analytics-error">
        <p className="text-sm text-rose-600">{error}</p>
      </Card>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Selling analytics</h1>
        <div className="flex gap-2 text-sm">
          {(['all', 'active', 'sold'] as const).map((tab) => (
            <Link
              key={tab}
              href={tab === 'all' ? '/profile/selling' : `/profile/selling?status=${tab}`}
              className={
                statusTab === tab
                  ? 'font-semibold text-brand'
                  : 'text-slate-500 hover:text-brand'
              }
            >
              {tab === 'all' ? 'All' : tab === 'active' ? 'Active' : 'Sold'}
            </Link>
          ))}
        </div>
      </div>
      {data ? <SellerAnalyticsDashboard data={data} statusTab={statusTab} /> : null}
      <Link href="/sell" className="inline-block text-sm text-brand">
        Create listing →
      </Link>
    </>
  )
}

export default function ProfileSellingPage() {
  const { authRequired } = useRequireAuth()
  if (authRequired) {
    return <AuthRequiredCard returnTo="/profile/selling" title="Sign in" />
  }

  return (
    <div className="space-y-4" data-testid="selling-page-ready">
      <Suspense fallback={<p className="text-sm text-slate-500">Loading seller analytics…</p>}>
        <ProfileSellingContent />
      </Suspense>
    </div>
  )
}
