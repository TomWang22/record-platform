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
import { gatherLiveMarketEvidenceForRecord } from '@/lib/ai-market-evidence'
import type { ScarcityAssemblyResult } from '@/lib/ai-market-evidence-assembler'
import type { CollectionRecord } from '@/lib/records-types'

type ScarcityIntelligencePanelProps = {
  record: CollectionRecord
  /** Test-only: inject a prebuilt assembly (skips live fetch). */
  assemblyOverride?: ScarcityAssemblyResult
}

export function ScarcityIntelligencePanel({
  record,
  assemblyOverride,
}: ScarcityIntelligencePanelProps) {
  const [state, setState] = useState<IntelligencePanelState<ScarcityResult>>({ status: 'idle' })
  const [assemblyMeta, setAssemblyMeta] = useState<ScarcityAssemblyResult | null>(null)

  useEffect(() => {
    let cancelled = false
    async function run() {
      setState({ status: 'loading' })
      try {
        const assembly =
          assemblyOverride ?? (await gatherLiveMarketEvidenceForRecord(record))
        if (cancelled) return
        setAssemblyMeta(assembly)

        const response = await fetchScarcityIntelligence({
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
          claim_rarity_from_zero_results: false,
          require_exact_pressing: assembly.require_exact_pressing,
          active_supply_count: assembly.active_supply_count,
          recent_sale_count: assembly.recent_sale_count,
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
            reasons: [
              ...limitationMessages(result.limitations),
              ...assembly.limitations,
            ],
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
  }, [record, assemblyOverride])

  const result =
    state.status === 'ready' || state.status === 'abstained' ? state.result : null

  return (
    <IntelligencePanelShell
      title="Scarcity intelligence"
      description="Exact-pressing vs release-level scarcity from live authorized market evidence. Zero inventory alone never means rare."
      testId="intelligence-scarcity-panel"
      capability="scarcity"
      loading={state.status === 'loading' || state.status === 'idle'}
      errorMessage={state.status === 'error' ? state.message : null}
      rateLimited={state.status === 'error' ? state.rateLimited : false}
      abstained={state.status === 'abstained'}
      abstentionReasons={state.status === 'abstained' ? state.reasons : undefined}
      confidence={result?.confidence}
      limitations={result?.limitations}
      evidence={result?.evidence}
      freshnessLabel={
        assemblyMeta
          ? `assembler=${assemblyMeta.assembler_version}; pressing=${assemblyMeta.subject.pressing_identity_confidence}; asking=${assemblyMeta.asking_count}; sold=${assemblyMeta.sold_count}; sources=${assemblyMeta.evidence_sources.join(',') || 'none'}`
          : null
      }
    >
      {state.status === 'ready' && result ? (
        <div
          className="space-y-2 text-sm text-slate-800 dark:text-slate-100"
          data-testid="intelligence-scarcity-ready"
        >
          <p>
            Label:{' '}
            <span className="font-semibold capitalize" data-testid="intelligence-scarcity-label">
              {result.scarcity_label}
            </span>{' '}
            <span className="text-xs text-slate-500">({result.scope})</span>
          </p>
          <p className="text-xs text-slate-500">
            Score {result.scarcity_score.toFixed(2)} · supply {result.active_supply_count} · sold{' '}
            {result.recent_sale_count} · comparable scope:{' '}
            {(result.comparable_scope || []).join(', ') || '—'}
          </p>
          {assemblyMeta ? (
            <p className="text-xs text-slate-500" data-testid="intelligence-scarcity-assembly">
              Live evidence: {assemblyMeta.pressing_candidates.length} exact-pressing ·{' '}
              {assemblyMeta.release_candidates.length} release-level · claim_rarity_from_zero=
              {String(assemblyMeta.claim_rarity_from_zero_results)}
            </p>
          ) : null}
        </div>
      ) : null}
    </IntelligencePanelShell>
  )
}
