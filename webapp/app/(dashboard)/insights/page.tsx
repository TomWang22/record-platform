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
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Insights</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">AI-assisted pricing and trend exploration backed by inference microservices.</p>
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
        <Card title="Suggested price" description="Baseline produced by the AI regression stack.">
          {suggested === null ? (
            <p className="text-sm text-slate-400">No prediction yet.</p>
          ) : (
            <p className="text-4xl font-semibold text-slate-900 dark:text-white">${suggested.toFixed(2)}</p>
          )}
        </Card>

        <Card title="Trend snapshot">
          {trend ? (
            <pre className="text-xs text-slate-500 dark:text-slate-300">{JSON.stringify(trend, null, 2)}</pre>
          ) : (
            <p className="text-sm text-slate-400">Load trends to inspect the historical view.</p>
          )}
        </Card>
      </section>
    </div>
  )
}

function sanitize(input: string) {
  return input.replace(/[<>\"'`;(){}]/g, '').slice(0, 200)
}

