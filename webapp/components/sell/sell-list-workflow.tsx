'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useMemo, useState } from 'react'

import { AuthRequiredCard } from '@/components/auth/auth-required-card'
import { ValuationIntelligencePanel } from '@/components/ai/intelligence/valuation-intelligence-panel'
import { SearchIntelligenceChrome } from '@/components/ai/intelligence/search-intelligence-chrome'
import { RecordMediaUpload, type RecordMediaDraft } from '@/components/records/record-media-upload'
import { ApiErrorAlert } from '@/components/ui/api-error-alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { apiFetch } from '@/lib/api-client'
import type { CollectionRecord } from '@/lib/records-types'
import { useRequireAuth } from '@/lib/use-require-auth'

type MarketplaceItem = {
  title: string
  price?: number
  currency?: string
  url?: string
}

type ListingType = 'fixed_price' | 'obo' | 'auction'

const DEFAULT_QUERY = 'Blue Note 1500 first press'

export function SellListWorkflow({ returnTo = '/sell' }: { returnTo?: string }) {
  const { authRequired, onApiError } = useRequireAuth()
  const [collection, setCollection] = useState<CollectionRecord[]>([])
  const [selectedRecordId, setSelectedRecordId] = useState('')
  const [recordSearch, setRecordSearch] = useState('')
  const [query, setQuery] = useState(DEFAULT_QUERY)
  const [results, setResults] = useState<MarketplaceItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [message, setMessage] = useState('')
  const [creatingListing, setCreatingListing] = useState(false)
  const [listingMedia, setListingMedia] = useState<RecordMediaDraft[]>([])
  const [revisionSummary, setRevisionSummary] = useState<string[]>([])
  const [form, setForm] = useState({
    title: '',
    subtitle: '',
    description: '',
    conditionNotes: '',
    status: 'draft',
    listingType: 'fixed_price' as ListingType,
    price: '',
    currency: 'USD',
    allowOffers: true,
    minimumOffer: '',
    autoAccept: '',
    autoReject: '',
    offerExpirationHours: '48',
    startingBid: '',
    reservePrice: '',
    bidIncrement: '',
    quantity: '1',
    shipsFromCountry: 'US',
    shipsFromRegion: '',
    shipsFromPostal: '',
    domesticShipping: '',
    internationalShipping: '',
    handlingDays: '3',
    localPickup: false,
    combinedShipping: false,
    packageType: 'vinyl_mailers',
    shippingService: 'media_mail',
    shippingNotes: '',
    auctionStart: '',
    auctionEnd: '',
  })

  useEffect(() => {
    if (!authRequired) void loadCollection()
  }, [authRequired])

  async function loadCollection() {
    try {
      const rows = await apiFetch<CollectionRecord[]>('/api/records', { auth: true })
      setCollection(rows)
    } catch {
      setCollection([])
    }
  }

  const filteredCollection = useMemo(() => {
    const q = recordSearch.trim().toLowerCase()
    if (!q) return collection
    return collection.filter(
      (r) =>
        r.artist.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        (r.catalogNumber ?? '').toLowerCase().includes(q),
    )
  }, [collection, recordSearch])

  const selectedRecord = collection.find((r) => r.id === selectedRecordId)

  function applyRecord(rec: CollectionRecord) {
    setSelectedRecordId(rec.id)
    setForm((prev) => ({
      ...prev,
      title: prev.title || `${rec.artist} — ${rec.name}`,
      description: prev.description || `${rec.format}${rec.label ? ` · ${rec.label}` : ''}`,
      conditionNotes: prev.conditionNotes || [rec.recordGrade, rec.sleeveGrade].filter(Boolean).join(' / '),
    }))
    setQuery(`${rec.artist} ${rec.name}`)
  }

  async function searchMarketplace(input = query) {
    const q = input.trim()
    if (!q) return
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch<{
        query: string
        sources: Record<string, { items: MarketplaceItem[] }>
      }>(`/api/marketplace/comparables?${new URLSearchParams({ q })}`)
      const merged = [
        ...(data.sources.platform?.items ?? []),
        ...(data.sources.ebay?.items ?? []),
        ...(data.sources.discogs?.items ?? []),
      ]
      setResults(merged)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }

  function applySuggestedPrice(price: number) {
    if (form.listingType === 'auction') {
      setForm((prev) => ({ ...prev, startingBid: String(price) }))
    } else {
      setForm((prev) => ({ ...prev, price: String(price) }))
    }
    setMessage(`Applied suggested price $${price.toFixed(2)}`)
  }

  async function submitListing(mode: 'draft' | 'publish') {
    setCreatingListing(true)
    setMessage('')
    try {
      const today = new Date().toISOString().slice(0, 10)
      const nextYear = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10)
      const imageUrls = listingMedia.map((m) => m.url).filter(Boolean)
      const images =
        imageUrls.length > 0
          ? imageUrls
          : ['https://picsum.photos/seed/rp-sell-list-flow/400/400']
      const pricing_mode =
        form.listingType === 'auction' ? 'auction' : form.listingType === 'obo' ? 'obo' : 'fixed'
      const amenities: string[] = [
        `sale_type:${pricing_mode === 'auction' ? 'auction' : pricing_mode === 'obo' ? 'obo' : 'fixed'}`,
        `ships_from_country:${form.shipsFromCountry}`,
        `ships_from_region:${form.shipsFromRegion}`,
        `ships_from_postal:${form.shipsFromPostal}`,
      ]
      if (form.conditionNotes.trim()) {
        amenities.push(`condition_notes:${form.conditionNotes.trim()}`)
      }
      if (selectedRecordId) amenities.push(`source_record_id:${selectedRecordId}`)
      if (form.shippingNotes.trim()) amenities.push(`shipping_notes:${form.shippingNotes.trim()}`)
      if (form.shippingService) amenities.push(`shipping_service:${form.shippingService}`)
      if (form.packageType) amenities.push(`package_type:${form.packageType}`)
      await apiFetch('/api/listings/create', {
        method: 'POST',
        auth: true,
        data: {
          title: form.title,
          description: form.description,
          price_cents: Math.round(Number(form.price || form.startingBid || 0) * 100),
          effective_from: today,
          effective_until: nextYear,
          pricing_mode,
          initial_status: mode === 'publish' ? 'active' : 'draft',
          format: selectedRecord?.format,
          media_condition: form.conditionNotes.trim() || undefined,
          images,
          amenities,
          domestic_shipping_cents:
            Math.round(Number(form.domesticShipping || 0) * 100) || undefined,
          international_shipping_cents:
            Math.round(Number(form.internationalShipping || 0) * 100) || undefined,
          domestic_shipping: Boolean(form.domesticShipping),
          international_shipping: Boolean(form.internationalShipping),
          local_pickup: form.localPickup,
          combined_shipping: form.combinedShipping,
          country: form.shipsFromCountry,
          state_or_province: form.shipsFromRegion,
          postal_code: form.shipsFromPostal,
          shipping_notes: form.shippingNotes.trim() || undefined,
          shipping_service: form.shippingService,
          package_type: form.packageType,
        },
      })
      setRevisionSummary((prev) => [`${mode === 'publish' ? 'Published' : 'Draft saved'} at ${new Date().toLocaleString()}`, ...prev])
      setMessage(mode === 'publish' ? 'Listing published.' : 'Draft saved.')
    } catch (err) {
      if (!onApiError(err)) setError(err)
    } finally {
      setCreatingListing(false)
    }
  }

  const auctionCountdown = useMemo(() => {
    if (!form.auctionEnd) return 'Set auction end time'
    const diff = new Date(form.auctionEnd).getTime() - Date.now()
    if (diff <= 0) return 'Auction ended'
    const hours = Math.floor(diff / 3_600_000)
    const minutes = Math.floor((diff % 3_600_000) / 60_000)
    return `${hours}h ${minutes}m remaining`
  }, [form.auctionEnd])

  if (authRequired) {
    return (
      <AuthRequiredCard
        title="Sign in to create a listing"
        description="Select a record from your collection, set price and shipping, then publish."
        returnTo={returnTo}
      />
    )
  }

  return (
    <div className="space-y-6" data-testid="sell-list-ready">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Create listing</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          List from your collection. Comparable research is a helper on the right — not the main workflow.
        </p>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="space-y-4">
          <Card title="1) Select record">
            <input
              value={recordSearch}
              onChange={(e) => setRecordSearch(e.target.value)}
              placeholder="Search my collection…"
              className="mb-3 w-full rounded-xl border border-slate-200/80 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950"
            />
            <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
              {filteredCollection.map((rec) => (
                <li key={rec.id}>
                  <button
                    type="button"
                    data-testid="sell-collection-record"
                    data-record-id={rec.id}
                    onClick={() => applyRecord(rec)}
                    className={`w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-white/5 ${
                      selectedRecordId === rec.id ? 'bg-brand/10 font-medium' : ''
                    }`}
                  >
                    {rec.artist} — {rec.name} <span className="text-slate-500">({rec.format})</span>
                  </button>
                </li>
              ))}
              {filteredCollection.length === 0 && (
                <li className="text-slate-500">No records match. <Link href="/records/new" className="text-brand">Create one</Link></li>
              )}
            </ul>
            {selectedRecord && (
              <div className="mt-3 space-y-3">
                <div className="rounded-lg border border-brand/30 bg-brand/5 p-3 text-sm">
                  <p className="font-medium">{selectedRecord.artist} — {selectedRecord.name}</p>
                  <p className="text-slate-500">{selectedRecord.format} · {selectedRecord.label ?? '—'}</p>
                </div>
                <ValuationIntelligencePanel record={selectedRecord} advisoryOnly />
              </div>
            )}
          </Card>

          <Card title="2) Listing media">
            <RecordMediaUpload value={listingMedia} onChange={setListingMedia} />
            <p className="mt-2 text-xs text-slate-500">Reuse record images when linked; upload additional listing photos here.</p>
          </Card>

          <Card title="3) Listing details">
            <div className="grid gap-2 md:grid-cols-2">
              <input placeholder="Title *" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 md:col-span-2" />
              <input placeholder="Subtitle" value={form.subtitle} onChange={(e) => setForm((p) => ({ ...p, subtitle: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 md:col-span-2" />
              <textarea placeholder="Description" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} className="min-h-[80px] rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 md:col-span-2" />
              <input placeholder="Condition notes" value={form.conditionNotes} onChange={(e) => setForm((p) => ({ ...p, conditionNotes: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
              <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950">
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="paused">Paused</option>
                <option value="sold">Sold</option>
                <option value="archived">Archived</option>
              </select>
              <input type="number" min={1} placeholder="Quantity" value={form.quantity} onChange={(e) => setForm((p) => ({ ...p, quantity: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
            </div>
          </Card>

          <Card title="4) Sale type">
            <div className="flex flex-wrap gap-2">
              {(['fixed_price', 'obo', 'auction'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, listingType: t }))}
                  className={`rounded-lg border px-3 py-2 text-sm capitalize ${form.listingType === t ? 'border-brand bg-brand/10' : 'border-slate-200 dark:border-white/10'}`}
                >
                  {t.replace('_', ' ')}
                </button>
              ))}
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {form.listingType === 'fixed_price' && (
                <>
                  <input placeholder="Price (USD)" value={form.price} onChange={(e) => setForm((p) => ({ ...p, price: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.allowOffers} onChange={(e) => setForm((p) => ({ ...p, allowOffers: e.target.checked }))} />Allow offers</label>
                </>
              )}
              {form.listingType === 'obo' && (
                <>
                  <input placeholder="Asking price" value={form.price} onChange={(e) => setForm((p) => ({ ...p, price: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
                  <input placeholder="Minimum offer" value={form.minimumOffer} onChange={(e) => setForm((p) => ({ ...p, minimumOffer: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
                  <input placeholder="Auto-accept at" value={form.autoAccept} onChange={(e) => setForm((p) => ({ ...p, autoAccept: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
                  <input placeholder="Auto-reject below" value={form.autoReject} onChange={(e) => setForm((p) => ({ ...p, autoReject: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
                </>
              )}
              {form.listingType === 'auction' && (
                <>
                  <input placeholder="Starting bid" value={form.startingBid} onChange={(e) => setForm((p) => ({ ...p, startingBid: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
                  <input placeholder="Reserve price" value={form.reservePrice} onChange={(e) => setForm((p) => ({ ...p, reservePrice: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
                  <input placeholder="Bid increment" value={form.bidIncrement} onChange={(e) => setForm((p) => ({ ...p, bidIncrement: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
                  <input type="datetime-local" value={form.auctionStart} onChange={(e) => setForm((p) => ({ ...p, auctionStart: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
                  <input type="datetime-local" value={form.auctionEnd} onChange={(e) => setForm((p) => ({ ...p, auctionEnd: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
                  <p className="text-xs text-slate-500 md:col-span-2">{auctionCountdown}</p>
                </>
              )}
            </div>
          </Card>

          <Card title="5) Shipping">
            <div className="grid gap-2 md:grid-cols-2">
              <input placeholder="Ships from country" value={form.shipsFromCountry} onChange={(e) => setForm((p) => ({ ...p, shipsFromCountry: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
              <input placeholder="State / region" value={form.shipsFromRegion} onChange={(e) => setForm((p) => ({ ...p, shipsFromRegion: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
              <input placeholder="Postal code" value={form.shipsFromPostal} onChange={(e) => setForm((p) => ({ ...p, shipsFromPostal: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
              <input placeholder="Domestic shipping ($)" value={form.domesticShipping} onChange={(e) => setForm((p) => ({ ...p, domesticShipping: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
              <input placeholder="International shipping ($)" value={form.internationalShipping} onChange={(e) => setForm((p) => ({ ...p, internationalShipping: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
              <input placeholder="Handling days" value={form.handlingDays} onChange={(e) => setForm((p) => ({ ...p, handlingDays: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
              <select value={form.packageType} onChange={(e) => setForm((p) => ({ ...p, packageType: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950">
                <option value="vinyl_mailers">Vinyl mailers</option>
                <option value="box">Box</option>
                <option value="custom">Custom</option>
              </select>
              <select value={form.shippingService} onChange={(e) => setForm((p) => ({ ...p, shippingService: e.target.value }))} className="rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950">
                <option value="media_mail">Media mail</option>
                <option value="standard">Standard</option>
                <option value="expedited">Expedited</option>
                <option value="local_pickup">Local pickup</option>
                <option value="international_standard">International standard</option>
              </select>
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.localPickup} onChange={(e) => setForm((p) => ({ ...p, localPickup: e.target.checked }))} />Local pickup</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={form.combinedShipping} onChange={(e) => setForm((p) => ({ ...p, combinedShipping: e.target.checked }))} />Combined shipping</label>
            </div>
            <textarea placeholder="Shipping notes" value={form.shippingNotes} onChange={(e) => setForm((p) => ({ ...p, shippingNotes: e.target.value }))} className="mt-2 w-full rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" rows={2} />
          </Card>

          <Card title="6) Publish">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void submitListing('draft')} disabled={creatingListing}>Save draft</Button>
              <Button variant="secondary" disabled>Preview</Button>
              <Button onClick={() => void submitListing('publish')} disabled={creatingListing}>Publish</Button>
              <Button variant="ghost" asChild><Link href="/records">Cancel</Link></Button>
            </div>
            {message && <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">{message}</p>}
            {revisionSummary.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs text-slate-500">{revisionSummary.map((r) => <li key={r}>{r}</li>)}</ul>
            )}
            {error && <div className="mt-2"><ApiErrorAlert title="Listing save failed" error={error} onRetry={() => void submitListing('draft')} /></div>}
          </Card>
        </div>

        <aside className="space-y-4">
          <SearchIntelligenceChrome
            query={query}
            keywordLoading={loading}
            onKeywordSearch={async () => {
              await searchMarketplace()
            }}
            onOwnerScopedSearch={async () => {
              // Owner-scoped: filter collection by current query (already local).
              setRecordSearch(query)
            }}
          />
          <Card title="Comparables (helper)">
            <form onSubmit={(e: FormEvent) => { e.preventDefault(); void searchMarketplace() }} className="space-y-2">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Artist / release" className="w-full rounded-xl border px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950" />
              <Button type="submit" disabled={loading} className="w-full">{loading ? 'Searching…' : 'Research comparables'}</Button>
            </form>
            <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
              Clicking a comparable price applies it only after your explicit click — valuation intelligence never auto-fills.
            </p>
            {!results && <p className="mt-3 text-sm text-slate-400">Run a search to see platform, Discogs, and eBay comps.</p>}
            {results && results.length === 0 && <p className="mt-3 text-sm text-slate-500">No comps for this query.</p>}
            {results && results.length > 0 && (
              <ul className="mt-3 max-h-64 divide-y overflow-y-auto text-sm dark:divide-white/5">
                {results.slice(0, 8).map((item, i) => (
                  <li key={`${item.title}-${i}`} className="flex items-center justify-between gap-2 py-2">
                    <span className="truncate">{item.title}</span>
                    {item.price != null && (
                      <button type="button" className="shrink-0 text-xs text-brand" onClick={() => applySuggestedPrice(item.price!)}>
                        ${item.price.toFixed(0)}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </div>
  )
}
