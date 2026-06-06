'use client'

import { useEffect, useState } from 'react'

import { AuthRequiredCard } from '@/components/auth/auth-required-card'
import { CollectionStatsCharts } from '@/components/collection/collection-stats-charts'
import { apiFetch } from '@/lib/api-client'
import type { CollectionRecord } from '@/lib/records-types'
import { useRequireAuth } from '@/lib/use-require-auth'

export default function ProfileCollectionStatsPage() {
  const { authRequired } = useRequireAuth()
  const [records, setRecords] = useState<CollectionRecord[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (authRequired) return
    void apiFetch<CollectionRecord[]>('/api/records', { auth: true })
      .then((rows) => setRecords(rows))
      .catch(() => setRecords([]))
      .finally(() => setLoaded(true))
  }, [authRequired])

  if (authRequired) {
    return <AuthRequiredCard returnTo="/profile/collection-stats" title="Sign in" />
  }

  if (!loaded) {
    return <p className="text-sm text-slate-500">Loading collection stats…</p>
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Collection stats</h1>
      <CollectionStatsCharts records={records} />
    </div>
  )
}
