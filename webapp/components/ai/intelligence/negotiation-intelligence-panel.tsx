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

const DEFAULT_INTENT = 'They offered $35 for my $41 listing. What should I do?'

const TURN_INTENTS = [
  'They offered $35 for my $41 listing. What should I do?',
  'The sleeve has a seam split, and shipping will cost me $6.',
  'I would accept $37, but I do not want to sound desperate.',
  'Draft the reply.',
] as const

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
  if (thread.listing?.id) return 'buyer'
  return 'unknown'
}

function activeMessages(messages: MessagingThreadMessage[]): MessagingThreadMessage[] {
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
  const [userIntent, setUserIntent] = useState(DEFAULT_INTENT)
  const [engineInvoked, setEngineInvoked] = useState<boolean | null>(null)

  const run = useCallback(async () => {
    if (!threadId || !thread || !currentUserId) {
      setState({
        status: 'abstained',
        result: { automatic_send_allowed: false, engine_invoked: false },
        reasons: ['Select an authorized message thread before asking for negotiation help.'],
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
        user_intent: userIntent.trim(),
        owner_proof_prompt: userIntent.trim(),
      })

      const envelope = response as Record<string, unknown>
      const diagnostics = (envelope.diagnostics || {}) as Record<string, unknown>
      const result = (envelope.result || response.result || {}) as NegotiationResult
      const invoked = diagnostics.engine_invoked !== false && diagnostics.unauthorized_thread !== true
      setEngineInvoked(Boolean(diagnostics.engine_invoked ?? invoked))

      if (diagnostics.unauthorized_thread === true || diagnostics.engine_invoked === false) {
        setState({
          status: 'abstained',
          result: { ...result, automatic_send_allowed: false, engine_invoked: false },
          reasons: [
            ...limitationMessages(result.limitations),
            'This thread is not authorized for negotiation assistance, so no draft was generated.',
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
  }, [askingPrice, currentUserId, thread, threadId, userIntent])

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
      capability="negotiation_assistance"
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
          : engineInvoked
            ? 'Analysis completed · drafts are never sent automatically'
            : 'Analysis was not run for this thread'
      }
    >
      <div className="space-y-3 text-sm">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-slate-500">Your question</span>
          <textarea
            value={userIntent}
            onChange={(e) => setUserIntent(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-950"
            data-testid="intelligence-negotiation-user-intent"
            aria-label="Negotiation question"
          />
        </label>
        <div className="flex flex-wrap gap-1" data-testid="intelligence-negotiation-turn-presets">
          {TURN_INTENTS.map((intent, idx) => (
            <button
              key={intent}
              type="button"
              className="rounded border border-slate-200 px-2 py-0.5 text-[10px] dark:border-white/10"
              data-testid={`intelligence-negotiation-turn-preset-${idx + 1}`}
              onClick={() => setUserIntent(intent)}
            >
              Turn {idx + 1}
            </button>
          ))}
        </div>
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
            <p className="text-xs text-slate-500" data-testid="intelligence-negotiation-intent-echo">
              Answering: {userIntent}
            </p>
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
                <p data-testid="intelligence-negotiation-strategy">{result.strategy}</p>
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
                  Insert into composer (does not send)
                </button>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                Sending requires your separate Send action. Drafts are never sent automatically.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </IntelligencePanelShell>
  )
}
