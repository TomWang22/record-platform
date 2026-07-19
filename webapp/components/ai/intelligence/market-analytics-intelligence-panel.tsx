'use client'

import { useState } from 'react'

import { IntelligencePanelShell } from '@/components/ai/intelligence/intelligence-panel-shell'
import { OwnerProofIntentControl } from '@/components/ai/intelligence/owner-proof-intent-control'
import { fetchMarketAnalyticsIntelligence, IntelligenceHttpError } from '@/lib/ai-intelligence-client'
import {
  assembleMarketAnalyticsRequest,
  type MarketAnalyticsEventInput,
} from '@/lib/ai-market-analytics-assembler'

type MarketAnalyticsIntelligencePanelProps = {
  principalId: string | null
  currency: string
  events: MarketAnalyticsEventInput[]
}

const DEFAULT_INTENT =
  'How did completed Blue Note LP sales change over the last 90 days?'

const meta = (result: Record<string, unknown> | null, key: string) => {
  if (!result) return '—'
  if (key === 'time_range') {
    const customer = result.time_range_customer
    if (typeof customer === 'string' && customer.trim()) return customer
    const tr = result.time_range as { start?: string; end?: string } | undefined
    if (tr?.start && tr?.end) {
      return `${String(tr.start).slice(0, 10)} → ${String(tr.end).slice(0, 10)}`
    }
  }
  if (key === 'methodology') {
    const customer = result.aggregation_method || result.methodology_customer
    if (typeof customer === 'string' && customer.trim()) return customer
  }
  if (key === 'population') {
    const size = result.population_size
    const label = result.population
    if (size != null) return `${label || 'Population'} (${size} events)`
  }
  const value = result[key]
  if (value == null) return '—'
  if (typeof value === 'object') {
    // Never dump raw JSON into the customer panel.
    return 'See report details'
  }
  return String(value)
}

export function MarketAnalyticsIntelligencePanel({
  principalId,
  currency,
  events,
}: MarketAnalyticsIntelligencePanelProps) {
  const [state, setState] = useState<{
    loading: boolean
    error: string | null
    rateLimited: boolean
    result: Record<string, unknown> | null
  }>({ loading: false, error: null, rateLimited: false, result: null })
  const [lastIntent, setLastIntent] = useState(DEFAULT_INTENT)

  async function run(intent: string) {
    if (!principalId) return
    setLastIntent(intent)
    setState({ loading: true, error: null, rateLimited: false, result: null })
    try {
      const response = await fetchMarketAnalyticsIntelligence({
        ...assembleMarketAnalyticsRequest({ principalId, currency, events }),
        force_analytics_floor: events.length === 0,
        user_intent: intent,
        owner_proof_prompt: intent,
      })
      setState({
        loading: false,
        error: null,
        rateLimited: false,
        result: (response.result || {}) as Record<string, unknown>,
      })
    } catch (error) {
      setState({
        loading: false,
        error: error instanceof Error ? error.message : 'Market analytics request failed',
        rateLimited: error instanceof IntelligenceHttpError && error.rateLimited,
        result: null,
      })
    }
  }

  return (
    <IntelligencePanelShell
      title="Market analytics"
      description="Descriptive aggregates only; this panel does not make causal or future-price claims."
      testId="intelligence-market-analytics-panel"
      capability="market_analytics"
      loading={state.loading}
      errorMessage={state.error}
      rateLimited={state.rateLimited}
      limitations={(state.result?.limitations as never) || []}
      evidence={(state.result?.evidence as never) || []}
      freshnessLabel={meta(state.result, 'data_freshness')}
    >
      <div className="min-w-0 space-y-2 overflow-x-auto text-sm">
        <OwnerProofIntentControl
          capability="market_analytics"
          defaultIntent={DEFAULT_INTENT}
          runLabel="Run descriptive report"
          runTestId="intelligence-market-analytics-run"
          disabled={!principalId || state.loading}
          onRun={run}
        />
        {state.result ? (
          <>
            <p className="text-xs text-slate-500" data-testid="intelligence-analytics-intent-echo">
              Answering: {lastIntent}
            </p>
            {state.result.what_changed ? (
              <p
                className="rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200"
                data-testid="intelligence-analytics-what-changed"
              >
                What changed: {String(state.result.what_changed)}
              </p>
            ) : null}
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
              <div className="min-w-0" data-testid="intelligence-analytics-current-median">
                <dt className="font-medium text-slate-500">Current median (completed sales)</dt>
                <dd className="break-words">
                  {String(
                    state.result.price_median ??
                      (state.result.descriptive as Record<string, unknown> | undefined)
                        ?.sold_median ??
                      '—',
                  )}
                </dd>
              </div>
              <div className="min-w-0" data-testid="intelligence-analytics-prior-median">
                <dt className="font-medium text-slate-500">Prior-period median</dt>
                <dd className="break-words">
                  {String(
                    state.result.prior_period_median ??
                      state.result.prior_median ??
                      'Not enough prior-bucket data yet',
                  )}
                </dd>
              </div>
              <div className="min-w-0" data-testid="intelligence-analytics-change">
                <dt className="font-medium text-slate-500">Change</dt>
                <dd className="break-words">
                  {String(
                    state.result.percentage_change ??
                      state.result.absolute_change ??
                      state.result.summary ??
                      'See methodology — asking prices are excluded from sold totals.',
                  )}
                </dd>
              </div>
              <div className="min-w-0 sm:col-span-2">
                <dt className="font-medium text-slate-500">Methodology</dt>
                <dd className="break-words">{meta(state.result, 'methodology')}</dd>
              </div>
            </dl>
            {Array.isArray(state.result.time_buckets) &&
            (state.result.time_buckets as unknown[]).length > 0 ? (
              <table
                className="mt-2 w-full border-collapse text-xs"
                data-testid="intelligence-analytics-trend-table"
              >
                <thead>
                  <tr className="border-b border-slate-200 text-left dark:border-slate-700">
                    <th className="py-1 pr-2">Period</th>
                    <th className="py-1 pr-2">Completed sales</th>
                    <th className="py-1">Median</th>
                  </tr>
                </thead>
                <tbody>
                  {(state.result.time_buckets as Array<Record<string, unknown>>).map((b, i) => (
                    <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="py-1 pr-2">{String(b.label || b.period || `Bucket ${i + 1}`)}</td>
                      <td className="py-1 pr-2">{String(b.count ?? b.sold_count ?? '—')}</td>
                      <td className="py-1">{String(b.median ?? b.price_median ?? '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-xs text-slate-500" data-testid="intelligence-analytics-trend-note">
                Trend table appears when comparable time buckets are present in the report.
              </p>
            )}
          </>
        ) : null}
      </div>
    </IntelligencePanelShell>
  )
}
