'use client'

import { useEffect, useState } from 'react'

import { AuthRequiredCard } from '@/components/auth/auth-required-card'
import { Card } from '@/components/ui/card'
import { apiFetch } from '@/lib/api-client'
import type { CollectionRecord } from '@/lib/records-types'
import { useRequireAuth } from '@/lib/use-require-auth'

export default function ProfileCollectionStatsPage() {
  const { authRequired } = useRequireAuth()
  const [byType, setByType] = useState<Record<string, number>>({})

  useEffect(() => {
    if (!authRequired) {
      void apiFetch<CollectionRecord[]>('/api/records', { auth: true }).then((rows) => {
        const map: Record<string, number> = {}
        for (const r of rows) {
          const t = r.purchaseType ?? 'unknown'
          map[t] = (map[t] ?? 0) + 1
        }
        setByType(map)
      })
    }
  }, [authRequired])

  if (authRequired) return <AuthRequiredCard returnTo="/profile/collection-stats" title="Sign in" />

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Collection stats</h1>
      <Card title="Acquisition type breakdown">
        <ul className="space-y-2 text-sm">
          {Object.entries(byType).map(([k, v]) => (
            <li key={k} className="flex justify-between"><span>{k}</span><span className="font-medium">{v}</span></li>
          ))}
          {Object.keys(byType).length === 0 && <li className="text-slate-500">No records yet.</li>}
        </ul>
      </Card>
      <Card title="Charts">
        <p className="text-sm text-slate-500">Weekly/monthly acquisition charts — adapter in Phase H.</p>
      </Card>
    </div>
  )
}
