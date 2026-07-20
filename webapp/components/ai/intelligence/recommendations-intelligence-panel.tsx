'use client'

import { useState } from 'react'

import { OwnerProofIntentControl } from '@/components/ai/intelligence/owner-proof-intent-control'
import { IntelligencePanelShell } from '@/components/ai/intelligence/intelligence-panel-shell'
import { fetchRecommendationsIntelligence, IntelligenceHttpError } from '@/lib/ai-intelligence-client'
import { assembleRecommendationsRequest, type RecommendationCandidateInput } from '@/lib/ai-recommendations-assembler'
import { customerCopyForCode, sanitizeCustomerFacingText } from '@/lib/ai-customer-copy'

type RecommendationsIntelligencePanelProps = {
  principalId: string | null
  candidates: RecommendationCandidateInput[]
}

function reasonLabels(item: Record<string, unknown>): string {
  const REASON_COPY: Record<string, string> = {
    blue_note_preference: 'Matches your Blue Note preference.',
    collection_gap: 'Adds an artist or style missing from your collection.',
    budget_fit: 'Fits your $60 budget.',
    picture_disc_excluded: 'Not a picture disc.',
    diversification: 'Chosen to diversify your collection.',
    portfolio_diversification: 'Chosen to diversify your collection.',
    exact_pressing_fit: 'Matches the pressing you care about.',
    metadata_relevance: 'Aligned with your collection metadata.',
    similar_release: 'Similar to releases you already collect.',
    market_opportunity: 'Priced attractively relative to recent sales.',
  }
  const codes = Array.isArray(item.reason_codes) ? item.reason_codes.map(String) : []
  if (codes.length === 0) {
    const raw = item.reason || item.explanation
    if (raw && typeof raw === 'object') {
      return 'Matched from your collection and market signals'
    }
    return String(raw || 'Matched from your collection and market signals')
  }
  return codes
    .map((c) => REASON_COPY[c] || sanitizeCustomerFacingText(c) || customerCopyForCode(c))
    .filter(Boolean)
    .join(' · ')
}

function availabilityLabel(item: Record<string, unknown>): string {
  const raw = item.availability
  if (raw && typeof raw === 'object') {
    const status = String((raw as { status?: string }).status || '').toLowerCase()
    if (status === 'available') return 'Available'
    if (status === 'unavailable') return 'Unavailable'
    if (status === 'deleted') return 'Unavailable'
    return 'Availability unknown'
  }
  if (typeof raw === 'string' && raw.trim()) return raw
  if (item.status) return String(item.status)
  if (item.in_stock === false) return 'Unavailable'
  return 'Available'
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
        recommendation_mode: /diversif/i.test(intent)
          ? 'portfolio_diversification'
          : 'collection_gap',
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
        {state.result?.what_changed ? (
          <p
            className="rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200"
            data-testid="intelligence-recommendations-what-changed"
          >
            What changed: {String(state.result.what_changed)}
          </p>
        ) : null}
        {recommendations.map((item, index) => (
          <div
            key={String(item.entity_id || index)}
            className="rounded border border-slate-200 p-2 dark:border-slate-700"
            data-testid="intelligence-recommendation-card"
          >
            <p className="font-medium">
              {[item.artist, item.title].filter(Boolean).join(' — ') ||
                String(item.title || 'Recommendation')}
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              {[
                item.pressing || item.format,
                typeof item.price === 'number'
                  ? `$${item.price}`
                  : typeof item.price_cents === 'number'
                    ? `$${(Number(item.price_cents) / 100).toFixed(0)}`
                    : null,
                availabilityLabel(item),
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <p className="text-xs text-slate-500">Why: {reasonLabels(item)}</p>
          </div>
        ))}
      </div>
    </IntelligencePanelShell>
  )
}
