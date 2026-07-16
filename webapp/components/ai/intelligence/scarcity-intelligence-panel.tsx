'use client'

import { useEffect, useState } from 'react'

import { IntelligencePanelShell } from '@/components/ai/intelligence/intelligence-panel-shell'
import {
  fetchScarcityIntelligence,
  IntelligenceHttpError,
} from '@/lib/ai-intelligence-client'
import {
  isAbstentionResult,
  limitationMessages,
  type IntelligencePanelState,
  type ScarcityResult,
} from '@/lib/ai-intelligence-types'
import type { CollectionRecord } from '@/lib/records-types'

type ScarcityIntelligencePanelProps = {
  record: CollectionRecord
}

function subjectFromRecord(record: CollectionRecord) {
  const pressingHint =
    record.catalogNumber ||
    [record.artist, record.name, record.pressingYear].filter(Boolean).join('|') ||
    record.id
  return {
    release_id: `release:${record.artist}:${record.name}`,
    pressing_id: `pressing:${pressingHint}`,
    condition: record.recordGrade || null,
    artist: record.artist,
    title: record.name,
    catalog_number: record.catalogNumber || null,
  }
}

export function ScarcityIntelligencePanel({ record }: ScarcityIntelligencePanelProps) {
  const [state, setState] = useState<IntelligencePanelState<ScarcityResult>>({ status: 'idle' })

  useEffect(() => {
    let cancelled = false
    async function run() {
      setState({ status: 'loading' })
      try {
        const response = await fetchScarcityIntelligence({
          subject: subjectFromRecord(record),
          authorized_scopes: ['public_market', 'authenticated_market', 'owner_private'],
          // Live comparable assembly lands in later 34B/C work. Until then we
          // intentionally send no fabricated sold comps — engine must abstain
          // rather than invent rarity from zero inventory.
          candidates: [],
          claim_rarity_from_zero_results: false,
          require_exact_pressing: true,
        })
        if (cancelled) return
        const result = response.result
        if (!result) {
          setState({
            status: 'error',
            message: 'Scarcity response missing result payload',
          })
          return
        }
        if (isAbstentionResult(result)) {
          setState({
            status: 'abstained',
            result,
            reasons: limitationMessages(result.limitations),
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
          message: err instanceof Error ? err.message : 'Scarcity request failed',
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

  return (
    <IntelligencePanelShell
      title="Scarcity intelligence"
      description="Exact-pressing vs release-level scarcity from market evidence. Never labels rare solely from empty inventory."
      testId="intelligence-scarcity-panel"
      loading={state.status === 'loading' || state.status === 'idle'}
      errorMessage={state.status === 'error' ? state.message : null}
      rateLimited={state.status === 'error' ? state.rateLimited : false}
      abstained={state.status === 'abstained'}
      abstentionReasons={state.status === 'abstained' ? state.reasons : undefined}
      confidence={result?.confidence}
      limitations={result?.limitations}
      evidence={result?.evidence}
      freshnessLabel={
        result
          ? `scope=${result.scope}; sold=${result.recent_sale_count}; supply=${result.active_supply_count}`
          : null
      }
    >
      {state.status === 'ready' && result ? (
        <div className="space-y-2 text-sm text-slate-800 dark:text-slate-100" data-testid="intelligence-scarcity-ready">
          <p>
            Label:{' '}
            <span className="font-semibold capitalize" data-testid="intelligence-scarcity-label">
              {result.scarcity_label}
            </span>{' '}
            <span className="text-xs text-slate-500">({result.scope})</span>
          </p>
          <p className="text-xs text-slate-500">
            Score {result.scarcity_score.toFixed(2)} · comparable scope:{' '}
            {(result.comparable_scope || []).join(', ') || '—'}
          </p>
        </div>
      ) : null}
    </IntelligencePanelShell>
  )
}
