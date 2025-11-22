'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

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

type RecordItem = {
  id: string
  artist: string
  name: string
  format: string
  catalogNumber?: string
}

const DEFAULT_QUERY = 'Blue Note 1500 first press'

export default function MarketPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const recordId = searchParams.get('record')

  const [query, setQuery] = useState(DEFAULT_QUERY)
  const [results, setResults] = useState<MarketplacePayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [selectedRecord, setSelectedRecord] = useState<RecordItem | null>(null)
  const [listingPrice, setListingPrice] = useState('')
  const [creatingListing, setCreatingListing] = useState(false)

  useEffect(() => {
    if (recordId) {
      void fetchRecord(recordId)
    }
    void searchMarketplace(DEFAULT_QUERY)
  }, [recordId])

  async function fetchRecord(id: string) {
    try {
      const record = await apiFetch<RecordItem>(`/records/${id}`, { auth: true })
      setSelectedRecord(record)
      setQuery(`${record.artist} ${record.name}`)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        router.replace('/login')
      }
    }
  }

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

  async function createListing() {
    if (!selectedRecord || !listingPrice) {
      setMessage('Please select a record and enter a price')
      return
    }
    setCreatingListing(true)
    setMessage('')
    try {
      // TODO: POST to /listings to create a listing
      await apiFetch('/listings', {
        method: 'POST',
        auth: true,
        data: {
          recordId: selectedRecord.id,
          price: parseFloat(listingPrice),
        },
      })
      setMessage('Listing created successfully!')
      setSelectedRecord(null)
      setListingPrice('')
    } catch (error) {
      handleError(error)
    } finally {
      setCreatingListing(false)
    }
  }

  function handleError(err: unknown) {
    if (err instanceof ApiError && err.status === 401) {
      router.replace('/login')
      return
    }
    setMessage(err instanceof Error ? err.message : 'Something went wrong')
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void searchMarketplace()
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Sell / List</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Create marketplace listings for your records and research comparable sales.
        </p>
      </header>

      {/* Create Listing Section */}
      {selectedRecord && (
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">Create Listing</h2>
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {selectedRecord.artist} — {selectedRecord.name}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {selectedRecord.format} {selectedRecord.catalogNumber ? `· ${selectedRecord.catalogNumber}` : ''}
              </p>
            </div>
            <div className="flex gap-3">
              <input
                type="number"
                step="0.01"
                value={listingPrice}
                onChange={(event) => setListingPrice(event.target.value)}
                placeholder="Listing price (USD)"
                className="flex-1 rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-white"
              />
              <Button onClick={createListing} disabled={creatingListing || !listingPrice}>
                {creatingListing ? 'Creating...' : 'Create Listing'}
              </Button>
              <Button variant="ghost" onClick={() => { setSelectedRecord(null); setListingPrice('') }}>
                Cancel
              </Button>
            </div>
            {!selectedRecord && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Select a record from your collection to create a listing, or{' '}
                <Link href="/records" className="text-brand hover:underline">
                  browse your records
                </Link>
              </p>
            )}
          </div>
        </Card>
      )}

      {/* Research Comparable Sales */}
      <Card title="Research Comparable Sales" description="Search eBay to see what similar records are selling for.">
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
              Reset
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












