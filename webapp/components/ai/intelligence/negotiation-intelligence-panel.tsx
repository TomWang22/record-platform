'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

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
  correction_change?: {
    what_changed?: string[]
    previous_result?: string | null
    updated_result?: string
    reason_for_update?: string
  } | null
  [key: string]: unknown
}

type NegotiationTurnRecord = {
  turn_index: number
  turn_id: string
  intent: string
  summary: string
  result_hash: string
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

function newId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function hashSummary(text: string): string {
  let h = 0
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) >>> 0
  return `h${h.toString(16)}`
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
  const [sessionId] = useState(() => newId('nego-session'))
  const [turnHistory, setTurnHistory] = useState<NegotiationTurnRecord[]>([])

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

    const turnIndex = turnHistory.length
    const turnId = newId(`turn-${turnIndex + 1}`)
    const priorContext = turnHistory.map((t) => ({
      turn_index: t.turn_index,
      turn_id: t.turn_id,
      intent: t.intent,
      summary: t.summary,
    }))

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
        session_id: sessionId,
        turn_id: turnId,
        turn_index: turnIndex,
        prior_turns: priorContext,
        correction_precedence: priorContext.length > 0,
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
      const summary = String(result.summary || result.strategy || draftText || 'completed').trim()
      setTurnHistory((prev) => [
        ...prev,
        {
          turn_index: turnIndex,
          turn_id: turnId,
          intent: userIntent.trim(),
          summary,
          result_hash: hashSummary(`${turnId}:${summary}:${draftText}`),
        },
      ])
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
  }, [askingPrice, currentUserId, sessionId, thread, threadId, turnHistory, userIntent])

  useEffect(() => {
    setState({ status: 'idle' })
    setDraft('')
    setEngineInvoked(null)
    setTurnHistory([])
    setUserIntent(DEFAULT_INTENT)
  }, [threadId])

  const result =
    state.status === 'ready' || state.status === 'abstained' ? state.result : null

  const sessionLabel = useMemo(() => `session ${sessionId.slice(-8)}`, [sessionId])

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
            ? `Analysis completed · ${sessionLabel} · drafts are never sent automatically`
            : 'Analysis was not run for this thread'
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-[11px] text-slate-500" data-testid="intelligence-negotiation-session-id">
          Stable session: {sessionId} · turns completed: {turnHistory.length}
        </p>
        {turnHistory.length > 0 ? (
          <ol
            className="space-y-1 rounded-md border border-slate-200 p-2 text-xs dark:border-white/10"
            data-testid="intelligence-negotiation-turn-history"
          >
            {turnHistory.map((t) => (
              <li key={t.turn_id} data-testid={`intelligence-negotiation-prior-turn-${t.turn_index + 1}`}>
                <strong>Turn {t.turn_index + 1}:</strong> {t.intent}
                <span className="block text-slate-500">{t.summary}</span>
              </li>
            ))}
          </ol>
        ) : null}
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
          onClick={() => {
            if (typeof window !== 'undefined') {
              const w = window as Window & {
                __OWNER_PROOF_HANDLER_REACHED__?: {
                  capability: string
                  runTestId: string
                  at: number
                }
              }
              w.__OWNER_PROOF_HANDLER_REACHED__ = {
                capability: 'negotiation_assistance',
                runTestId: 'intelligence-negotiation-run',
                at: Date.now(),
              }
            }
            void run()
          }}
          disabled={!threadId}
          className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          data-testid="intelligence-negotiation-run"
          data-owner-proof-action="1"
        >
          Analyze thread
        </button>

        {state.status === 'ready' && result ? (
          <div className="space-y-2" data-testid="intelligence-negotiation-ready">
            <div data-testid="intelligence-result-question">
              <p className="text-xs font-medium text-slate-500">Question</p>
              <p data-testid="intelligence-negotiation-intent-echo">{userIntent}</p>
            </div>
            <div data-testid="intelligence-result-answer">
              <p className="text-xs font-medium text-slate-500">Answer</p>
              <p data-testid="intelligence-negotiation-summary">
                {String(result.summary || result.strategy || '')}
              </p>
            </div>
            {result.correction_change ? (
              <div
                className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs dark:border-amber-900 dark:bg-amber-950/40"
                data-testid="intelligence-negotiation-correction"
              >
                <p className="font-medium">What changed</p>
                <p>Previous: {String(result.correction_change.previous_result || '—')}</p>
                <p>Updated: {String(result.correction_change.updated_result || '—')}</p>
                <p>Reason: {String(result.correction_change.reason_for_update || '—')}</p>
              </div>
            ) : null}
            <div data-testid="intelligence-result-key-values" className="space-y-2">
              <p className="text-xs font-medium text-slate-500">Key values</p>
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
                <ul className="list-disc pl-4" data-testid="intelligence-negotiation-risks">
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
            </div>

            <div data-testid="intelligence-result-next-action">
              <p className="mb-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                Suggested next action — editable draft (not sent)
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
                <button
                  type="button"
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs opacity-60 dark:border-white/20"
                  data-testid="intelligence-negotiation-send-separate"
                  disabled
                  title="Send remains a separate messaging action"
                >
                  Send (separate action)
                </button>
              </div>
              <p
                className="mt-1 text-[11px] text-slate-500"
                data-testid="intelligence-negotiation-send-guards"
              >
                message_sent=false · automatic_send_allowed=false · Sending requires your separate Send
                action.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </IntelligencePanelShell>
  )
}
