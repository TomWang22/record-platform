'use client'

import { useState } from 'react'

import { IntelligencePanelShell } from '@/components/ai/intelligence/intelligence-panel-shell'
import { fetchWatchlistTemperature, IntelligenceHttpError } from '@/lib/ai-intelligence-client'

type SellerAuctionDashboardPanelProps = {
  listingIds?: string[]
}

/**
 * Seller auction dashboard — market temperature / bid velocity aggregates only.
 * Explicitly does not claim bidder identity or manipulation.
 */
export function SellerAuctionDashboardPanel({ listingIds = [] }: SellerAuctionDashboardPanelProps) {
  const [state, setState] = useState<{
    loading: boolean
    error: string | null
    rateLimited: boolean
    result: Record<string, unknown> | null
  }>({ loading: false, error: null, rateLimited: false, result: null })

  async function run() {
    setState({ loading: true, error: null, rateLimited: false, result: null })
    try {
      const response = await fetchWatchlistTemperature({
        listing_ids: listingIds.slice(0, 20),
        analysis_mode: 'seller_dashboard',
        production_mutation_allowed: false,
      })
      setState({
        loading: false,
        error: null,
        rateLimited: false,
        result: (response.result || response) as Record<string, unknown>,
      })
    } catch (error) {
      setState({
        loading: false,
        error: error instanceof Error ? error.message : 'Seller auction dashboard request failed',
        rateLimited: error instanceof IntelligenceHttpError && error.rateLimited,
        result: null,
      })
    }
  }

  const meta = (key: string) => {
    const value = state.result?.[key]
    if (value == null) return '—'
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value)
      } catch {
        return '—'
      }
    }
    return String(value)
  }

  return (
    <IntelligencePanelShell
      title="Seller auction dashboard"
      description="Market temperature, bid velocity, and late-bid pressure aggregates. Never infers bidder identity or collusion."
      testId="intelligence-seller-auction-dashboard"
      loading={state.loading}
      errorMessage={state.error}
      rateLimited={state.rateLimited}
      limitations={(state.result?.limitations as never) || [
        {
          code: 'NO_BIDDER_IDENTITY',
          message: 'Bidder identity and manipulation claims are out of scope.',
          severity: 'info',
        },
      ]}
      evidence={(state.result?.evidence as never) || []}
      freshnessLabel={meta('data_freshness')}
    >
      <div className="min-w-0 space-y-2 overflow-x-auto text-sm">
        <button
          type="button"
          data-testid="intelligence-seller-auction-dashboard-run"
          onClick={() => void run()}
          disabled={state.loading}
          className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          Run seller auction dashboard
        </button>
        {state.result ? (
          <dl className="grid min-w-0 grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="font-medium text-slate-500">Market temperature</dt>
              <dd className="break-words">{meta('temperature') || meta('market_temperature')}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-500">Bid velocity</dt>
              <dd className="break-words">{meta('bid_velocity')}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-500">Late-bid pressure</dt>
              <dd className="break-words">{meta('late_bid_pressure')}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-500">Comparable context</dt>
              <dd className="break-words">{meta('comparable_context') || meta('sample_size')}</dd>
            </div>
          </dl>
        ) : null}
      </div>
    </IntelligencePanelShell>
  )
}
