'use client'

import {
  containsForbiddenEvidence,
  sanitizeEvidenceExcerpt,
} from '@/lib/ai-source-evidence'

export type CollectorFieldEntry = {
  field: string
  status: string
  value?: string
  evidence?: string
  confidence?: string
}

function asStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map((v) => String(v)).filter(Boolean)
}

function parseFieldMap(raw: unknown): CollectorFieldEntry[] {
  if (!Array.isArray(raw)) return []
  const out: CollectorFieldEntry[] = []
  for (const item of raw) {
    if (item == null || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const field = String(row.field ?? '').trim()
    if (!field) continue
    const value =
      row.value != null ? sanitizeEvidenceExcerpt(row.value) ?? undefined : undefined
    const evidence =
      row.evidence != null ? sanitizeEvidenceExcerpt(row.evidence) ?? undefined : undefined
    const blob = `${field} ${value ?? ''} ${evidence ?? ''}`
    if (containsForbiddenEvidence(blob)) continue
    out.push({
      field,
      status: String(row.status ?? 'unknown'),
      value,
      evidence,
      confidence: row.confidence != null ? String(row.confidence) : undefined,
    })
  }
  return out
}

type CollectorMetadataFieldMapProps = {
  details: Record<string, unknown>
}

export function CollectorMetadataFieldMap({ details }: CollectorMetadataFieldMapProps) {
  const fieldMap = parseFieldMap(details.field_map)
  const completeness =
    typeof details.completeness_score === 'number'
      ? details.completeness_score
      : Number(details.completeness_score) || null
  const presentFields = asStringList(details.present_fields)
  const missingFields = asStringList(details.missing_fields)
  const highPriority = asStringList(details.high_priority_missing)
  const recommended = asStringList(
    details.recommended_listing_edits ?? details.recommended_edits,
  )

  if (!fieldMap.length && completeness == null) {
    return null
  }

  return (
    <div className="space-y-3 border-t border-slate-200/80 pt-3 dark:border-white/10">
      {completeness != null && (
        <p
          className="text-xs font-medium text-slate-600 dark:text-slate-300"
          data-testid="collector-metadata-completeness-score"
        >
          Completeness score: {completeness}/100
        </p>
      )}

      {presentFields.length > 0 && (
        <p className="text-xs text-slate-600 dark:text-slate-300">
          Present: {presentFields.join(', ')}
        </p>
      )}

      {missingFields.length > 0 && (
        <p className="text-xs text-slate-600 dark:text-slate-300">
          Missing or unclear: {missingFields.join(', ')}
        </p>
      )}

      {highPriority.length > 0 && (
        <p
          className="text-xs text-amber-800 dark:text-amber-200"
          data-testid="collector-metadata-high-priority-missing"
        >
          High-priority missing: {highPriority.join(', ')}
        </p>
      )}

      {recommended.length > 0 && (
        <ul
          className="list-inside list-disc space-y-1 text-xs text-slate-600 dark:text-slate-300"
          data-testid="collector-metadata-recommended-edits"
        >
          {recommended.map((edit) => (
            <li key={edit}>{edit}</li>
          ))}
        </ul>
      )}

      {fieldMap.length > 0 && (
        <div
          className="overflow-x-auto rounded-lg border border-slate-200/80 dark:border-white/10"
          data-testid="collector-metadata-field-map"
        >
          <table className="min-w-full text-left text-[11px]">
            <thead className="bg-slate-50/80 text-slate-500 dark:bg-slate-900/60">
              <tr>
                <th className="px-2 py-1.5 font-medium">Field</th>
                <th className="px-2 py-1.5 font-medium">Status</th>
                <th className="px-2 py-1.5 font-medium">Value</th>
                <th className="px-2 py-1.5 font-medium">Confidence</th>
                <th className="px-2 py-1.5 font-medium">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {fieldMap.map((row) => (
                <tr
                  key={row.field}
                  className="border-t border-slate-100 dark:border-white/5"
                  data-testid="collector-metadata-field-row"
                >
                  <td className="px-2 py-1.5 font-mono text-slate-700 dark:text-slate-200">
                    {row.field}
                  </td>
                  <td className="px-2 py-1.5 text-slate-600 dark:text-slate-300">{row.status}</td>
                  <td className="max-w-[8rem] truncate px-2 py-1.5 text-slate-600 dark:text-slate-300">
                    {row.value ?? '—'}
                  </td>
                  <td className="px-2 py-1.5 text-slate-500">{row.confidence ?? '—'}</td>
                  <td className="max-w-[12rem] truncate px-2 py-1.5 text-slate-500">
                    {row.evidence ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
