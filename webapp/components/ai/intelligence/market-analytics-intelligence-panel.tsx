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
    <div className="space-y-2 text-sm">
      <button type="button" onClick={() => void run()} disabled={!principalId || state.loading} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">Run descriptive report</button>
      {state.result ? <dl className="grid grid-cols-2 gap-2 text-xs"><div><dt>Time range</dt><dd>{meta(state.result, 'time_range')}</dd></div><div><dt>Population</dt><dd>{meta(state.result, 'population')}</dd></div><div><dt>Sample size</dt><dd>{meta(state.result, 'sample_size')}</dd></div><div><dt>Currency</dt><dd>{meta(state.result, 'currency')}</dd></div><div><dt>Methodology</dt><dd>{meta(state.result, 'methodology')}</dd></div><div><dt>Freshness</dt><dd>{meta(state.result, 'data_freshness')}</dd></div></dl> : null}
    </div>
  </IntelligencePanelShell>
}
