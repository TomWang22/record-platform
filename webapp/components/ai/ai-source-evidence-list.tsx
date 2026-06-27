'use client'

import { useState } from 'react'

import {
  excerptPreview,
  formatFreshness,
  resolveExcerptsForRefs,
} from '@/lib/ai-source-evidence'
import type { AiSourceRef } from '@/lib/ai-insights-types'

type AiSourceEvidenceListProps = {
  refs: AiSourceRef[]
  excerpts?: unknown[]
  testId?: string
  itemTestId?: string
  excerptTestId?: string
  showPrivacyLabel?: boolean
}

export function AiSourceEvidenceList({
  refs,
  excerpts,
  testId,
  itemTestId,
  excerptTestId,
  showPrivacyLabel = true,
}: AiSourceEvidenceListProps) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
  const items = resolveExcerptsForRefs(refs, excerpts)

  if (!items.length) {
    return <p className="text-xs text-slate-400">No source references.</p>
  }

  const toggle = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="space-y-2" data-testid={testId ?? 'ai-source-evidence-list'}>
      {showPrivacyLabel && (
        <p className="text-xs text-slate-500">Private message bodies are not shown.</p>
      )}
      <ul className="space-y-2">
        {items.map(({ ref, excerpt }, idx) => {
          const key = `${ref.source_type}-${ref.source_id}-${idx}`
          const expanded = expandedKeys.has(key)
          const freshness = formatFreshness(ref)
          const preview = excerpt ? excerptPreview(excerpt) : null
          const collapsedLabel = [
            `${ref.source_type}:${ref.source_id.slice(0, 8)}…`,
            freshness,
            preview ?? 'Source excerpt unavailable',
          ]
            .filter(Boolean)
            .join(' · ')

          return (
            <li
              key={key}
              className="rounded-lg border border-slate-200/80 bg-slate-50/80 p-2 dark:border-white/10 dark:bg-slate-950/40"
              data-testid={itemTestId ?? 'ai-source-evidence-item'}
            >
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-brand hover:bg-brand/10"
                  aria-expanded={expanded}
                  data-testid="ai-source-evidence-toggle"
                  onClick={() => toggle(key)}
                >
                  {expanded ? 'Collapse' : 'Expand'}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                    {collapsedLabel}
                    {ref.field ? ` · ${ref.field}` : ''}
                  </p>
                  {expanded && (
                    <div className="mt-2">
                      {excerpt ? (
                        <pre
                          className="whitespace-pre-wrap break-words font-sans text-xs text-slate-700 dark:text-slate-200"
                          data-testid={excerptTestId ?? 'ai-source-evidence-excerpt'}
                        >
                          {excerpt}
                        </pre>
                      ) : (
                        <p
                          className="text-xs text-slate-400"
                          data-testid="ai-source-evidence-unavailable"
                        >
                          Source excerpt unavailable
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </li>
          )
        })}
        {refs.length > items.length && (
          <li className="text-[11px] text-slate-400">+{refs.length - items.length} more sources</li>
        )}
      </ul>
    </div>
  )
}
