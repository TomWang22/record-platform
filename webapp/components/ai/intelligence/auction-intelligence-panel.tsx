'use client'

import { useCallback, useState } from 'react'

import { IntelligencePanelShell } from '@/components/ai/intelligence/intelligence-panel-shell'
import { OwnerProofIntentControl } from '@/components/ai/intelligence/owner-proof-intent-control'
import { gatherLiveAuctionDetailEvidence } from '@/lib/ai-auction-evidence'
import { customerCopyForCode } from '@/lib/ai-customer-copy'
import {
  fetchAuctionIntelligence,
  IntelligenceHttpError,
} from '@/lib/ai-intelligence-client'
import {
  limitationMessages,
  type IntelligencePanelState,
} from '@/lib/ai-intelligence-types'
import { getUserIdFromToken } from '@/lib/jwt-user'
import { getClientSessionToken } from '@/lib/session'

type AuctionResult = {
  analysis_mode?: string
  temperature_score?: number
  temperature_label?: string
  auction_count?: number
  bidder_density?: number
  bid_velocity?: number
  late_bid_pressure?: number
  price_acceleration?: number
  closing_time_concentration?: Array<Record<string, unknown>>
  estimated_competition?: number
  buyer_pressure?: string[]
  seller_opportunity?: string[]
  risk_flags?: string[]
  notable_auctions?: Array<Record<string, unknown>>
  evidence?: Array<Record<string, unknown>>
  confidence?: number | { score?: number }
  limitations?: Array<{ code: string; message: string; severity?: string }>
  abstention_reason?: string | null
  data_freshness?: string | null
  [key: string]: unknown
}

type AuctionIntelligencePanelProps = {
  listingId: string
}

function isAuctionAbstention(result: AuctionResult | null | undefined): boolean {
  if (!result) return true
  if (String(result.temperature_label || '').toLowerCase() === 'insufficient_data') return true
  if (result.abstention_reason) return true
  return (result.limitations || []).some(
    (l) => l.severity === 'blocking' || /ABSTAIN|INSUFFICIENT|DELETED/i.test(l.code || ''),
  )
}

function formatMetric(value: number | undefined | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return String(Math.round(value * 10 ** digits) / 10 ** digits)
}

const DEFAULT_AUCTION_INTENT =
  'Is this auction underpriced relative to recent comps, or overheating near close?'

export function AuctionIntelligencePanel({ listingId }: AuctionIntelligencePanelProps) {
  const [state, setState] = useState<IntelligencePanelState<AuctionResult>>({ status: 'idle' })
  const [freshness, setFreshness] = useState<string | null>(null)
  const [lastIntent, setLastIntent] = useState(DEFAULT_AUCTION_INTENT)

  const run = useCallback(
    async (intent: string) => {
      const principalId = getUserIdFromToken(getClientSessionToken())
      if (!principalId) {
        setState({
          status: 'abstained',
          result: { temperature_label: 'insufficient_data' },
          reasons: ['Sign in required for authorized auction intelligence.'],
        })
        return
      }

      setLastIntent(intent)
      setState({ status: 'loading' })
      try {
        const assembly = await gatherLiveAuctionDetailEvidence({ listingId, principalId })
        setFreshness(
          `asking=${assembly.asking_count}; sold_or_completed=${assembly.sold_or_completed_count}; stale=${String(assembly.auction.stale)}`,
        )

        const response = await fetchAuctionIntelligence({
          analysis_mode: 'single_auction',
          requesting_principal_fixture: assembly.requesting_principal_fixture,
          principal_id: assembly.principal_id,
          authorized_scopes: assembly.authorized_scopes,
          subject: assembly.subject,
          auction: assembly.auction,
          candidates: assembly.candidates,
          comparable_auctions: assembly.comparable_auctions,
          request_bidder_identity: false,
          claim_collusion: false,
          claim_shill_bidding: false,
          user_intent: intent,
          owner_proof_prompt: intent,
        })

        const result = (response.result || {}) as AuctionResult
        if (isAuctionAbstention(result)) {
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
          message: err instanceof Error ? err.message : 'Auction intelligence request failed',
        })
      }
    },
    [listingId],
  )

  const result =
    state.status === 'ready' || state.status === 'abstained' ? state.result : null

  return (
    <IntelligencePanelShell
      title="Auction intelligence"
      description="Advisory only. Aggregates market temperature and bid activity proxies — never exposes bidder identities or claims collusion/shill without direct evidence."
      testId="intelligence-auction-panel"
      loading={state.status === 'loading'}
      errorMessage={state.status === 'error' ? state.message : null}
      rateLimited={state.status === 'error' ? state.rateLimited : false}
      abstained={state.status === 'abstained'}
      abstentionReasons={state.status === 'abstained' ? state.reasons : undefined}
      confidence={result?.confidence}
      limitations={result?.limitations}
      evidence={result?.evidence as never}
      freshnessLabel={freshness}
    >
      <div className="space-y-3 text-sm">
        <OwnerProofIntentControl
          capability="auction_intelligence"
          defaultIntent={DEFAULT_AUCTION_INTENT}
          runLabel="Analyze auction"
          runTestId="intelligence-auction-run"
          disabled={!listingId || state.status === 'loading'}
          onRun={run}
        />

        {state.status === 'ready' && result ? (
          <div className="space-y-2" data-testid="intelligence-auction-ready">
            <p className="text-xs text-slate-500" data-testid="intelligence-auction-intent-echo">
              Answering: {lastIntent}
            </p>
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-slate-500">Market temperature</dt>
                <dd data-testid="intelligence-auction-temperature">
                  {result.temperature_label ?? '—'} (
                  {formatMetric(result.temperature_score, 3)})
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Bid velocity (proxy)</dt>
                <dd data-testid="intelligence-auction-velocity">
                  {formatMetric(result.bid_velocity)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Late-bid pressure</dt>
                <dd data-testid="intelligence-auction-late-bid">
                  {formatMetric(result.late_bid_pressure)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Bidder density (count proxy)</dt>
                <dd>{formatMetric(result.bidder_density, 0)}</dd>
              </div>
            </dl>
            {result.risk_flags && result.risk_flags.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-slate-500">Risk flags (non-identity)</p>
                <ul className="list-disc pl-4" data-testid="intelligence-auction-risk-flags">
                  {result.risk_flags.map((flag) => (
                    <li key={flag}>{customerCopyForCode(flag)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="text-[11px] text-slate-500">
              Competition estimates are aggregates only. No bidder identities are shown.
            </p>
          </div>
        ) : null}
      </div>
    </IntelligencePanelShell>
  )
}
