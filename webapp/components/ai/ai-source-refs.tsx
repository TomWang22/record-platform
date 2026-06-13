import type { AiSourceRef } from '@/lib/ai-insights-types'

type AiSourceRefsListProps = {
  refs: AiSourceRef[]
  testId?: string
}

export function AiSourceRefsList({ refs, testId }: AiSourceRefsListProps) {
  if (!refs.length) {
    return <p className="text-xs text-slate-400">No source references.</p>
  }

  return (
    <ul className="space-y-1" data-testid={testId ?? 'ai-source-refs-list'}>
      {refs.slice(0, 8).map((ref, idx) => (
        <li
          key={`${ref.source_type}-${ref.source_id}-${idx}`}
          className="font-mono text-[11px] text-slate-600 dark:text-slate-300"
          data-testid="ai-source-ref-item"
        >
          {ref.source_type}:{ref.source_id.slice(0, 8)}…
          {ref.field ? ` · ${ref.field}` : ''}
        </li>
      ))}
      {refs.length > 8 && (
        <li className="text-[11px] text-slate-400">+{refs.length - 8} more sources</li>
      )}
    </ul>
  )
}
