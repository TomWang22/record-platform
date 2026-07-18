'use client'

import { useState } from 'react'

import { OwnerProofIntentControl } from '@/components/ai/intelligence/owner-proof-intent-control'
import { IntelligencePanelShell } from '@/components/ai/intelligence/intelligence-panel-shell'
import { fetchRecommendationsIntelligence, IntelligenceHttpError } from '@/lib/ai-intelligence-client'
import { assembleRecommendationsRequest, type RecommendationCandidateInput } from '@/lib/ai-recommendations-assembler'
import { sanitizeCustomerFacingText } from '@/lib/ai-customer-copy'

type RecommendationsIntelligencePanelProps = {
  principalId: string | null
  candidates: RecommendationCandidateInput[]
}

function reasonLabels(item: Record<string, unknown>): string {
  const codes = Array.isArray(item.reason_codes) ? item.reason_codes.map(String) : []
  if (codes.length === 0) {
    return String(item.reason || item.explanation || 'Matched from your collection and market signals')
  }
  return codes.map((c) => sanitizeCustomerFacingText(c)).join(' · ')
}

export function RecommendationsIntelligencePanel({
  principalId,
  candidates,
}: RecommendationsIntelligencePanelProps) {
  const [state, setState] = useState<{
    loading: boolean
    error: string | null
    rateLimited: boolean
    result: Record<string, unknown> | null
  }>({ loading: false, error: null, rateLimited: false, result: null })

  const [lastIntent, setLastIntent] = useState(
    'Keep it under $60, exclude picture discs, and diversify artists.',
  )

  async function run(intent: string) {
    if (!principalId) return
    setLastIntent(intent)
    setState({ loading: true, error: null, rateLimited: false, result: null })
    try {
      const response = await fetchRecommendationsIntelligence({
        ...assembleRecommendationsRequest({ principalId, candidates }),
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
        error: error instanceof Error ? error.message : 'Recommendations request failed',
        rateLimited: error instanceof IntelligenceHttpError && error.rateLimited,
        result: null,
      })
    }
  }

  const recommendations = Array.isArray(state.result?.recommendations)
    ? (state.result.recommendations as Array<Record<string, unknown>>)
    : []
  return (
    <IntelligencePanelShell
      title="Recommendations"
      description="Explainable matches only. Budget and negative preferences are enforced; sponsorship never affects rank and appreciation is not predicted."
      testId="intelligence-recommendations-panel"
      capability="recommendations"
      loading={state.loading}
      errorMessage={state.error}
      rateLimited={state.rateLimited}
      limitations={(state.result?.limitations as never) || []}
      evidence={(state.result?.evidence as never) || []}
      freshnessLabel="Paid placement never changes rank · appreciation is not predicted"
    >
      <div className="space-y-2 text-sm">
        <OwnerProofIntentControl
          capability="recommendations"
          defaultIntent={lastIntent}
          runLabel="Get recommendations"
          runTestId="intelligence-recommendations-run"
          disabled={!principalId || state.loading}
          onRun={run}
        />
        {recommendations.length > 0 ? (
          <p className="text-xs text-slate-500">Answering: {lastIntent}</p>
        ) : null}
        {recommendations.map((item, index) => (
          <div
            key={String(item.entity_id || index)}
            className="rounded border border-slate-200 p-2 dark:border-slate-700"
            data-testid="intelligence-recommendation-card"
          >
            <p className="font-medium">{String(item.title || item.entity_id || 'Recommendation')}</p>
            <p className="text-xs text-slate-500">Why: {reasonLabels(item)}</p>
          </div>
        ))}
      </div>
    </IntelligencePanelShell>
  )
}
