'use client'

import { useCallback, useState } from 'react'

import { IntelligencePanelShell } from '@/components/ai/intelligence/intelligence-panel-shell'
import { OwnerProofIntentControl } from '@/components/ai/intelligence/owner-proof-intent-control'
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

const DEFAULT_INTENT =
  'What is a quick-sale price versus a patient-sale price for this VG+ copy?'

export function ValuationIntelligencePanel({
  record,
  advisoryOnly = true,
}: ValuationIntelligencePanelProps) {
  const [state, setState] = useState<IntelligencePanelState<ValuationResult>>({ status: 'idle' })
  const [soldAsking, setSoldAsking] = useState<{ sold: number; asking: number } | null>(null)
  const [lastIntent, setLastIntent] = useState(DEFAULT_INTENT)

  const run = useCallback(
    async (intent: string) => {
      setLastIntent(intent)
      setState({ status: 'loading' })
      try {
        const assembly = await gatherLiveValuationEvidenceForRecord(record)
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
          user_intent: intent,
          owner_proof_prompt: intent,
        })
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
    },
    [record],
  )

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
      loading={state.status === 'loading'}
      errorMessage={state.status === 'error' ? state.message : null}
      rateLimited={state.status === 'error' ? state.rateLimited : false}
      abstained={state.status === 'abstained'}
      abstentionReasons={state.status === 'abstained' ? state.reasons : undefined}
      confidence={result?.confidence as number | { score?: number } | undefined}
      limitations={result?.limitations}
      evidence={result?.evidence as never}
      freshnessLabel={
        soldAsking
          ? `${soldAsking.sold} sold comps · ${soldAsking.asking} asking · advisory only`
          : null
      }
    >
      <div className="space-y-3 text-sm">
        <OwnerProofIntentControl
          capability="valuation"
          defaultIntent={DEFAULT_INTENT}
          runLabel="Analyze valuation"
          runTestId="intelligence-valuation-run"
          intentTestId="intelligence-valuation-intent"
          disabled={state.status === 'loading'}
          onRun={run}
        />
        {state.status === 'ready' && result ? (
          <div className="space-y-2" data-testid="intelligence-valuation-ready">
            <div data-testid="intelligence-result-question">
              <p className="text-xs font-medium text-slate-500">Question</p>
              <p data-testid="intelligence-valuation-intent-echo">Answering: {lastIntent}</p>
            </div>
            {result.correction_change ? (
              <div
                className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs dark:border-amber-900 dark:bg-amber-950/40"
                data-testid="intelligence-valuation-correction"
              >
                <p className="font-medium">What changed</p>
                <p>
                  Previous: {String((result.correction_change as { previous_value?: string }).previous_value || '—')}
                </p>
                <p>
                  Updated: {String((result.correction_change as { updated_value?: string }).updated_value || '—')}
                </p>
                <p>
                  Reason:{' '}
                  {String((result.correction_change as { reason_for_update?: string }).reason_for_update || '—')}
                </p>
              </div>
            ) : null}
            <div data-testid="intelligence-result-answer">
              <p className="text-xs font-medium text-slate-500">Answer</p>
              <p>{String(result.summary || 'Evidence-backed quick, fair, and patient sale ranges.')}</p>
            </div>
            <dl className="grid gap-2 sm:grid-cols-3" data-testid="intelligence-result-key-values">
              <div>
                <dt className="text-xs text-slate-500">Quick sale</dt>
                <dd data-testid="intelligence-valuation-quick">
                  {formatRange(
                    result.quick_sale_range ||
                      (typeof result.quick_sale_estimate === 'number'
                        ? {
                            low: Number(result.quick_sale_estimate) * 0.95,
                            high: Number(result.quick_sale_estimate) * 1.05,
                          }
                        : null),
                    currency,
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Fair market</dt>
                <dd data-testid="intelligence-valuation-fair">
                  {formatRange(
                    result.fair_market_range ||
                      (result.low_estimate != null && result.high_estimate != null
                        ? { low: Number(result.low_estimate), high: Number(result.high_estimate) }
                        : null),
                    currency,
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Patient sale</dt>
                <dd data-testid="intelligence-valuation-patient">
                  {formatRange(
                    result.patient_sale_range ||
                      (typeof result.patient_sale_estimate === 'number'
                        ? {
                            low: Number(result.patient_sale_estimate) * 0.95,
                            high: Number(result.patient_sale_estimate) * 1.08,
                          }
                        : null),
                    currency,
                  )}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-slate-500">
              Sold count: {result.sold_comparable_count ?? soldAsking?.sold ?? '—'} · Asking count:{' '}
              {result.asking_price_count ?? soldAsking?.asking ?? '—'}
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300" data-testid="intelligence-result-next-action">
              Ranges are not a single exact price. You must choose any listing price yourself.
            </p>
          </div>
        ) : null}
      </div>
    </IntelligencePanelShell>
  )
}
