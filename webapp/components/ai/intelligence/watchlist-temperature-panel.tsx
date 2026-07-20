'use client'

import { useCallback, useState } from 'react'

import { IntelligencePanelShell } from '@/components/ai/intelligence/intelligence-panel-shell'
import { OwnerProofIntentControl } from '@/components/ai/intelligence/owner-proof-intent-control'
import {
  gatherLiveSellerAuctionTemperatureEvidence,
  gatherLiveWatchlistTemperatureEvidence,
} from '@/lib/ai-auction-evidence'
import {
  fetchWatchlistTemperature,
  IntelligenceHttpError,
} from '@/lib/ai-intelligence-client'
import {
  limitationMessages,
  type IntelligencePanelState,
} from '@/lib/ai-intelligence-types'
import { getUserIdFromToken } from '@/lib/jwt-user'
import { getClientSessionToken } from '@/lib/session'
import { customerCopyForCode, sanitizeCustomerFacingText } from '@/lib/ai-customer-copy'

type WatchlistTemperatureResult = {
  analysis_mode?: string
  temperature_score?: number
  temperature_label?: string
  auction_count?: number
  bidder_density?: number
  bid_velocity?: number
  late_bid_pressure?: number
  price_acceleration?: number
  closing_time_concentration?: Array<{ bucket?: string; count?: number }>
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

type WatchlistTemperaturePanelProps = {
  /** Defaults to buyer watchlist. Seller mode uses owner auction listings. */
  mode?: 'watchlist' | 'seller'
}

function isAbstention(result: WatchlistTemperatureResult | null | undefined): boolean {
  if (!result) return true
  if (String(result.temperature_label || '').toLowerCase() === 'insufficient_data') return true
  if (result.abstention_reason) return true
  return (result.limitations || []).some(
    (l) => l.severity === 'blocking' || /ABSTAIN|INSUFFICIENT|UNAUTHORIZED/i.test(l.code || ''),
  )
}

function formatMetric(value: number | undefined | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return String(Math.round(value * 10 ** digits) / 10 ** digits)
}

export function WatchlistTemperaturePanel({
  mode = 'watchlist',
}: WatchlistTemperaturePanelProps) {
  const [state, setState] = useState<IntelligencePanelState<WatchlistTemperatureResult>>({
    status: 'idle',
  })
  const [meta, setMeta] = useState<{
    asking: number
    sold: number
    underpriced: number
    overheated: number
    endingBuckets: number
  } | null>(null)
  const [lastIntent, setLastIntent] = useState(
    'Which watched lots look underpriced, and which are overheating?',
  )

  const run = useCallback(
    async (intent: string) => {
      const principalId = getUserIdFromToken(getClientSessionToken())
      if (!principalId) {
        setState({
          status: 'abstained',
          result: { temperature_label: 'insufficient_data' },
          reasons: ['Sign in required for authorized watchlist temperature.'],
        })
        return
      }

      setLastIntent(intent)
      setState({ status: 'loading' })
      try {
        const assembly =
          mode === 'seller'
            ? await gatherLiveSellerAuctionTemperatureEvidence({ principalId })
            : await gatherLiveWatchlistTemperatureEvidence({ principalId })

        setMeta({
          asking: assembly.asking_count,
          sold: assembly.sold_or_completed_count,
          underpriced: assembly.underpriced_candidates.length,
          overheated: assembly.overheated_candidates.length,
          endingBuckets: assembly.ending_concentration.length,
        })

        const response = await fetchWatchlistTemperature({
          analysis_mode: 'watchlist_batch',
          requesting_principal_fixture: assembly.requesting_principal_fixture,
          principal_id: assembly.principal_id,
          watchlist_owner_principal_fixture: assembly.watchlist_owner_principal_fixture,
          unauthorized_watchlist: assembly.unauthorized_watchlist,
          authorized_scopes: assembly.authorized_scopes,
          watchlist_auctions: assembly.watchlist_auctions,
          candidates: assembly.candidates,
          request_bidder_identity: false,
          claim_collusion: false,
          claim_shill_bidding: false,
          user_intent: intent,
          owner_proof_prompt: intent,
        })

        const result = (response.result || {}) as WatchlistTemperatureResult
        if (assembly.unauthorized_watchlist || isAbstention(result)) {
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
          message: err instanceof Error ? err.message : 'Watchlist temperature request failed',
        })
      }
    },
    [mode],
  )

  const result =
    state.status === 'ready' || state.status === 'abstained' ? state.result : null
  const title =
    mode === 'seller' ? 'Seller auction temperature' : 'Watchlist auction temperature'
  const buttonLabel = mode === 'seller' ? 'Analyze seller auctions' : 'Analyze watchlist'
  const defaultIntent =
    mode === 'seller'
      ? 'Which of my ending auctions look underpriced or overheating?'
      : 'Which watched lots look underpriced, and which are overheating?'

  return (
    <IntelligencePanelShell
      title={title}
      description="Batch market-temperature report for authorized auction lots. Separates asking vs sold/completed. Never exposes bidder identities."
      testId={
        mode === 'seller'
          ? 'intelligence-seller-auction-temperature-panel'
          : 'intelligence-watchlist-temperature-panel'
      }
      loading={state.status === 'loading'}
      errorMessage={state.status === 'error' ? state.message : null}
      rateLimited={state.status === 'error' ? state.rateLimited : false}
      abstained={state.status === 'abstained'}
      abstentionReasons={state.status === 'abstained' ? state.reasons : undefined}
      confidence={result?.confidence}
      limitations={result?.limitations}
      evidence={result?.evidence as never}
      freshnessLabel={
        meta
          ? `asking=${meta.asking}; sold_or_completed=${meta.sold}; underpriced=${meta.underpriced}; overheated=${meta.overheated}; ending_buckets=${meta.endingBuckets}`
          : null
      }
    >
      <div className="space-y-3 text-sm">
        <OwnerProofIntentControl
          capability="auction_intelligence"
          defaultIntent={defaultIntent}
          runLabel={buttonLabel}
          runTestId={
            mode === 'seller'
              ? 'intelligence-seller-auction-temperature-run'
              : 'intelligence-watchlist-temperature-run'
          }
          disabled={state.status === 'loading'}
          onRun={run}
        />

        {state.status === 'ready' && result ? (
          <div
            className="space-y-3"
            data-testid={
              mode === 'seller'
                ? 'intelligence-seller-auction-temperature-ready'
                : 'intelligence-watchlist-temperature-ready'
            }
          >
            <p className="text-xs text-slate-500" data-testid="intelligence-watchlist-intent-echo">
              Answering: {lastIntent}
            </p>
            {result.correction_change && typeof result.correction_change === 'object' ? (
              <div
                className="rounded-md border border-amber-200/80 bg-amber-50/80 p-3 text-xs dark:border-amber-900/50 dark:bg-amber-950/30"
                data-testid="intelligence-watchlist-what-changed"
              >
                <p className="font-medium text-amber-900 dark:text-amber-100">What changed</p>
                <p>
                  Previous:{' '}
                  {String(
                    (result.correction_change as { previous_value?: string }).previous_value || '—',
                  )}
                </p>
                <p>
                  Updated:{' '}
                  {String(
                    (result.correction_change as { updated_value?: string }).updated_value || '—',
                  )}
                </p>
                <p>
                  Reason:{' '}
                  {String(
                    (result.correction_change as { reason_for_update?: string }).reason_for_update ||
                      '—',
                  )}
                </p>
              </div>
            ) : null}
            <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-xs text-slate-500">Market temperature</dt>
                <dd data-testid="intelligence-watchlist-temperature-label">
                  {result.temperature_label ?? '—'} (
                  {formatMetric(result.temperature_score, 3)})
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Auction count</dt>
                <dd data-testid="intelligence-watchlist-auction-count">
                  {result.auction_count ?? meta?.asking ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Bid velocity (proxy)</dt>
                <dd data-testid="intelligence-watchlist-velocity">
                  {formatMetric(result.bid_velocity)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Late-bid pressure</dt>
                <dd data-testid="intelligence-watchlist-late-bid">
                  {formatMetric(result.late_bid_pressure)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Price acceleration</dt>
                <dd>{formatMetric(result.price_acceleration)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Estimated competition</dt>
                <dd>{formatMetric(result.estimated_competition)}</dd>
              </div>
            </dl>

            {(result.closing_time_concentration?.length || meta?.endingBuckets) ? (
              <div>
                <p className="text-xs font-medium text-slate-500">Ending-time concentration</p>
                <ul
                  className="list-disc pl-4 text-xs"
                  data-testid="intelligence-watchlist-ending-concentration"
                >
                  {(result.closing_time_concentration || []).slice(0, 6).map((bucket, i) => (
                    <li key={`${bucket.bucket || i}`}>
                      {bucket.bucket || 'bucket'} · count {bucket.count ?? 0}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {meta && (meta.underpriced > 0 || meta.overheated > 0) ? (
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Candidate flags (price/activity proxies only): underpriced={meta.underpriced},
                overheated={meta.overheated}. Not collusion or manipulation claims.
              </p>
            ) : null}

            {result.buyer_pressure && result.buyer_pressure.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-slate-500">Buyer pressure signals</p>
                <ul className="list-disc pl-4">
                  {result.buyer_pressure.map((line) => (
                    <li key={line}>
                      {/^[a-z0-9_]+$/i.test(String(line))
                        ? customerCopyForCode(line)
                        : sanitizeCustomerFacingText(line)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {result.seller_opportunity && result.seller_opportunity.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-slate-500">Seller opportunity signals</p>
                <ul className="list-disc pl-4">
                  {result.seller_opportunity.map((line) => (
                    <li key={line}>
                      {/^[a-z0-9_]+$/i.test(String(line))
                        ? customerCopyForCode(line)
                        : sanitizeCustomerFacingText(line)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className="text-[11px] text-slate-500">
              Confidence and limitations are shown below. Asking vs sold/completed evidence is
              separated in the assembler before this report runs.
            </p>
          </div>
        ) : null}
      </div>
    </IntelligencePanelShell>
  )
}
