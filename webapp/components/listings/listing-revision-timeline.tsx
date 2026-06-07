'use client'

import { formatRevisionDate } from '@/lib/listing-revision-format'
import { humanReadableRevisionLines, isBadRevisionLine } from '@/lib/listing-revision-format'
import type { ListingRevision } from '@/lib/listings-types'

type PublicRevision = {
  id: string
  created_at: string
  editor_display?: string
  lines?: string[]
}

type Props = {
  revisions: ListingRevision[]
  publicItems?: PublicRevision[]
}

export function ListingRevisionTimeline({ revisions, publicItems }: Props) {
  if (publicItems?.length) {
    return (
      <ol
        className="relative space-y-6 border-l border-slate-200 pl-6 dark:border-white/10"
        data-testid="listing-revisions-timeline"
      >
        {publicItems.map((item, idx) => (
          <li key={item.id} className="relative">
            <span className="absolute -left-[1.55rem] top-1 flex h-3 w-3 rounded-full border-2 border-brand bg-white dark:bg-slate-950" />
            <div
              className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 dark:border-white/10 dark:bg-slate-900/50"
              data-testid="listing-revision-card"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <p className="font-semibold text-slate-900 dark:text-white">
                  Revision {publicItems.length - idx}
                </p>
                <time className="text-xs text-slate-500" dateTime={item.created_at}>
                  {formatRevisionDate(item.created_at)}
                </time>
              </div>
              <p className="mt-1 text-xs text-slate-500">{item.editor_display}</p>
              <ul className="mt-2 space-y-1 text-sm text-slate-700 dark:text-slate-200">
                {(item.lines ?? ['Listing updated'])
                  .filter((line) => !isBadRevisionLine(line))
                  .map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>
    )
  }

  if (!revisions.length) {
    return (
      <p
        className="text-sm text-slate-500 dark:text-slate-400"
        data-testid="listing-revisions-empty"
      >
        No revisions yet. Edits to this listing will appear here.
      </p>
    )
  }

  const sorted = [...revisions].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )

  return (
    <ol
      className="relative space-y-6 border-l border-slate-200 pl-6 dark:border-white/10"
      data-testid="listing-revisions-timeline"
    >
      {sorted.map((rev, idx) => {
        const rawLines = humanReadableRevisionLines(rev)
        const lines = rawLines.length ? rawLines : ['Listing updated']
        return (
          <li key={rev.id} className="relative">
            <span className="absolute -left-[1.55rem] top-1 flex h-3 w-3 rounded-full border-2 border-brand bg-white dark:bg-slate-950" />
            <div
              className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 dark:border-white/10 dark:bg-slate-900/50"
              data-testid="listing-revision-card"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <p className="font-semibold text-slate-900 dark:text-white">
                  Revision {sorted.length - idx}
                </p>
                <time className="text-xs text-slate-500" dateTime={rev.created_at}>
                  {formatRevisionDate(rev.created_at)}
                </time>
              </div>
              {rev.editor_user_id && (
                <p className="mt-1 text-xs text-slate-500">
                  Changed by {rev.editor_user_id.slice(0, 8)}…
                </p>
              )}
              <ul
                className="mt-3 list-none space-y-1 text-sm text-slate-700 dark:text-slate-200"
                data-testid="listing-revision-lines"
              >
                {lines.map((line, i) => (
                  <li key={`${rev.id}-${i}`}>
                    {line.split('\n').map((part, j) => (
                      <span key={j} className="block">
                        {part}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
