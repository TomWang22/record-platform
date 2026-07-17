'use client'

import { useState } from 'react'

import { IntelligencePanelShell } from '@/components/ai/intelligence/intelligence-panel-shell'
import {
  fetchNegotiationAssistance,
  IntelligenceHttpError,
} from '@/lib/ai-intelligence-client'
import type { IntelligencePanelState } from '@/lib/ai-intelligence-types'
import type { PublicOffer } from '@/lib/offers-api'

type OfferNegotiationAssistProps = {
  offer: PublicOffer
  role: 'buyer' | 'seller'
  currentUserId: string | null
}

/**
 * Offer-context negotiation assist. Never auto-accepts/counters/sends.
 * Uses authorized offer participants only.
 */
export function OfferNegotiationAssist({
  offer,
  role,
  currentUserId,
}: OfferNegotiationAssistProps) {
  const [state, setState] = useState<IntelligencePanelState<Record<string, unknown>>>({
    status: 'idle',
  })
  const [draft, setDraft] = useState('')

  async function run() {
    if (!currentUserId) {
      setState({
        status: 'abstained',
        result: { engine_invoked: false, automatic_send_allowed: false },
        reasons: ['Sign in required for offer negotiation assist.'],
      })
      return
    }
    setState({ status: 'loading' })
    try {
      const amount = Number(String(offer.amountDisplay || '').replace(/[^0-9.]/g, ''))
      const response = await fetchNegotiationAssistance({
        requesting_principal_fixture: currentUserId,
        principal_id: currentUserId,
        participant_side: role,
        authorized_thread_id: `offer:${offer.id}`,
        asking_price: Number.isFinite(amount) ? amount : undefined,
        subject: {
          listing_id: offer.listingId,
          title: offer.listingTitle || undefined,
          offer_id: offer.id,
        },
        thread: {
          thread_id: `offer:${offer.id}`,
          participant_principals: [offer.buyer, offer.seller].filter(Boolean),
        },
        messages: offer.message
          ? [
              {
                message_id: `offer-msg:${offer.id}`,
                sender_id: role === 'buyer' ? offer.buyer : offer.seller,
                body: offer.message,
                deletion_state: 'ACTIVE',
              },
            ]
          : [],
        offer_history: [
          {
            offer_id: offer.id,
            amount_display: offer.amountDisplay,
            status: offer.status,
            attempt_number: offer.attemptNumber ?? 1,
          },
        ],
        market_candidates: [],
        automatic_send_allowed: false,
        request_auto_send: false,
      })
      const envelope = response as Record<string, unknown>
      const diagnostics = (envelope.diagnostics || {}) as Record<string, unknown>
      const result = (envelope.result || response.result || {}) as Record<string, unknown>
      if (diagnostics.unauthorized_thread === true || diagnostics.engine_invoked === false) {
        setState({
          status: 'abstained',
          result: { ...result, engine_invoked: false, automatic_send_allowed: false },
          reasons: ['Unauthorized or incomplete offer context — engine_invoked=false.'],
        })
        setDraft('')
        return
      }
      setDraft(String(result.draft_reply || result.reply_draft || ''))
      setState({ status: 'ready', result: { ...result, automatic_send_allowed: false } })
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
        message: err instanceof Error ? err.message : 'Offer negotiation assist failed',
      })
    }
  }

  const result =
    state.status === 'ready' || state.status === 'abstained' ? state.result : null

  return (
    <IntelligencePanelShell
      title="Offer negotiation assist"
      description="Advisory only for this offer. Never auto-accepts, counters, or sends."
      testId={`intelligence-offer-negotiation-${offer.id}`}
      loading={state.status === 'loading'}
      errorMessage={state.status === 'error' ? state.message : null}
      rateLimited={state.status === 'error' ? state.rateLimited : false}
      abstained={state.status === 'abstained'}
      abstentionReasons={state.status === 'abstained' ? state.reasons : undefined}
      limitations={(result?.limitations as never) || []}
      evidence={(result?.evidence as never) || []}
      freshnessLabel="automatic_send_allowed=false; offer_actions_require_explicit_user_click"
    >
      <div className="space-y-2 text-sm">
        <button
          type="button"
          onClick={() => void run()}
          className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white"
          data-testid="intelligence-offer-negotiation-run"
        >
          Analyze offer
        </button>
        {state.status === 'ready' ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
              AI-generated draft — editable, not submitted
            </p>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-950"
              aria-label="AI-generated offer draft"
              data-testid="intelligence-offer-negotiation-draft"
            />
            <p className="text-[11px] text-slate-500">
              Accept / counter / withdraw remain separate explicit actions on the offer controls.
            </p>
          </div>
        ) : null}
      </div>
    </IntelligencePanelShell>
  )
}
