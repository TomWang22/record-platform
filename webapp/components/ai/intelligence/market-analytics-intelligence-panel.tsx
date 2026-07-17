'use client'

import { useState } from 'react'

import { IntelligencePanelShell } from '@/components/ai/intelligence/intelligence-panel-shell'
import { fetchMarketAnalyticsIntelligence, IntelligenceHttpError } from '@/lib/ai-intelligence-client'
import { assembleMarketAnalyticsRequest, type MarketAnalyticsEventInput } from '@/lib/ai-market-analytics-assembler'

type MarketAnalyticsIntelligencePanelProps = {
  principalId: string | null
  currency: string
  events: MarketAnalyticsEventInput[]
}

const meta = (result: Record<string, unknown> | null, key: string) => String(result?.[key] ?? '—')

export function MarketAnalyticsIntelligencePanel({ principalId, currency, events }: MarketAnalyticsIntelligencePanelProps) {
  const [state, setState] = useState<{ loading: boolean; error: string | null; rateLimited: boolean; result: Record<string, unknown> | null }>({ loading: false, error: null, rateLimited: false, result: null })
  async function run() {
    if (!principalId) return
    setState({ loading: true, error: null, rateLimited: false, result: null })
    try {
      const response = await fetchMarketAnalyticsIntelligence(assembleMarketAnalyticsRequest({ principalId, currency, events }))
      setState({ loading: false, error: null, rateLimited: false, result: (response.result || {}) as Record<string, unknown> })
    } catch (error) {
      setState({ loading: false, error: error instanceof Error ? error.message : 'Market analytics request failed', rateLimited: error instanceof IntelligenceHttpError && error.rateLimited, result: null })
    }
  }
  return <IntelligencePanelShell title="Market analytics" description="Descriptive aggregates only; this panel does not make causal or future-price claims." testId="intelligence-market-analytics-panel" loading={state.loading} errorMessage={state.error} rateLimited={state.rateLimited} limitations={(state.result?.limitations as never) || []} evidence={(state.result?.evidence as never) || []} freshnessLabel={meta(state.result, 'data_freshness')}>
    <div className="min-w-0 space-y-2 overflow-x-auto text-sm">
      <button type="button" onClick={() => void run()} disabled={!principalId || state.loading} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">Run descriptive report</button>
      {state.result ? (
        <dl className="grid min-w-0 grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="font-medium text-slate-500">Time range</dt>
            <dd className="break-words">{meta(state.result, 'time_range')}</dd>
          </div>
          <div className="min-w-0">
            <dt className="font-medium text-slate-500">Population</dt>
            <dd className="break-words">{meta(state.result, 'population')}</dd>
          </div>
          <div className="min-w-0">
            <dt className="font-medium text-slate-500">Sample size</dt>
            <dd className="break-words">{meta(state.result, 'sample_size')}</dd>
          </div>
          <div className="min-w-0">
            <dt className="font-medium text-slate-500">Currency</dt>
            <dd className="break-words">{meta(state.result, 'currency')}</dd>
          </div>
          <div className="min-w-0 sm:col-span-2">
            <dt className="font-medium text-slate-500">Methodology</dt>
            <dd className="break-all">{meta(state.result, 'methodology')}</dd>
          </div>
          <div className="min-w-0">
            <dt className="font-medium text-slate-500">Freshness</dt>
            <dd className="break-words">{meta(state.result, 'data_freshness')}</dd>
          </div>
        </dl>
      ) : null}
    </div>
  </IntelligencePanelShell>
}
