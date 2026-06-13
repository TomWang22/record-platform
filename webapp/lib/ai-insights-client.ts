import { apiFetch } from './api-client'
import type {
  AiEnvelope,
  AuctionSignalsResponse,
  RagStatus,
} from './ai-insights-types'

export type { AiEnvelope, AiSourceRef, RagStatus } from './ai-insights-types'

export async function fetchRagStatus(): Promise<RagStatus> {
  return apiFetch<RagStatus>('/api/ai/rag/status', { auth: true })
}

export async function queryRag(question: string, sourceTypes?: string[]): Promise<AiEnvelope> {
  return apiFetch<AiEnvelope>('/api/ai/rag/query', {
    method: 'POST',
    auth: true,
    data: {
      question,
      ...(sourceTypes?.length ? { source_types: sourceTypes } : {}),
    },
  })
}

export async function fetchRecordValuation(recordId: string): Promise<AiEnvelope> {
  return apiFetch<AiEnvelope>('/api/ai/records/valuation', {
    method: 'POST',
    auth: true,
    data: { record_id: recordId, include_comps: true },
  })
}

export async function fetchPricingAdvice(listingId: string): Promise<AiEnvelope> {
  return apiFetch<AiEnvelope>('/api/ai/listings/pricing-advice', {
    method: 'POST',
    auth: true,
    data: { listing_id: listingId },
  })
}

export async function fetchOfferInsights(listingId: string): Promise<AiEnvelope> {
  return apiFetch<AiEnvelope>(`/api/ai/offer-insights?listing_id=${encodeURIComponent(listingId)}`, {
    auth: true,
  })
}

export async function fetchAuctionRisk(listingId: string): Promise<AiEnvelope> {
  return apiFetch<AiEnvelope>('/api/ai/auctions/risk', {
    method: 'POST',
    auth: true,
    data: { listing_id: listingId },
  })
}

export async function fetchAuctionMonitorSignals(opts?: {
  listingId?: string
  refresh?: boolean
}): Promise<AuctionSignalsResponse> {
  const params = new URLSearchParams()
  if (opts?.listingId) params.set('listing_id', opts.listingId)
  if (opts?.refresh) params.set('refresh', '1')
  const qs = params.toString()
  return apiFetch<AuctionSignalsResponse>(`/auctions/ai-signals${qs ? `?${qs}` : ''}`, { auth: true })
}

export async function fetchSellerSummary(): Promise<AiEnvelope> {
  return apiFetch<AiEnvelope>('/api/ai/seller/summary', {
    method: 'POST',
    auth: true,
    data: {},
  })
}

export async function fetchBuyerCollectionSummary(): Promise<AiEnvelope> {
  return apiFetch<AiEnvelope>('/api/ai/buyer/collection-summary', {
    method: 'POST',
    auth: true,
    data: {},
  })
}
