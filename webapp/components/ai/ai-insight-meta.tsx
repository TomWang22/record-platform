import type { AiEnvelope } from '@/lib/ai-insights-types'

type AiInsightMetaProps = {
  envelope: AiEnvelope | null
  sourceCount?: number
  testId?: string
}

export function AiInsightMeta({ envelope, sourceCount, testId }: AiInsightMetaProps) {
  if (!envelope) {
    return (
      <div className="text-xs text-slate-400" data-testid={testId}>
        Awaiting live insight…
      </div>
    )
  }

  const refs = sourceCount ?? envelope.source_refs?.length ?? 0
  const confidence =
    typeof envelope.confidence === 'number' ? `${Math.round(envelope.confidence * 100)}%` : '—'
  const isDegraded = envelope.source_status === 'degraded'

  return (
    <div
      className="flex flex-wrap items-center gap-2 text-xs"
      data-testid={testId ?? `ai-insight-meta-${envelope.contract_id}`}
    >
      <span
        className={`rounded-full px-2 py-0.5 font-medium ${
          isDegraded
            ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
        }`}
        data-testid="ai-insight-source-status"
      >
        {envelope.source_status}
      </span>
      <span className="text-slate-500 dark:text-slate-400">
        model: <span data-testid="ai-insight-model-used">{envelope.model_used}</span>
      </span>
      <span className="text-slate-500 dark:text-slate-400">
        confidence: <span data-testid="ai-insight-confidence">{confidence}</span>
      </span>
      <span className="text-slate-500 dark:text-slate-400">
        sources: <span data-testid="ai-insight-source-count">{refs}</span>
      </span>
      {isDegraded && envelope.degraded_reason && (
        <span
          className="w-full text-amber-700 dark:text-amber-300"
          data-testid="ai-insight-degraded-reason"
        >
          Degraded: {envelope.degraded_reason}
        </span>
      )}
    </div>
  )
}
