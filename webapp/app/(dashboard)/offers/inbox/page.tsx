'use client'

import { useCallback, useEffect, useState } from 'react'

import { OffersListPanel } from '@/components/offers/offers-list-panel'
import { ApiErrorAlert } from '@/components/ui/api-error-alert'
import { fetchOffersInbox, type PublicOffer } from '@/lib/offers-api'
import { useRequireAuth } from '@/lib/use-require-auth'

export default function OffersInboxPage() {
  const { authRequired, onApiError } = useRequireAuth()
  const [items, setItems] = useState<PublicOffer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchOffersInbox()
      setItems(data.items ?? [])
    } catch (err) {
      if (onApiError(err)) return
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [onApiError])

  useEffect(() => {
    if (authRequired) return
    void load()
  }, [authRequired, load])

  if (authRequired) {
    return <p className="text-sm text-slate-500">Sign in to view offer inbox.</p>
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading offers…</p>
  }

  if (error) {
    return (
      <ApiErrorAlert title="Could not load offer inbox" error={error} onRetry={() => void load()} />
    )
  }

  return (
    <div className="space-y-4" data-testid="offers-inbox-page">
      <div>
        <h1 className="text-2xl font-semibold">Offer inbox</h1>
        <p className="text-sm text-slate-500">Pending and countered offers on your listings.</p>
      </div>
      <OffersListPanel items={items} mode="inbox" onRefresh={load} />
    </div>
  )
}
