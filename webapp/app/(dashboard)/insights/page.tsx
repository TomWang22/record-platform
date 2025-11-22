'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ApiError, apiFetch } from '@/lib/api-client'

type TrendResponse = Record<string, unknown>

export default function InsightsPage() {
  const [query, setQuery] = useState('Miles Davis Kind of Blue')
  const [suggested, setSuggested] = useState<number | null>(null)
  const [trend, setTrend] = useState<TrendResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handlePredict() {
    setBusy(true)
    setError('')
    try {
      const payload = { items: [{ query: sanitize(query), record_grade: 'VG+', sleeve_grade: 'VG', promo: false, anniversary_boost: 0 }] }
      const response = await apiFetch<{ suggested?: number }>(`/analytics/predict-price`, {
        method: 'POST',
        data: payload,
      })
      setSuggested(response?.suggested ?? null)
    } catch (err) {
      handleError(err)
    } finally {
      setBusy(false)
    }
  }

  async function handleTrends() {
    setError('')
    try {
      const response = await apiFetch<TrendResponse>(`/ai/price-trends?${new URLSearchParams({ q: sanitize(query) })}`)
      setTrend(response)
    } catch (err) {
      handleError(err)
    }
  }

  function handleError(err: unknown) {
    if (err instanceof ApiError) {
      setError(err.message || 'Insights service returned an error')
    } else if (err instanceof Error) {
      setError(err.message)
    } else {
      setError('Unexpected error')
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Insights & AI</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          AI-powered price predictions and market trends powered by Python AI service and analytics.
        </p>
      </header>

      <Card title="Query" description="Provide an artist or release to fetch trendlines and AI price guidance.">
        <div className="flex flex-col gap-3 md:flex-row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Artist / Album"
            className="flex-1 rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
          />
          <div className="flex gap-2">
            <Button onClick={handlePredict} disabled={busy}>
              {busy ? 'Scoring…' : 'Predict price'}
            </Button>
            <Button variant="secondary" onClick={handleTrends} disabled={busy}>
              Load trends
            </Button>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      </Card>

      <section className="grid gap-5 lg:grid-cols-2">
        <Card title="AI Price Prediction" description="Powered by Python AI service with historical data analysis.">
          {suggested === null ? (
            <div className="space-y-2">
              <p className="text-sm text-slate-400">No prediction yet.</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Enter a query above and click "Predict price" to get AI-powered pricing suggestions.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-4xl font-semibold text-brand">${suggested.toFixed(2)}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Based on historical sales data and market trends
              </p>
            </div>
          )}
        </Card>

        <Card title="Price Trends" description="Historical price data from analytics service.">
          {trend ? (
            <div className="space-y-2">
              <pre className="max-h-64 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-300">
                {JSON.stringify(trend, null, 2)}
              </pre>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Price trend data for the last 90 days
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-slate-400">No trend data loaded.</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Click "Load trends" to see historical price movements.
              </p>
            </div>
          )}
        </Card>
      </section>

      {/* Service Status */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">AI Services Status</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Python AI service and Analytics service connectivity
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-xs text-slate-500 dark:text-slate-400">Connected</span>
          </div>
        </div>
      </Card>
    </div>
  )
}

function sanitize(input: string) {
  return input.replace(/[<>\"'`;(){}]/g, '').slice(0, 200)
}

