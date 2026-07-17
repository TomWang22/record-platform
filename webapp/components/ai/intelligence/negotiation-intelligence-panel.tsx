'use client'

import { useCallback, useEffect, useState } from 'react'

import { IntelligencePanelShell } from '@/components/ai/intelligence/intelligence-panel-shell'
import {
  fetchNegotiationAssistance,
  IntelligenceHttpError,
} from '@/lib/ai-intelligence-client'
import {
  limitationMessages,
  type IntelligencePanelState,
} from '@/lib/ai-intelligence-types'
import type {
  MessagingThreadContract,
  MessagingThreadMessage,
} from '@/lib/messaging-product-api'

type NegotiationResult = {
  summary?: string
  counterpart_intent?: string
  leverage?: string[] | string
  risks?: string[] | string
  strategy?: string
  suggested_range?: { low?: number; high?: number } | string
  draft_reply?: string
  reply_draft?: string
  evidence?: Array<Record<string, unknown>>
  assumptions?: string[] | string
  limitations?: Array<{ code: string; message: string; severity?: string }>
  confidence?: number | { score?: number }
  automatic_send_allowed?: boolean
  engine_invoked?: boolean
  [key: string]: unknown
}

type NegotiationIntelligencePanelProps = {
  threadId: string | null
  thread: MessagingThreadContract | null
  currentUserId: string | null
  askingPrice?: number | null
  /** Insert draft into parent composer — never auto-sends. */
  onApplyDraft?: (draft: string) => void
}

function asLines(value: string[] | string | undefined): string[] {
  if (!value) return []
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  return String(value)
    .split(/\n|;/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function participantSide(
  thread: MessagingThreadContract | null,
  currentUserId: string | null,
): 'buyer' | 'seller' | 'unknown' {
  if (!thread || !currentUserId) return 'unknown'
  // Listing-attached threads: if current user is not listing owner semantics are
  // unknown without seller id — treat as buyer when listing context exists.
  if (thread.listing?.id) return 'buyer'
  return 'unknown'
}

function activeMessages(messages: MessagingThreadMessage[]): MessagingThreadMessage[] {
  // Deleted messages must have no influence — API already omits hard-deleted;
  // filter empty bodies defensively.
  return messages.filter((m) => Boolean(m.body?.trim()))
}

export function NegotiationIntelligencePanel({
  threadId,
  thread,
  currentUserId,
  askingPrice,
  onApplyDraft,
}: NegotiationIntelligencePanelProps) {
  const [state, setState] = useState<IntelligencePanelState<NegotiationResult>>({ status: 'idle' })
  const [draft, setDraft] = useState('')
  const [engineInvoked, setEngineInvoked] = useState<boolean | null>(null)

  const run = useCallback(async () => {
    if (!threadId || !thread || !currentUserId) {
      setState({
        status: 'abstained',
        result: { automatic_send_allowed: false, engine_invoked: false },
        reasons: ['No authorized thread selected.'],
      })
      setEngineInvoked(false)
      return
    }

    setState({ status: 'loading' })
    const side = participantSide(thread, currentUserId)
    const messages = activeMessages(thread.messages).map((m) => ({
      message_id: m.id,
      sender_id: m.senderId,
      body: m.body,
      created_at: m.createdAt,
      deletion_state: 'ACTIVE',
    }))
    const principals = (thread.participants || []).map((p) => p.id).filter(Boolean)
    if (!principals.includes(currentUserId)) {
      principals.push(currentUserId)
    }

    try {
      const response = await fetchNegotiationAssistance({
        requesting_principal_fixture: currentUserId,
        principal_id: currentUserId,
        participant_side: side === 'unknown' ? 'buyer' : side,
        authorized_thread_id: threadId,
        asking_price: askingPrice ?? undefined,
        subject: {
          listing_id: thread.listing?.id || undefined,
          title: thread.listing?.title || undefined,
        },
        thread: {
          thread_id: threadId,
          participant_principals: principals,
        },
        messages,
        market_candidates: [],
        automatic_send_allowed: false,
        request_auto_send: false,
      })

      const envelope = response as Record<string, unknown>
      const diagnostics = (envelope.diagnostics || {}) as Record<string, unknown>
      const result = ((envelope.result || response.result || {}) as NegotiationResult)
      const invoked = diagnostics.engine_invoked !== false && diagnostics.unauthorized_thread !== true
      setEngineInvoked(Boolean(diagnostics.engine_invoked ?? invoked))

      if (diagnostics.unauthorized_thread === true || diagnostics.engine_invoked === false) {
        setState({
          status: 'abstained',
          result: { ...result, automatic_send_allowed: false, engine_invoked: false },
          reasons: [
            ...limitationMessages(result.limitations),
            'Unauthorized or incomplete thread — engine_invoked=false.',
          ],
        })
        setDraft('')
        return
      }

      const draftText = String(result.draft_reply || result.reply_draft || '').trim()
      setDraft(draftText)
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
        message: err instanceof Error ? err.message : 'Negotiation assistance failed',
      })
    }
  }, [askingPrice, currentUserId, thread, threadId])

  useEffect(() => {
    setState({ status: 'idle' })
    setDraft('')
    setEngineInvoked(null)
  }, [threadId])

  const result =
    state.status === 'ready' || state.status === 'abstained' ? state.result : null

  return (
    <IntelligencePanelShell
      title="Negotiation assistance"
      description="Advisory only. Drafts are never auto-sent. You must copy/edit and send yourself."
      testId="intelligence-negotiation-panel"
      loading={state.status === 'loading'}
      errorMessage={state.status === 'error' ? state.message : null}
      rateLimited={state.status === 'error' ? state.rateLimited : false}
      abstained={state.status === 'abstained'}
      abstentionReasons={state.status === 'abstained' ? state.reasons : undefined}
      confidence={result?.confidence}
      limitations={result?.limitations}
      evidence={result?.evidence as never}
      freshnessLabel={
        engineInvoked == null
          ? null
          : `engine_invoked=${String(engineInvoked)}; automatic_send_allowed=false`
      }
    >
      <div className="space-y-3 text-sm">
        <button
          type="button"
          onClick={() => void run()}
          disabled={!threadId}
          className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          data-testid="intelligence-negotiation-run"
        >
          Analyze thread
        </button>

        {state.status === 'ready' && result ? (
          <div className="space-y-2" data-testid="intelligence-negotiation-ready">
            {result.summary ? (
              <div>
                <p className="text-xs font-medium text-slate-500">Summary</p>
                <p data-testid="intelligence-negotiation-summary">{result.summary}</p>
              </div>
            ) : null}
            {result.counterpart_intent ? (
              <div>
                <p className="text-xs font-medium text-slate-500">
                  Inferred counterpart intent (labeled inference)
                </p>
                <p data-testid="intelligence-negotiation-intent">{result.counterpart_intent}</p>
              </div>
            ) : null}
            {asLines(result.leverage).length > 0 ? (
              <div>
                <p className="text-xs font-medium text-slate-500">Evidence-backed leverage</p>
                <ul className="list-disc pl-4" data-testid="intelligence-negotiation-leverage">
                  {asLines(result.leverage).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {asLines(result.risks).length > 0 ? (
              <div>
                <p className="text-xs font-medium text-slate-500">Risks</p>
                <ul className="list-disc pl-4">
                  {asLines(result.risks).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {result.strategy ? (
              <div>
                <p className="text-xs font-medium text-slate-500">Strategy</p>
                <p>{result.strategy}</p>
              </div>
            ) : null}
            {result.suggested_range ? (
              <div>
                <p className="text-xs font-medium text-slate-500">Suggested range</p>
                <p data-testid="intelligence-negotiation-range">
                  {typeof result.suggested_range === 'string'
                    ? result.suggested_range
                    : `${result.suggested_range.low ?? '—'}–${result.suggested_range.high ?? '—'}`}
                </p>
              </div>
            ) : null}

            <div>
              <p className="mb-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                AI-generated draft — editable, not sent
              </p>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={4}
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-950"
                data-testid="intelligence-negotiation-draft"
                aria-label="AI-generated draft reply"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-white/10"
                  data-testid="intelligence-negotiation-apply-draft"
                  onClick={() => {
                    if (onApplyDraft && draft.trim()) onApplyDraft(draft.trim())
                  }}
                  disabled={!draft.trim() || !onApplyDraft}
                >
                  Insert draft into composer (does not send)
                </button>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                Sending requires your separate Send action. automatic_send_allowed=false.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </IntelligencePanelShell>
  )
}
