'use client'

import { FormEvent, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ApiError, apiFetch } from '@/lib/api-client'

type MarketplaceItem = {
  title: string
  price?: number
  currency?: string
  url?: string
  importCharges?: number | null
}

type MarketplacePayload = {
  query: string
  items: MarketplaceItem[]
}

const DEFAULT_QUERY = 'Blue Note 1500 first press'

export default function MarketPage() {
  const [query, setQuery] = useState(DEFAULT_QUERY)
  const [results, setResults] = useState<MarketplacePayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    void searchMarketplace(DEFAULT_QUERY)
  }, [])

  async function searchMarketplace(input = query) {
    const q = input.trim()
    if (!q) return
    setLoading(true)
    setMessage('')
    try {
      const data = await apiFetch<MarketplacePayload>(`/listings/search/ebay?${new URLSearchParams({ q })}`)
      setResults(data)
    } catch (error) {
      if (error instanceof ApiError) {
        setMessage(error.message || 'Marketplace search failed')
      } else {
        setMessage('Unexpected error during search')
      }
    } finally {
      setLoading(false)
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void searchMarketplace()
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Marketplace radar</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Mirror Discogs/eBay style scouting: search external marketplaces through the listings-service proxy with cache + sanitization.
        </p>
      </header>

      <Card title="Search" description="Queries are sanitized server-side and cached via Redis for 60s.">
        <form className="flex flex-col gap-3 md:flex-row" onSubmit={onSubmit}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Artist / Release / Catalog #"
            className="flex-1 min-w-[220px] rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={loading}>
              {loading ? 'Searching…' : 'Search eBay'}
            </Button>
            <Button type="button" variant="ghost" disabled={loading} onClick={() => setQuery(DEFAULT_QUERY)}>
              Reset prompt
            </Button>
          </div>
        </form>
        {message && <p className="mt-3 text-sm text-rose-600">{message}</p>}
      </Card>

      <Card title="Results" description="Top 10 items from the eBay Browse API (cached for 60s).">
        {!results && <p className="text-sm text-slate-400">No results yet.</p>}
        {results && results.items.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">Nothing returned for “{results.query}”.</p>
        )}
        {results && results.items.length > 0 && (
          <ul className="divide-y divide-slate-100 dark:divide-white/5">
            {results.items.map((item, idx) => (
              <li key={`${item.title}-${idx}`} className="flex flex-col gap-1 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-slate-900 dark:text-white">{item.title}</p>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    {item.price ? `$${item.price.toFixed(2)}` : '—'} {item.currency ?? ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  {item.importCharges != null && <span>Import: {item.importCharges}%</span>}
                  {item.url && (
                    <a
                      className="rounded-full bg-slate-900/5 px-3 py-1 text-slate-700 transition hover:bg-slate-900/10 dark:bg-white/10 dark:text-white"
                      href={item.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      View listing ↗
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}












