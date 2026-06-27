'use client'

import { useCallback, useEffect, useState } from 'react'

import { AiInsightMeta } from '@/components/ai/ai-insight-meta'
import { Card } from '@/components/ui/card'
import { ApiError } from '@/lib/api-client'
import {
  fetchSellerAuctionPressure,
  fetchSellerCollectorMetadataGaps,
  fetchSellerListingAdvice,
  fetchSellerNegotiationStrategy,
} from '@/lib/ai-insights-client'
import type { AiEnvelope, AiSourceRef } from '@/lib/ai-insights-types'

type PanelState = {
  envelope: AiEnvelope | null
  error: string
  loading: boolean
}

const EMPTY_PANEL: PanelState = { envelope: null, error: '', loading: true }

function panelError(err: unknown): string {
  if (err instanceof ApiError) return err.message || `API error ${err.status}`
  if (err instanceof Error) return err.message
  return 'Request failed'
}

function extractCaveats(envelope: AiEnvelope): string[] {
  const caveats: string[] = []
  const details = envelope.details ?? {}

  if (envelope.source_status === 'degraded' && envelope.degraded_reason) {
    caveats.push(envelope.degraded_reason)
  }

  const missingMeta = details.missing_metadata
  if (Array.isArray(missingMeta) && missingMeta.length > 0) {
    caveats.push(`Missing metadata: ${missingMeta.map(String).join(', ')}`)
  }

  const evidenceGaps = details.evidence_gaps
  if (Array.isArray(evidenceGaps) && evidenceGaps.length > 0) {
    caveats.push(`Evidence gaps: ${evidenceGaps.map(String).join('; ')}`)
  }

  if (details.private_messages_excluded === true) {
    caveats.push('Private message bodies were not used.')
  }

  const summaryLower = envelope.summary.toLowerCase()
  if (
    summaryLower.includes('not enough') ||
    summaryLower.includes('missing evidence') ||
    summaryLower.includes('no offer summaries')
  ) {
    caveats.push('Some guidance depends on evidence not present in retrieved excerpts.')
  }

  return [...new Set(caveats)]
}

function SellerSourceRefs({ refs }: { refs: AiSourceRef[] }) {
  if (!refs.length) {
    return <p className="text-xs text-slate-400">No source references.</p>
  }

  return (
    <ul className="space-y-1">
      {refs.slice(0, 8).map((ref, idx) => (
        <li
          key={`${ref.source_type}-${ref.source_id}-${idx}`}
          className="font-mono text-[11px] text-slate-600 dark:text-slate-300"
          data-testid="seller-intelligence-source-ref"
        >
          {ref.source_type}:{ref.source_id.slice(0, 8)}…
        </li>
      ))}
      {refs.length > 8 && (
        <li className="text-[11px] text-slate-400">+{refs.length - 8} more sources</li>
      )}
    </ul>
  )
}

type SellerCardProps = {
  title: string
  description: string
  cardTestId: string
  summaryTestId: string
  readyTestId: string
  state: PanelState
  showPrivacyNote?: boolean
}

function SellerIntelligenceCard({
  title,
  description,
  cardTestId,
  summaryTestId,
  readyTestId,
  state,
  showPrivacyNote,
}: SellerCardProps) {
  const caveats = state.envelope ? extractCaveats(state.envelope) : []

  return (
    <div data-testid={cardTestId}>
      <Card title={title} description={description}>
        <div className="space-y-3">
          <AiInsightMeta envelope={state.envelope} />
          {state.loading && <p className="text-sm text-slate-400">Loading…</p>}
          {state.error && (
            <p className="text-sm text-rose-600" data-testid="seller-intelligence-error">
              {state.error}
            </p>
          )}
          {state.envelope && (
            <>
              <p
                className="text-sm text-slate-700 dark:text-slate-200"
                data-testid={summaryTestId}
              >
                {state.envelope.summary}
              </p>
              {showPrivacyNote && (
                <p className="text-xs text-slate-500">
                  Private message bodies were not used.
                </p>
              )}
              {caveats.length > 0 && (
                <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-300">
                  {caveats.map((c) => (
                    <li key={c}>Caveat: {c}</li>
                  ))}
                </ul>
              )}
              <SellerSourceRefs refs={state.envelope.source_refs ?? []} />
            </>
          )}
          {!state.loading && (
            <span className="sr-only" data-testid={readyTestId}>
              ready
            </span>
          )}
        </div>
      </Card>
    </div>
  )
}

export function SellerIntelligencePanels() {
  const [listingAdvice, setListingAdvice] = useState<PanelState>(EMPTY_PANEL)
  const [negotiation, setNegotiation] = useState<PanelState>(EMPTY_PANEL)
  const [auctionPressure, setAuctionPressure] = useState<PanelState>(EMPTY_PANEL)
  const [collectorMetadata, setCollectorMetadata] = useState<PanelState>(EMPTY_PANEL)

  const loadPanel = useCallback(
    async (
      fetcher: () => Promise<AiEnvelope>,
      setter: (s: PanelState) => void,
    ) => {
      setter({ envelope: null, error: '', loading: true })
      try {
        const envelope = await fetcher()
        setter({ envelope, error: '', loading: false })
      } catch (err) {
        setter({ envelope: null, error: panelError(err), loading: false })
      }
    },
    [],
  )

  useEffect(() => {
    void Promise.all([
      loadPanel(fetchSellerListingAdvice, setListingAdvice),
      loadPanel(fetchSellerNegotiationStrategy, setNegotiation),
      loadPanel(fetchSellerAuctionPressure, setAuctionPressure),
      loadPanel(fetchSellerCollectorMetadataGaps, setCollectorMetadata),
    ])
  }, [loadPanel])

  return (
    <section className="space-y-4" data-testid="seller-intelligence-panel">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          Seller intelligence
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Structured advice from keyword retrieval and rule-engine synthesis — no vector rollout.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SellerIntelligenceCard
          title="Listing advice"
          description="Catalog health, weak listings, buyer interest gaps, and metadata edits."
          cardTestId="seller-listing-advice-card"
          summaryTestId="seller-listing-advice-summary"
          readyTestId="seller-listing-advice-ready"
          state={listingAdvice}
        />
        <SellerIntelligenceCard
          title="Negotiation strategy"
          description="Offer summaries only — conservative accept/counter/review guidance."
          cardTestId="seller-negotiation-strategy-card"
          summaryTestId="seller-negotiation-strategy-summary"
          readyTestId="seller-negotiation-strategy-ready"
          state={negotiation}
          showPrivacyNote
        />
        <SellerIntelligenceCard
          title="Auction pressure"
          description="Bid-summary signals and urgency caveats when evidence is sparse."
          cardTestId="seller-auction-pressure-card"
          summaryTestId="seller-auction-pressure-summary"
          readyTestId="seller-auction-pressure-ready"
          state={auctionPressure}
        />
        <SellerIntelligenceCard
          title="Collector metadata gaps"
          description="Pressing, condition, provenance, and scarcity present/missing per excerpts."
          cardTestId="seller-collector-metadata-card"
          summaryTestId="seller-collector-metadata-summary"
          readyTestId="seller-collector-metadata-ready"
          state={collectorMetadata}
        />
      </div>
    </section>
  )
}
