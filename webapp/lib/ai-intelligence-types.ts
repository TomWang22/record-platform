/**
 * Phase 34 — typed Phase 33 intelligence API contracts (client).
 * These map to /api/ai/intelligence/* — not legacy /api/ai/records/* or RAG.
 */

export type IntelligenceEvidenceItem = {
  evidence_id?: string
  source_type?: string
  source_id?: string
  summary?: string
  observed_at?: string | null
  retrieved_at?: string | null
  authorization_scope?: string
  privacy_class?: string
  deletion_state?: string
  [key: string]: unknown
}

export type IntelligenceLimitation = {
  code: string
  message: string
  severity?: 'blocking' | 'warning' | 'info' | string
}

export type IntelligenceConfidence = number | { score?: number; label?: string; [key: string]: unknown }

export type ScarcityResult = {
  scarcity_score: number
  scarcity_label:
    | 'common'
    | 'limited'
    | 'scarce'
    | 'rare'
    | 'exceptional'
    | 'insufficient_data'
    | string
  active_supply_count: number
  recent_sale_count: number
  days_since_comparable_sale: number | null
  supply_velocity: number
  market_depth: number
  comparable_scope: string[]
  scope: 'release' | 'pressing' | 'comparable_group' | string
  evidence: IntelligenceEvidenceItem[]
  confidence: IntelligenceConfidence
  limitations: IntelligenceLimitation[]
  [key: string]: unknown
}

export type IntelligenceResponse<TResult = Record<string, unknown>> = {
  status: string
  capability: string
  envelope?: Record<string, unknown> | null
  result?: TResult | null
  diagnostics?: Record<string, unknown> | null
  prompt?: Record<string, unknown> | null
  error?: string
  [key: string]: unknown
}

export type ScarcityRequest = {
  subject: {
    release_id?: string | null
    pressing_id?: string | null
    condition?: string | null
    artist?: string | null
    title?: string | null
    catalog_number?: string | null
    [key: string]: unknown
  }
  candidates?: IntelligenceEvidenceItem[]
  authorized_scopes?: string[]
  claim_rarity_from_zero_results?: boolean
  require_exact_pressing?: boolean
  active_supply_count?: number
  recent_sale_count?: number
  currency?: string
  [key: string]: unknown
}

export type IntelligencePanelState<T = unknown> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; httpStatus?: number; message: string; rateLimited?: boolean }
  | { status: 'abstained'; result: T; reasons: string[] }
  | { status: 'ready'; result: T }

export function confidenceScore(confidence: IntelligenceConfidence | undefined): number | null {
  if (typeof confidence === 'number' && Number.isFinite(confidence)) return confidence
  if (confidence && typeof confidence === 'object' && typeof confidence.score === 'number') {
    return confidence.score
  }
  return null
}

export function limitationMessages(limitations: IntelligenceLimitation[] | undefined): string[] {
  if (!Array.isArray(limitations)) return []
  return limitations.map((l) => l.message || l.code).filter(Boolean)
}

export function isAbstentionResult(result: { scarcity_label?: string; limitations?: IntelligenceLimitation[] } | null | undefined): boolean {
  if (!result) return true
  if (result.scarcity_label === 'insufficient_data') return true
  return (result.limitations || []).some(
    (l) => l.severity === 'blocking' || /ABSTAIN|INSUFFICIENT/i.test(l.code || ''),
  )
}
