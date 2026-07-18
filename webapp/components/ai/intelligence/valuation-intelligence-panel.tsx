'use client'

import { useEffect, useState } from 'react'

import { IntelligencePanelShell } from '@/components/ai/intelligence/intelligence-panel-shell'
import {
  fetchValuationIntelligence,
  IntelligenceHttpError,
} from '@/lib/ai-intelligence-client'
import {
  limitationMessages,
  type IntelligencePanelState,
} from '@/lib/ai-intelligence-types'
import { gatherLiveValuationEvidenceForRecord } from '@/lib/ai-market-evidence'
import type { CollectionRecord } from '@/lib/records-types'

type ValuationResult = {
  currency?: string
  quick_sale_range?: { low?: number; high?: number } | number[]
  fair_market_range?: { low?: number; high?: number } | number[]
  patient_sale_range?: { low?: number; high?: number } | number[]
  sold_comparable_count?: number
  asking_price_count?: number
  time_range?: { start?: string; end?: string } | string
  condition_adjustment?: unknown
  pressing_confidence?: number | string
  evidence?: Array<Record<string, unknown>>
  confidence?: number | { score?: number }
  limitations?: Array<{ code: string; message: string; severity?: string }>
  valuation_status?: string
  [key: string]: unknown
}

function formatRange(range: ValuationResult['fair_market_range'], currency = 'USD'): string {
  if (!range) return '—'
  if (Array.isArray(range) && range.length >= 2) {
    return `${currency} ${range[0]}–${range[1]}`
  }
  if (typeof range === 'object' && range && 'low' in range) {
    return `${currency} ${range.low ?? '—'}–${range.high ?? '—'}`
  }
  return '—'
}

function isValuationAbstention(result: ValuationResult | null | undefined): boolean {
  if (!result) return true
  if (String(result.valuation_status || '').toLowerCase().includes('abstain')) return true
  if (String(result.valuation_status || '').toLowerCase().includes('insufficient')) return true
  return (result.limitations || []).some(
    (l) => l.severity === 'blocking' || /ABSTAIN|INSUFFICIENT/i.test(l.code || ''),
  )
}

type ValuationIntelligencePanelProps = {
  record: CollectionRecord
  /** When true, never writes a price into a parent form — advisory only. */
  advisoryOnly?: boolean
}

export function ValuationIntelligencePanel({
  record,
  advisoryOnly = true,
}: ValuationIntelligencePanelProps) {
  const [state, setState] = useState<IntelligencePanelState<ValuationResult>>({ status: 'idle' })
  const [soldAsking, setSoldAsking] = useState<{ sold: number; asking: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    async function run() {
      setState({ status: 'loading' })
      try {
        const assembly = await gatherLiveValuationEvidenceForRecord(record)
        if (cancelled) return
        setSoldAsking({ sold: assembly.sold_count, asking: assembly.asking_count })

        const response = await fetchValuationIntelligence({
          subject: {
            release_id: assembly.subject.release_id,
            pressing_id: assembly.subject.pressing_id,
            condition: assembly.subject.condition,
            artist: assembly.subject.artist,
            title: assembly.subject.title,
            catalog_number: assembly.subject.catalog_number,
          },
          candidates: assembly.candidates,
          authorized_scopes: assembly.authorized_scopes,
          currency: 'USD',
          min_sold_comps: 2,
        })
        if (cancelled) return
        const result = (response.result || {}) as ValuationResult
        if (isValuationAbstention(result)) {
          setState({
            status: 'abstained',
            result,
            reasons: [...limitationMessages(result.limitations), ...assembly.limitations],
          })
          return
        }
        setState({ status: 'ready', result })
      } catch (err) {
        if (cancelled) return
        if (err instanceof IntelligenceHttpError) {
          setState({
            status: 'error',
            httpStatus: err.httpStatus,
            message: err.message,
            rateLimited: err.rateLimited,
          })
          return
        }
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Valuation request failed',
        })
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [record])

  const result =
    state.status === 'ready' || state.status === 'abstained' ? state.result : null
  const currency = result?.currency || 'USD'

  return (
    <IntelligencePanelShell
      title="Valuation intelligence"
      description={
        advisoryOnly
          ? 'Advisory ranges only — never auto-fills or submits a listing price. Sold and asking evidence are separated.'
          : 'Evidence-backed valuation ranges with sold vs asking separation.'
      }
      testId="intelligence-valuation-panel"
      capability="valuation"
      loading={state.status === 'loading' || state.status === 'idle'}
      errorMessage={state.status === 'error' ? state.message : null}
      rateLimited={state.status === 'error' ? state.rateLimited : false}
      abstained={state.status === 'abstained'}
      abstentionReasons={state.status === 'abstained' ? state.reasons : undefined}
      confidence={result?.confidence as number | { score?: number } | undefined}
      limitations={result?.limitations}
      evidence={result?.evidence as never}
      freshnessLabel={
        soldAsking
          ? `sold_comps=${soldAsking.sold}; asking=${soldAsking.asking}; advisory_only=${String(advisoryOnly)}`
          : null
      }
    >
      {state.status === 'ready' && result ? (
        <div className="space-y-2 text-sm" data-testid="intelligence-valuation-ready">
          <dl className="grid gap-2 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-slate-500">Quick sale</dt>
              <dd data-testid="intelligence-valuation-quick">
                {formatRange(result.quick_sale_range, currency)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Fair market</dt>
              <dd data-testid="intelligence-valuation-fair">
                {formatRange(result.fair_market_range, currency)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Patient sale</dt>
              <dd data-testid="intelligence-valuation-patient">
                {formatRange(result.patient_sale_range, currency)}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-slate-500">
            Sold count: {result.sold_comparable_count ?? soldAsking?.sold ?? '—'} · Asking count:{' '}
            {result.asking_price_count ?? soldAsking?.asking ?? '—'}
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Ranges are not a single exact price. You must choose any listing price yourself.
          </p>
        </div>
      ) : null}
    </IntelligencePanelShell>
  )
}
