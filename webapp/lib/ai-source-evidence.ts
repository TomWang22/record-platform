import type { AiSourceRef } from '@/lib/ai-insights-types'

const FORBIDDEN_FIELD = /message_body|thread_text|private obo message|proxy_bids|max_bid_cents/i

const FORBIDDEN_CONTENT = /message_body|thread_text|private obo message|proxy_bids|max_bid_cents/i

export function isForbiddenEvidenceText(text: string): boolean {
  return FORBIDDEN_CONTENT.test(text)
}

export function sanitizeEvidenceExcerpt(raw: unknown): string | null {
  if (raw == null) return null
  if (typeof raw === 'object') return null
  const text = String(raw).trim()
  if (!text) return null
  if (isForbiddenEvidenceText(text)) return null
  return text.replace(/\s+/g, ' ')
}

export function excerptPreview(text: string, maxLen = 72): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= maxLen) return flat
  return `${flat.slice(0, maxLen)}…`
}

export function formatFreshness(ref: AiSourceRef): string | null {
  const f = ref.freshness?.trim()
  if (!f) return null
  if (f.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(f)) return f.slice(0, 10)
  return f.length > 24 ? `${f.slice(0, 24)}…` : f
}

export function resolveExcerptsForRefs(
  refs: AiSourceRef[],
  excerpts: unknown[] | undefined,
  maxItems = 8,
): Array<{ ref: AiSourceRef; excerpt: string | null }> {
  const slice = refs.slice(0, maxItems)
  return slice.map((ref, idx) => ({
    ref,
    excerpt: sanitizeEvidenceExcerpt(excerpts?.[idx]),
  }))
}

export function containsForbiddenEvidence(text: string): boolean {
  return FORBIDDEN_FIELD.test(text)
}
