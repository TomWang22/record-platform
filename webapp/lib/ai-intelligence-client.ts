import { ApiError, apiFetch } from './api-client'
import type {
  IntelligenceResponse,
  ScarcityRequest,
  ScarcityResult,
} from './ai-intelligence-types'

export class IntelligenceHttpError extends Error {
  readonly httpStatus: number
  readonly rateLimited: boolean
  readonly body: unknown

  constructor(message: string, httpStatus: number, body: unknown = null) {
    super(message)
    this.name = 'IntelligenceHttpError'
    this.httpStatus = httpStatus
    this.rateLimited = httpStatus === 429
    this.body = body
  }
}

async function postIntelligence<TResult>(
  path: string,
  data: Record<string, unknown>,
): Promise<IntelligenceResponse<TResult>> {
  try {
    return await apiFetch<IntelligenceResponse<TResult>>(path, {
      method: 'POST',
      auth: true,
      data: {
        ...data,
        production_mutation_allowed: false,
      },
    })
  } catch (err) {
    if (err instanceof ApiError) {
      throw new IntelligenceHttpError(err.message, err.status, err.details.body)
    }
    throw err
  }
}

export async function fetchScarcityIntelligence(
  body: ScarcityRequest,
): Promise<IntelligenceResponse<ScarcityResult>> {
  return postIntelligence<ScarcityResult>('/api/ai/intelligence/scarcity', {
    ...body,
    claim_rarity_from_zero_results: body.claim_rarity_from_zero_results === true,
  })
}

export async function fetchValuationIntelligence(
  body: Record<string, unknown>,
): Promise<IntelligenceResponse> {
  return postIntelligence('/api/ai/intelligence/valuation', body)
}

export async function fetchAuctionIntelligence(
  body: Record<string, unknown>,
): Promise<IntelligenceResponse> {
  return postIntelligence('/api/ai/intelligence/auction', body)
}

export async function fetchWatchlistTemperature(
  body: Record<string, unknown>,
): Promise<IntelligenceResponse> {
  return postIntelligence('/api/ai/intelligence/auction/watchlist-temperature', body)
}

export async function fetchNegotiationAssistance(
  body: Record<string, unknown>,
): Promise<IntelligenceResponse> {
  return postIntelligence('/api/ai/intelligence/negotiation', {
    ...body,
    automatic_send_allowed: false,
  })
}

export async function fetchRecommendationsIntelligence(
  body: Record<string, unknown>,
): Promise<IntelligenceResponse> {
  return postIntelligence('/api/ai/intelligence/recommendations', body)
}

export async function fetchMarketAnalyticsIntelligence(
  body: Record<string, unknown>,
): Promise<IntelligenceResponse> {
  return postIntelligence('/api/ai/intelligence/market-analytics', body)
}

export async function fetchEmbeddingMetadata(
  body: Record<string, unknown>,
): Promise<IntelligenceResponse> {
  return postIntelligence('/api/ai/intelligence/embeddings/metadata', body)
}

export async function fetchSemanticSearchIntelligence(
  body: Record<string, unknown>,
): Promise<IntelligenceResponse> {
  return postIntelligence('/api/ai/intelligence/semantic-search', body)
}

export async function resolveIntelligenceMemory(
  body: Record<string, unknown>,
): Promise<IntelligenceResponse> {
  return postIntelligence('/api/ai/intelligence/memory/resolve', body)
}

export async function forgetIntelligenceMemory(
  body: Record<string, unknown>,
): Promise<IntelligenceResponse> {
  return postIntelligence('/api/ai/intelligence/memory/forget', body)
}
