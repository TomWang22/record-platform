'use client'

import { useState } from 'react'
import type {
  IntelligenceConfidence,
  IntelligenceEvidenceItem,
  IntelligenceLimitation,
} from '@/lib/ai-intelligence-types'
import { confidenceScore } from '@/lib/ai-intelligence-types'
import {
  evidenceCountLabel,
  limitationCustomerMessage,
  sanitizeCustomerFacingText,
} from '@/lib/ai-customer-copy'

/**
 * Capability-aware abstention headline. `valuation` must never use
 * scarcity/rarity wording — a valuation abstention is about not having
 * enough sold comparables, not about how rare the item is.
 */
function abstentionHeadlineForCapability(capability?: string): string {
  switch (capability) {
    case 'valuation':
      return 'Not enough sold comparables yet — we are holding back a price range.'
    case 'scarcity':
      return 'Not enough market evidence yet — we are holding back a scarcity claim.'
    default:
      return 'Not enough market evidence yet — we are holding back a confident claim.'
  }
}

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
  // Controlled open state so the disclosure's `open` attribute always agrees
  // with an explicit `aria-expanded` string the visual-evidence harness can
  // poll — native `<details>` alone only exposes a boolean `open` attribute,
  // which is easy to read inconsistently across capture tooling.
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [limitationsOpen, setLimitationsOpen] = useState(false)
  const score = confidenceScore(confidence ?? undefined)
  const evidenceCount = evidence?.length ?? 0
  const evidenceSummary = evidenceCountLabel(evidenceCount)
  const safeAbstentionReasons = (abstentionReasons?.length
    ? abstentionReasons
    : ['We do not have enough marketplace evidence to support a confident claim.']
  ).map((reason) => sanitizeCustomerFacingText(reason))
  const safeFreshness = freshnessLabel ? sanitizeCustomerFacingText(freshnessLabel) : null
  const safeError = errorMessage ? sanitizeCustomerFacingText(errorMessage) : null
  const abstentionHeadline = abstentionHeadlineForCapability(capability)

  return (
    <section
      className="min-h-[140px] min-w-0 max-w-full overflow-hidden rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900"
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

      {!loading && safeError && !rateLimited ? (
        <p className="text-sm text-rose-600 dark:text-rose-400" data-testid={`${testId}-error`}>
          {safeError}
        </p>
      ) : null}

      {!loading && !safeError && !rateLimited && abstained ? (
        <div
          className="space-y-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
          data-testid={`${testId}-abstention`}
          role="status"
        >
          <p className="font-medium">{abstentionHeadline}</p>
          {safeAbstentionReasons.map((reason) => (
            <p key={reason} className="text-xs opacity-90">
              {reason}
            </p>
          ))}
        </div>
      ) : null}

      {!loading && !safeError && !rateLimited && !abstained ? children : null}

      {!loading && !safeError && !rateLimited ? (
        <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <div>
            <dt className="inline">Confidence: </dt>
            <dd className="inline" data-testid={`${testId}-confidence`}>
              {score == null ? '—' : `${Math.round(score * 100)}%`}
            </dd>
          </div>
          <div className="min-w-0 max-w-full">
            <dt className="inline">Supporting evidence: </dt>
            <dd className="inline" data-testid={`${testId}-evidence-count`}>
              {evidenceSummary}
            </dd>
          </div>
          {safeFreshness ? (
            <div className="min-w-0 max-w-full">
              <dt className="inline">Freshness: </dt>
              <dd className="inline break-words" data-testid={`${testId}-freshness`}>
                {safeFreshness}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {!loading && limitations && limitations.length > 0 ? (
        <details
          className="mt-2 text-xs text-slate-600 dark:text-slate-300"
          data-testid={`${testId}-limitations`}
          open={limitationsOpen}
          // Always emit the string form — React omits boolean false attributes,
          // which makes harness polls see `null` instead of `"false"`.
          aria-expanded={limitationsOpen ? 'true' : 'false'}
        >
          <summary
            className="cursor-pointer font-medium"
            onClick={(event) => {
              event.preventDefault()
              setLimitationsOpen((open) => !open)
            }}
          >
            What this means for you
          </summary>
          <ul
            className="mt-1 list-disc space-y-1 pl-4"
            data-testid={`${testId}-limitations-content`}
            hidden={!limitationsOpen}
          >
            {limitations.map((l) => (
              <li key={`${l.code}-${l.message}`}>{limitationCustomerMessage(l)}</li>
            ))}
          </ul>
          <details className="mt-2" data-testid={`${testId}-limitations-developer`}>
            <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-slate-400">
              Developer details
            </summary>
            <ul className="mt-1 list-disc space-y-1 pl-4 font-mono text-[10px] text-slate-400">
              {limitations.map((l) => (
                <li key={`dev-${l.code}-${l.message}`}>
                  {l.code}
                  {l.message ? ` — ${l.message}` : ''}
                </li>
              ))}
            </ul>
          </details>
        </details>
      ) : null}

      {!loading && evidence && evidence.length > 0 ? (
        <details
          className="mt-2 text-xs text-slate-600 dark:text-slate-300"
          data-testid={`${testId}-evidence`}
          open={evidenceOpen}
          aria-expanded={evidenceOpen ? 'true' : 'false'}
        >
          <summary
            className="cursor-pointer font-medium"
            onClick={(event) => {
              event.preventDefault()
              setEvidenceOpen((open) => !open)
            }}
          >
            Evidence
          </summary>
          <ul
            className="mt-1 space-y-2"
            data-testid={`${testId}-evidence-content`}
            hidden={!evidenceOpen}
          >
            {evidence.map((item, idx) => (
              <li
                key={String(item.evidence_id || item.source_id || idx)}
                className="rounded border border-slate-100 p-2 dark:border-slate-800"
              >
                <p>{sanitizeCustomerFacingText(item.summary || item.source_type || 'Evidence item')}</p>
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
