'use client'

import { useCallback, useState } from 'react'

import { IntelligencePanelShell } from '@/components/ai/intelligence/intelligence-panel-shell'
import { OwnerProofIntentControl } from '@/components/ai/intelligence/owner-proof-intent-control'
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

const DEFAULT_INTENT =
  'Is this exact CL 1355 pressing scarce, or only the release generally?'

export function ScarcityIntelligencePanel({
  record,
  assemblyOverride,
}: ScarcityIntelligencePanelProps) {
  const [state, setState] = useState<IntelligencePanelState<ScarcityResult>>({ status: 'idle' })
  const [assemblyMeta, setAssemblyMeta] = useState<ScarcityAssemblyResult | null>(null)
  const [lastIntent, setLastIntent] = useState(DEFAULT_INTENT)

  const run = useCallback(
    async (intent: string) => {
      setLastIntent(intent)
      setState({ status: 'loading' })
      try {
        const assembly = assemblyOverride ?? (await gatherLiveMarketEvidenceForRecord(record))
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
          user_intent: intent,
          owner_proof_prompt: intent,
        })
        const result = response.result
        if (!result) {
          setState({
            status: 'error',
            message: 'Scarcity response missing result payload',
          })
          return
        }
        // Prefer engine sold/asking counts (includes authorized completed-sale seed merge).
        setAssemblyMeta({
          ...assembly,
          sold_count:
            typeof result.sold_count === 'number' ? result.sold_count : assembly.sold_count,
          asking_count:
            typeof result.asking_count === 'number' ? result.asking_count : assembly.asking_count,
          recent_sale_count:
            typeof result.recent_sale_count === 'number'
              ? result.recent_sale_count
              : typeof result.sold_count === 'number'
                ? result.sold_count
                : assembly.recent_sale_count,
        })
        if (isAbstentionResult(result)) {
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
          message: err instanceof Error ? err.message : 'Scarcity request failed',
        })
      }
    },
    [assemblyOverride, record],
  )

  const result =
    state.status === 'ready' || state.status === 'abstained' ? state.result : null

  return (
    <IntelligencePanelShell
      title="Scarcity intelligence"
      description="Exact-pressing vs release-level scarcity from live authorized market evidence. Zero inventory alone never means rare."
      testId="intelligence-scarcity-panel"
      capability="scarcity"
      loading={state.status === 'loading'}
      errorMessage={state.status === 'error' ? state.message : null}
      rateLimited={state.status === 'error' ? state.rateLimited : false}
      abstained={state.status === 'abstained'}
      abstentionReasons={state.status === 'abstained' ? state.reasons : undefined}
      confidence={result?.confidence}
      limitations={result?.limitations}
      evidence={result?.evidence}
      freshnessLabel={
        assemblyMeta
          ? `Pressing confidence ${assemblyMeta.subject.pressing_identity_confidence} · ${assemblyMeta.asking_count} asking · ${assemblyMeta.sold_count} sold`
          : null
      }
    >
      <div className="space-y-3 text-sm">
        <OwnerProofIntentControl
          capability="scarcity"
          defaultIntent={DEFAULT_INTENT}
          runLabel="Analyze scarcity"
          runTestId="intelligence-scarcity-run"
          intentTestId="intelligence-scarcity-intent"
          disabled={state.status === 'loading'}
          onRun={run}
        />
        {state.status === 'ready' && result ? (
          <div
            className="space-y-2 text-slate-800 dark:text-slate-100"
            data-testid="intelligence-scarcity-ready"
          >
            <p className="text-xs text-slate-500" data-testid="intelligence-scarcity-intent-echo">
              Answering: {lastIntent}
            </p>
            <p>
              Label:{' '}
              <span className="font-semibold capitalize" data-testid="intelligence-scarcity-label">
                {result.scarcity_label}
              </span>{' '}
              <span className="text-xs text-slate-500">({result.scope})</span>
            </p>
            <p className="text-xs text-slate-500">
              Score {result.scarcity_score.toFixed(2)} · supply {result.active_supply_count} · sold{' '}
              {result.sold_count ?? result.recent_sale_count}
            </p>
            <p className="text-xs text-slate-600">
              Next: refine the pressing identity, or open valuation for price ranges on this copy.
            </p>
          </div>
        ) : null}
      </div>
    </IntelligencePanelShell>
  )
}
