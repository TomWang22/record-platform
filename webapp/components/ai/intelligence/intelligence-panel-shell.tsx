'use client'

import type {
  IntelligenceConfidence,
  IntelligenceEvidenceItem,
  IntelligenceLimitation,
} from '@/lib/ai-intelligence-types'
import { confidenceScore } from '@/lib/ai-intelligence-types'

type IntelligencePanelShellProps = {
  title: string
  description?: string
  testId: string
  /** Canonical capability id for harness identity checks (e.g. valuation). */
  capability?: string
  loading?: boolean
  errorMessage?: string | null
  rateLimited?: boolean
  abstained?: boolean
  abstentionReasons?: string[]
  confidence?: IntelligenceConfidence | null
  limitations?: IntelligenceLimitation[]
  evidence?: IntelligenceEvidenceItem[]
  freshnessLabel?: string | null
  children?: React.ReactNode
}

export function IntelligencePanelShell({
  title,
  description,
  testId,
  capability,
  loading,
  errorMessage,
  rateLimited,
  abstained,
  abstentionReasons,
  confidence,
  limitations,
  evidence,
  freshnessLabel,
  children,
}: IntelligencePanelShellProps) {
  const score = confidenceScore(confidence ?? undefined)
  const evidenceCount = evidence?.length ?? 0

  return (
    <section
      className="min-w-0 max-w-full overflow-hidden rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900"
      data-testid={testId}
      data-capability={capability || undefined}
      aria-busy={loading ? true : undefined}
    >
      <header className="mb-3 space-y-1">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
        {description ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">{description}</p>
        ) : null}
      </header>

      {loading ? (
        <div
          className="animate-pulse space-y-2"
          data-testid={`${testId}-loading`}
          aria-label="Loading intelligence"
        >
          <div className="h-3 w-2/3 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-3 w-1/2 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-16 rounded bg-slate-100 dark:bg-slate-800" />
        </div>
      ) : null}

      {!loading && rateLimited ? (
        <p className="text-sm text-amber-700 dark:text-amber-300" data-testid={`${testId}-rate-limited`}>
          Rate limited. Wait and try again — this panel does not auto-retry HTTP 429.
        </p>
      ) : null}

      {!loading && errorMessage && !rateLimited ? (
        <p className="text-sm text-rose-600 dark:text-rose-400" data-testid={`${testId}-error`}>
          {errorMessage}
        </p>
      ) : null}

      {!loading && !errorMessage && !rateLimited && abstained ? (
        <div
          className="space-y-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
          data-testid={`${testId}-abstention`}
          role="status"
        >
          <p className="font-medium">Insufficient market evidence — abstaining from a scarcity/rarity claim.</p>
          {(abstentionReasons?.length ? abstentionReasons : ['Weak or missing sold/auction evidence.']).map(
            (reason) => (
              <p key={reason} className="text-xs opacity-90">
                {reason}
              </p>
            ),
          )}
        </div>
      ) : null}

      {!loading && !errorMessage && !rateLimited && !abstained ? children : null}

      {!loading && !errorMessage && !rateLimited ? (
        <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <div>
            <dt className="inline">Confidence: </dt>
            <dd className="inline" data-testid={`${testId}-confidence`}>
              {score == null ? '—' : `${Math.round(score * 100)}%`}
            </dd>
          </div>
          <div>
            <dt className="inline">Evidence: </dt>
            <dd className="inline" data-testid={`${testId}-evidence-count`}>
              {evidenceCount}
            </dd>
          </div>
          {freshnessLabel ? (
            <div className="min-w-0 max-w-full">
              <dt className="inline">Freshness: </dt>
              <dd className="inline break-all" data-testid={`${testId}-freshness`}>
                {freshnessLabel}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {!loading && limitations && limitations.length > 0 ? (
        <details className="mt-2 text-xs text-slate-600 dark:text-slate-300" data-testid={`${testId}-limitations`}>
          <summary className="cursor-pointer font-medium">Limitations</summary>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {limitations.map((l) => (
              <li key={`${l.code}-${l.message}`}>
                <span className="font-mono text-[10px] uppercase tracking-wide text-slate-400">{l.code}</span>{' '}
                {l.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {!loading && evidence && evidence.length > 0 ? (
        <details className="mt-2 text-xs text-slate-600 dark:text-slate-300" data-testid={`${testId}-evidence`}>
          <summary className="cursor-pointer font-medium">Evidence</summary>
          <ul className="mt-1 space-y-2">
            {evidence.map((item, idx) => (
              <li
                key={String(item.evidence_id || item.source_id || idx)}
                className="rounded border border-slate-100 p-2 dark:border-slate-800"
              >
                <p>{item.summary || item.source_type || 'Evidence item'}</p>
                <p className="text-[10px] text-slate-400">
                  {[item.source_type, item.authorization_scope, item.deletion_state]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}
