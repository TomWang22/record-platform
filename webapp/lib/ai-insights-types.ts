export type AiSourceRef = {
  source_type: string
  source_id: string
  field?: string
  freshness?: string
  checksum?: string
}

export type AiEnvelope = {
  insight_id: string
  contract_id: string
  source_status: 'live' | 'degraded'
  model_used: string
  generated_at?: string
  confidence?: number
  summary: string
  details?: Record<string, unknown>
  source_refs: AiSourceRef[]
  citations?: unknown[]
  degraded_reason?: string
}

export type RagStatus = {
  source_status: 'live' | 'degraded'
  corpus?: { document_count?: number }
  providers?: Record<string, { available?: boolean }>
  degraded_reason?: string
}

export type AuctionMonitorSignal = {
  id?: string
  listing_id: string
  signal_code: string
  severity?: string
  confidence?: number
  detail?: string
  source_refs?: AiSourceRef[]
  detected_at?: string
}

export type AuctionSignalsResponse = {
  listing_id: string | null
  signal_count: number
  signals: AuctionMonitorSignal[]
  source_status: 'live' | 'degraded'
}

export type AiInsightPanel =
  | 'rag'
  | 'valuation'
  | 'pricing'
  | 'auction'
  | 'seller'
  | 'buyer'

export type HybridPreviewStatus = {
  enrolled: boolean
  user_id: string | null
  source: string | null
  gate_reason: string | null
  enrolled_at?: string
  error?: string
  ok?: boolean
}

export type HybridPreviewActionResult = {
  ok: boolean
  enrolled: boolean
  user_id?: string
  source?: string
  enrolled_at?: string
  revoked?: boolean
  revoked_at?: string | null
  error?: string
}
