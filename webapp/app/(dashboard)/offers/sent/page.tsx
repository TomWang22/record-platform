'use client'

import { useCallback, useEffect, useState } from 'react'

import { OffersListPanel } from '@/components/offers/offers-list-panel'
import { ApiErrorAlert } from '@/components/ui/api-error-alert'
import { fetchOffersSent, type PublicOffer } from '@/lib/offers-api'
import { useRequireAuth } from '@/lib/use-require-auth'

export default function OffersSentPage() {
  const { authRequired, onApiError } = useRequireAuth()
  const [items, setItems] = useState<PublicOffer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchOffersSent()
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
    return <p className="text-sm text-slate-500">Sign in to view sent offers.</p>
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading offers…</p>
  }

  if (error) {
    return (
      <ApiErrorAlert title="Could not load sent offers" error={error} onRetry={() => void load()} />
    )
  }

  return (
    <div className="space-y-4" data-testid="offers-sent-page">
      <div>
        <h1 className="text-2xl font-semibold">Sent offers</h1>
        <p className="text-sm text-slate-500">Offers you submitted on marketplace listings.</p>
      </div>
      <OffersListPanel items={items} mode="sent" onRefresh={load} />
    </div>
  )
}
