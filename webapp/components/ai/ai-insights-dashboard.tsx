'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'

import { AiSourceEvidenceList } from '@/components/ai/ai-source-evidence-list'
import { AiInsightMeta } from '@/components/ai/ai-insight-meta'
import { AiSourceRefsList } from '@/components/ai/ai-source-refs'
import { SellerIntelligencePanels } from '@/components/ai/seller-intelligence-panels'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ApiError } from '@/lib/api-client'
import {
  fetchAuctionMonitorSignals,
  fetchAuctionRisk,
  fetchBuyerCollectionSummary,
  fetchOfferInsights,
  fetchPricingAdvice,
  fetchRecordValuation,
  fetchSellerSummary,
  queryRag,
} from '@/lib/ai-insights-client'
import type { AiEnvelope, AuctionMonitorSignal } from '@/lib/ai-insights-types'
import { fetchAuctionState, type AuctionState } from '@/lib/auctions-api'
import { apiFetch } from '@/lib/api-client'

type PanelState = {
  envelope: AiEnvelope | null
  error: string
  loading: boolean
}

const EMPTY_PANEL: PanelState = { envelope: null, error: '', loading: false }

const SIGNAL_CODES = [
  'bid_spike',
  'ending_soon',
  'proxy_bid_pressure',
  'reserve_not_met',
  'likely_underpriced',
  'stale_listing',
] as const

function panelError(err: unknown): string {
  if (err instanceof ApiError) return err.message || `API error ${err.status}`
  if (err instanceof Error) return err.message
  return 'Request failed'
}

function signalCodesFromEnvelope(envelope: AiEnvelope | null): string[] {
  const signals = envelope?.details?.signals
  if (!Array.isArray(signals)) return []
  return signals
    .map((s) => String((s as { code?: string }).code ?? ''))
    .filter(Boolean)
}

function signalCodesFromMonitor(signals: AuctionMonitorSignal[]): string[] {
  return signals.map((s) => s.signal_code).filter(Boolean)
}

export function AiInsightsDashboard() {
  const searchParams = useSearchParams()
  const focusPanel = searchParams.get('panel')

  const [recordId, setRecordId] = useState('')
  const [listingId, setListingId] = useState('')
  const [auctionListingId, setAuctionListingId] = useState('')
  const [ragQuestion, setRagQuestion] = useState('listing price condition shipping')

  const [rag, setRag] = useState<PanelState>(EMPTY_PANEL)
  const [valuation, setValuation] = useState<PanelState>({ ...EMPTY_PANEL, loading: true })
  const [pricing, setPricing] = useState<PanelState>({ ...EMPTY_PANEL, loading: true })
  const [obo, setObo] = useState<PanelState>(EMPTY_PANEL)
  const [auctionRisk, setAuctionRisk] = useState<PanelState>({ ...EMPTY_PANEL, loading: true })
  const [seller, setSeller] = useState<PanelState>({ ...EMPTY_PANEL, loading: true })
  const [buyer, setBuyer] = useState<PanelState>({ ...EMPTY_PANEL, loading: true })

  const [monitorSignals, setMonitorSignals] = useState<AuctionMonitorSignal[]>([])
  const [monitorStatus, setMonitorStatus] = useState<'live' | 'degraded' | ''>('')
  const [auctionState, setAuctionState] = useState<AuctionState | null>(null)
  const [dashboardReady, setDashboardReady] = useState(false)

  const loadContextIds = useCallback(async () => {
    const [records, mine] = await Promise.all([
      apiFetch<{ id: string }[]>('/api/records', { auth: true }).catch(() => []),
      apiFetch<{ items?: { id: string; pricing_mode?: string; listing_type?: string }[] }>(
        '/api/listings/mine',
        { auth: true },
      ).catch(() => ({ items: [] })),
    ])
    const recId = records[0]?.id ?? ''
    const listings = mine.items ?? []
    const listId = listings[0]?.id ?? ''
    const auctionId =
      listings.find((l) => {
        const mode = String(l.pricing_mode ?? l.listing_type ?? '').toLowerCase()
        return mode === 'auction'
      })?.id ?? listId

    setRecordId(recId)
    setListingId(listId)
    setAuctionListingId(auctionId)
    return { recId, listId, auctionId }
  }, [])

  const loadRag = useCallback(async (question: string) => {
    setRag((s) => ({ ...s, loading: true, error: '' }))
    try {
      const envelope = await queryRag(question)
      setRag({ envelope, error: '', loading: false })
    } catch (err) {
      setRag({ envelope: null, error: panelError(err), loading: false })
    }
  }, [])

  const loadValuation = useCallback(async (id: string) => {
    if (!id) {
      setValuation({
        envelope: null,
        error: 'No owned record available for valuation',
        loading: false,
      })
      return
    }
    setValuation((s) => ({ ...s, loading: true, error: '' }))
    try {
      const envelope = await fetchRecordValuation(id)
      setValuation({ envelope, error: '', loading: false })
    } catch (err) {
      setValuation({ envelope: null, error: panelError(err), loading: false })
    }
  }, [])

  const loadPricing = useCallback(async (id: string) => {
    if (!id) {
      setPricing({
        envelope: null,
        error: 'No owned listing available for pricing advice',
        loading: false,
      })
      return
    }
    setPricing((s) => ({ ...s, loading: true, error: '' }))
    try {
      const envelope = await fetchPricingAdvice(id)
      setPricing({ envelope, error: '', loading: false })
    } catch (err) {
      setPricing({ envelope: null, error: panelError(err), loading: false })
    }
  }, [])

  const loadObo = useCallback(async (id: string) => {
    if (!id) {
      setObo({ envelope: null, error: '', loading: false })
      return
    }
    setObo((s) => ({ ...s, loading: true, error: '' }))
    try {
      const envelope = await fetchOfferInsights(id)
      setObo({ envelope, error: '', loading: false })
    } catch (err) {
      setObo({ envelope: null, error: panelError(err), loading: false })
    }
  }, [])

  const loadAuction = useCallback(async (id: string) => {
    if (!id) {
      setAuctionRisk({
        envelope: null,
        error: 'No auction listing available for risk analysis',
        loading: false,
      })
      setMonitorSignals([])
      setMonitorStatus('degraded')
      setAuctionState(null)
      return
    }
    setAuctionRisk((s) => ({ ...s, loading: true, error: '' }))
    try {
      const [envelope, monitor, state] = await Promise.all([
        fetchAuctionRisk(id),
        fetchAuctionMonitorSignals({ listingId: id, refresh: true }),
        fetchAuctionState(id).catch(() => null),
      ])
      setAuctionRisk({ envelope, error: '', loading: false })
      setMonitorSignals(monitor.signals ?? [])
      setMonitorStatus(monitor.source_status)
      setAuctionState(state)
    } catch (err) {
      setAuctionRisk({ envelope: null, error: panelError(err), loading: false })
      setMonitorSignals([])
      setMonitorStatus('degraded')
      setAuctionState(null)
    }
  }, [])

  const loadSeller = useCallback(async () => {
    setSeller((s) => ({ ...s, loading: true, error: '' }))
    try {
      const envelope = await fetchSellerSummary()
      setSeller({ envelope, error: '', loading: false })
    } catch (err) {
      setSeller({ envelope: null, error: panelError(err), loading: false })
    }
  }, [])

  const loadBuyer = useCallback(async () => {
    setBuyer((s) => ({ ...s, loading: true, error: '' }))
    try {
      const envelope = await fetchBuyerCollectionSummary()
      setBuyer({ envelope, error: '', loading: false })
    } catch (err) {
      setBuyer({ envelope: null, error: panelError(err), loading: false })
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await loadContextIds()
      if (cancelled) return
      setDashboardReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [loadContextIds])

  useEffect(() => {
    let cancelled = false
    let idleId: number | undefined
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const loadSecondaryPanels = () => {
      if (cancelled) return
      void (async () => {
        const ids = await loadContextIds()
        if (cancelled) return
        await Promise.all([
          loadValuation(ids.recId),
          loadPricing(ids.listId),
          loadObo(ids.listId),
          loadAuction(ids.auctionId),
          loadSeller(),
          loadBuyer(),
        ])
      })()
    }

    if (typeof requestIdleCallback !== 'undefined') {
      idleId = requestIdleCallback(loadSecondaryPanels, { timeout: 2500 })
    } else {
      timeoutId = setTimeout(loadSecondaryPanels, 100)
    }

    return () => {
      cancelled = true
      if (idleId != null && typeof cancelIdleCallback !== 'undefined') {
        cancelIdleCallback(idleId)
      }
      if (timeoutId != null) clearTimeout(timeoutId)
    }
  }, [loadContextIds, loadValuation, loadPricing, loadObo, loadAuction, loadSeller, loadBuyer])

  useEffect(() => {
    let cancelled = false
    let idleId: number | undefined
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const prefetchRag = () => {
      if (!cancelled) void loadRag(ragQuestion)
    }

    if (typeof requestIdleCallback !== 'undefined') {
      idleId = requestIdleCallback(prefetchRag, { timeout: 4000 })
    } else {
      timeoutId = setTimeout(prefetchRag, 1500)
    }

    return () => {
      cancelled = true
      if (idleId != null && typeof cancelIdleCallback !== 'undefined') {
        cancelIdleCallback(idleId)
      }
      if (timeoutId != null) clearTimeout(timeoutId)
    }
  }, [loadRag, ragQuestion])

  const auctionSignalCodes = useMemo(() => {
    const codes = new Set([
      ...signalCodesFromEnvelope(auctionRisk.envelope),
      ...signalCodesFromMonitor(monitorSignals),
    ])
    return SIGNAL_CODES.filter((c) => codes.has(c))
  }, [auctionRisk.envelope, monitorSignals])

  const panelClass = (panel: string) =>
    focusPanel === panel ? 'ring-2 ring-brand/40' : ''

  return (
    <div className="space-y-6" data-testid="ai-insights-dashboard">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">AI Insights</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Grounded marketplace insights from live analytics, python-ai, and auction-monitor signals.
        </p>
      </header>

      {dashboardReady && (
        <p className="sr-only" data-testid="ai-insights-dashboard-ready">
          ready
        </p>
      )}

      <SellerIntelligencePanels />

      <Card
        title="RAG query"
        description="Owner-scoped retrieval over listings, records, and bid summaries."
        className={panelClass('rag')}
      >
        <div className="space-y-3" data-testid="ai-insight-rag">
          <div className="flex gap-2">
            <input
              value={ragQuestion}
              onChange={(e) => setRagQuestion(e.target.value)}
              className="flex-1 rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950"
              data-testid="ai-rag-question-input"
            />
            <Button
              variant="secondary"
              onClick={() => void loadRag(ragQuestion)}
              disabled={rag.loading}
            >
              Query
            </Button>
          </div>
          <AiInsightMeta envelope={rag.envelope} testId="ai-insight-meta-rag_query" />
          {rag.loading && <p className="text-sm text-slate-400">Loading RAG insight…</p>}
          {rag.error && <p className="text-sm text-rose-600">{rag.error}</p>}
          {rag.envelope && (
            <>
              <p className="text-sm text-slate-700 dark:text-slate-200" data-testid="ai-rag-summary">
                {rag.envelope.summary}
              </p>
              <AiSourceEvidenceList
                refs={rag.envelope.source_refs}
                excerpts={
                  Array.isArray(rag.envelope.details?.excerpts)
                    ? rag.envelope.details.excerpts
                    : undefined
                }
              />
            </>
          )}
          {!rag.loading && (
            <span className="sr-only" data-testid="ai-insight-rag-ready">
              ready
            </span>
          )}
        </div>
      </Card>

      <section className="grid gap-5 lg:grid-cols-2">
        <Card
          title="Record valuation"
          description="Grade-aware valuation with comparables."
          className={panelClass('valuation')}
        >
          <div className="space-y-3" data-testid="ai-insight-record-valuation">
            <AiInsightMeta envelope={valuation.envelope} testId="ai-insight-meta-record_valuation" />
            {valuation.loading && <p className="text-sm text-slate-400">Loading valuation…</p>}
            {valuation.error && <p className="text-sm text-rose-600">{valuation.error}</p>}
            {valuation.envelope && (
              <>
                <p className="text-sm text-slate-700 dark:text-slate-200">{valuation.envelope.summary}</p>
                {valuation.envelope.details?.valuation_band != null && (
                  <p className="text-xs text-slate-500">
                    Band: {JSON.stringify(valuation.envelope.details.valuation_band)}
                  </p>
                )}
                <AiSourceRefsList refs={valuation.envelope.source_refs} />
              </>
            )}
            {!valuation.loading && (
              <span className="sr-only" data-testid="ai-insight-record-valuation-ready">
                ready
              </span>
            )}
          </div>
        </Card>

        <Card
          title="Listing pricing advice"
          description="Pricing band and negotiation guidance from live listing data."
          className={panelClass('pricing')}
        >
          <div className="space-y-3" data-testid="ai-insight-pricing">
            <AiInsightMeta
              envelope={pricing.envelope}
              testId="ai-insight-meta-pricing_recommendation"
            />
            {pricing.loading && <p className="text-sm text-slate-400">Loading pricing advice…</p>}
            {pricing.error && <p className="text-sm text-rose-600">{pricing.error}</p>}
            {pricing.envelope && (
              <>
                <p className="text-sm text-slate-700 dark:text-slate-200">{pricing.envelope.summary}</p>
                {pricing.envelope.details?.negotiation_guidance != null && (
                  <p className="text-xs text-slate-500">
                    Guidance: {JSON.stringify(pricing.envelope.details.negotiation_guidance)}
                  </p>
                )}
                <AiSourceRefsList refs={pricing.envelope.source_refs} />
              </>
            )}
            {!pricing.loading && (
              <span className="sr-only" data-testid="ai-insight-pricing-ready">
                ready
              </span>
            )}
          </div>
        </Card>
      </section>

      <Card
        title="OBO negotiation helper"
        description="Offer-summary signals only — private message bodies are never shown."
        className={panelClass('pricing')}
      >
        <div className="space-y-3" data-testid="ai-insight-pricing-obo">
          <AiInsightMeta envelope={obo.envelope} testId="ai-insight-meta-obo_helper" />
          {obo.loading && <p className="text-sm text-slate-400">Loading OBO helper…</p>}
          {obo.error && <p className="text-sm text-rose-600">{obo.error}</p>}
          {obo.envelope && (
            <>
              <p className="text-sm text-slate-700 dark:text-slate-200">{obo.envelope.summary}</p>
              {Array.isArray(obo.envelope.details?.signals) && (
                <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
                  {(obo.envelope.details.signals as Array<{ code?: string; detail?: string }>).map(
                    (sig, idx) => (
                      <li key={idx} data-testid="ai-obo-signal">
                        {sig.code}
                        {sig.detail ? ` — ${sig.detail}` : ''}
                      </li>
                    ),
                  )}
                </ul>
              )}
              <AiSourceRefsList refs={obo.envelope.source_refs} />
            </>
          )}
          {!obo.loading && (
            <span className="sr-only" data-testid="ai-insight-pricing-obo-ready">
              ready
            </span>
          )}
        </div>
      </Card>

      <Card
        title="Auction risk monitor"
        description="Risk signals from python-ai and persisted auction-monitor scans."
        className={panelClass('auction')}
      >
        <div className="space-y-3" data-testid="ai-insight-auction-risk">
          <AiInsightMeta envelope={auctionRisk.envelope} testId="ai-insight-meta-auction_risk" />
          {auctionRisk.loading && <p className="text-sm text-slate-400">Loading auction risk…</p>}
          {auctionRisk.error && <p className="text-sm text-rose-600">{auctionRisk.error}</p>}
          {auctionRisk.envelope && (
            <p className="text-sm text-slate-700 dark:text-slate-200">{auctionRisk.envelope.summary}</p>
          )}

          <div className="grid gap-2 text-xs sm:grid-cols-2" data-testid="ai-auction-context">
            <p>
              Current bid:{' '}
              <span data-testid="ai-auction-current-bid">
                {auctionState?.currentBidDisplay ?? '—'}
              </span>
            </p>
            <p>
              Bid count:{' '}
              <span data-testid="ai-auction-bid-count">{auctionState?.bidCount ?? '—'}</span>
            </p>
            <p>
              Reserve:{' '}
              <span data-testid="ai-auction-reserve-status">
                {auctionState ? (auctionState.reserveMet ? 'met' : 'not met') : '—'}
              </span>
            </p>
            <p>
              Time left:{' '}
              <span data-testid="ai-auction-time-left">{auctionState?.timeLeft ?? '—'}</span>
            </p>
            <p className="sm:col-span-2">
              High bidder:{' '}
              <span data-testid="ai-auction-bidder-masked">
                {auctionState?.highBidderMasked ?? 'masked / none'}
              </span>
            </p>
          </div>

          <div data-testid="ai-auction-signal-codes">
            <p className="mb-1 text-xs font-medium text-slate-500">Signal codes</p>
            {auctionSignalCodes.length === 0 ? (
              <p className="text-xs text-slate-400">
                {monitorStatus === 'degraded' ? 'No persisted monitor signals yet' : 'No signals'}
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {auctionSignalCodes.map((code) => (
                  <li
                    key={code}
                    className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] dark:bg-slate-800"
                    data-testid="ai-auction-signal-code"
                  >
                    {code}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {monitorSignals.length > 0 && (
            <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
              {monitorSignals.slice(0, 6).map((sig) => (
                <li key={`${sig.listing_id}-${sig.signal_code}-${sig.id ?? ''}`}>
                  {sig.signal_code}: {sig.detail}
                </li>
              ))}
            </ul>
          )}

          {auctionRisk.envelope && <AiSourceRefsList refs={auctionRisk.envelope.source_refs} />}
          {!auctionRisk.loading && (
            <span className="sr-only" data-testid="ai-insight-auction-risk-ready">
              ready
            </span>
          )}
        </div>
      </Card>

      <section className="grid gap-5 lg:grid-cols-2">
        <Card
          title="Seller summary"
          description="Sales activity across listings, offers, and auctions."
          className={panelClass('seller')}
        >
          <div className="space-y-3" data-testid="ai-insight-seller-summary">
            <AiInsightMeta envelope={seller.envelope} testId="ai-insight-meta-seller_sales_summary" />
            {seller.loading && <p className="text-sm text-slate-400">Loading seller summary…</p>}
            {seller.error && <p className="text-sm text-rose-600">{seller.error}</p>}
            {seller.envelope && (
              <>
                <p className="text-sm text-slate-700 dark:text-slate-200">{seller.envelope.summary}</p>
                {seller.envelope.details?.counts_by_source_type != null && (
                  <p className="text-xs text-slate-500">
                    {JSON.stringify(seller.envelope.details.counts_by_source_type)}
                  </p>
                )}
                <AiSourceRefsList refs={seller.envelope.source_refs} />
              </>
            )}
            {!seller.loading && (
              <span className="sr-only" data-testid="ai-insight-seller-summary-ready">
                ready
              </span>
            )}
          </div>
        </Card>

        <Card
          title="Buyer collection summary"
          description="Collection insights from owned records and acquisitions."
          className={panelClass('buyer')}
        >
          <div className="space-y-3" data-testid="ai-insight-buyer-summary">
            <AiInsightMeta
              envelope={buyer.envelope}
              testId="ai-insight-meta-buyer_collection_summary"
            />
            {buyer.loading && <p className="text-sm text-slate-400">Loading collection summary…</p>}
            {buyer.error && <p className="text-sm text-rose-600">{buyer.error}</p>}
            {buyer.envelope && (
              <>
                <p className="text-sm text-slate-700 dark:text-slate-200">{buyer.envelope.summary}</p>
                {buyer.envelope.details?.record_count != null && (
                  <p className="text-xs text-slate-500">
                    Records: {String(buyer.envelope.details.record_count)}
                  </p>
                )}
                <AiSourceRefsList refs={buyer.envelope.source_refs} />
              </>
            )}
            {!buyer.loading && (
              <span className="sr-only" data-testid="ai-insight-buyer-summary-ready">
                ready
              </span>
            )}
          </div>
        </Card>
      </section>
    </div>
  )
}
