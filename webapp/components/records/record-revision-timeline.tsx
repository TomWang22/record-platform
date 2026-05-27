'use client'

import {
  displayRevisionValue,
  formatDate,
  revisionFieldLabel,
} from '@/lib/records-format'
import type { RecordRevision } from '@/lib/records-types'

function normalizeChangedFields(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw) as unknown
      if (Array.isArray(p)) return p.map(String)
    } catch {
      return [raw]
    }
  }
  return []
}

type Props = {
  revisions: RecordRevision[]
}

export function RecordRevisionTimeline({ revisions }: Props) {
  if (!revisions.length) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        No revision history yet. Edits to this record will appear here.
      </p>
    )
  }

  const sorted = [...revisions].sort(
    (a, b) => b.revisionNumber - a.revisionNumber,
  )

  return (
    <ol className="relative space-y-6 border-l border-slate-200 pl-6 dark:border-white/10">
      {sorted.map((rev) => {
        const fields = normalizeChangedFields(rev.changedFields)
        const prev = (rev.previousValues ?? {}) as Record<string, unknown>
        const next = (rev.newValues ?? {}) as Record<string, unknown>

        return (
          <li key={rev.id} className="relative">
            <span className="absolute -left-[1.55rem] top-1 flex h-3 w-3 rounded-full border-2 border-brand bg-white dark:bg-slate-950" />
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 dark:border-white/10 dark:bg-slate-900/50">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-slate-900 dark:text-white">
                  Revision {rev.revisionNumber}
                </p>
                <time className="text-xs text-slate-500" dateTime={rev.createdAt}>
                  {formatDate(rev.createdAt)}
                </time>
              </div>

              {fields.length > 0 ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[320px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-white/10">
                        <th className="py-2 pr-3 font-medium">Field</th>
                        <th className="py-2 pr-3 font-medium">Previous</th>
                        <th className="py-2 font-medium">New</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fields.map((field) => (
                        <tr
                          key={field}
                          className="border-b border-slate-100 last:border-0 dark:border-white/5"
                        >
                          <td className="py-2 pr-3 font-medium text-slate-700 dark:text-slate-200">
                            {revisionFieldLabel(field)}
                          </td>
                          <td className="py-2 pr-3 text-slate-500 line-through decoration-slate-300">
                            {displayRevisionValue(prev[field])}
                          </td>
                          <td className="py-2 text-slate-900 dark:text-white">
                            {displayRevisionValue(next[field])}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-500">Record created or updated.</p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
