'use client'

import { useState } from 'react'

import { IntelligencePanelShell } from '@/components/ai/intelligence/intelligence-panel-shell'
import { fetchRecommendationsIntelligence, IntelligenceHttpError } from '@/lib/ai-intelligence-client'
import { assembleRecommendationsRequest, type RecommendationCandidateInput } from '@/lib/ai-recommendations-assembler'

type RecommendationsIntelligencePanelProps = {
  principalId: string | null
  candidates: RecommendationCandidateInput[]
}

export function RecommendationsIntelligencePanel({ principalId, candidates }: RecommendationsIntelligencePanelProps) {
  const [state, setState] = useState<{ loading: boolean; error: string | null; rateLimited: boolean; result: Record<string, unknown> | null }>({ loading: false, error: null, rateLimited: false, result: null })

  async function run() {
    if (!principalId) return
    setState({ loading: true, error: null, rateLimited: false, result: null })
    try {
      const response = await fetchRecommendationsIntelligence(assembleRecommendationsRequest({ principalId, candidates }))
      setState({ loading: false, error: null, rateLimited: false, result: (response.result || {}) as Record<string, unknown> })
    } catch (error) {
      setState({ loading: false, error: error instanceof Error ? error.message : 'Recommendations request failed', rateLimited: error instanceof IntelligenceHttpError && error.rateLimited, result: null })
    }
  }

  const recommendations = Array.isArray(state.result?.recommendations) ? state.result.recommendations as Array<Record<string, unknown>> : []
  return <IntelligencePanelShell title="Recommendations" description="Explainable matches only. Budget and negative preferences are enforced; sponsorship never affects rank and appreciation is not predicted." testId="intelligence-recommendations-panel" capability="recommendations" loading={state.loading} errorMessage={state.error} rateLimited={state.rateLimited} limitations={(state.result?.limitations as never) || []} evidence={(state.result?.evidence as never) || []} freshnessLabel="no_pay_to_rank=true; appreciation_prediction=false">
    <div className="space-y-2 text-sm">
      <button
        type="button"
        data-testid="intelligence-recommendations-run"
        onClick={() => void run()}
        disabled={!principalId || state.loading}
        className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        Get recommendations
      </button>
      {recommendations.map((item, index) => <div key={String(item.entity_id || index)} className="rounded border border-slate-200 p-2 dark:border-slate-700"><p className="font-medium">{String(item.title || item.entity_id || 'Recommendation')}</p><p className="text-xs text-slate-500">Reason codes: {Array.isArray(item.reason_codes) ? item.reason_codes.join(', ') : 'not provided'}</p></div>)}
    </div>
  </IntelligencePanelShell>
}
