import { apiFetch } from './api-client'
import type { PredictItem } from './analytics-client'

export type AIPricePrediction = {
  suggested: number
  local_suggested: number
  analytics_suggested: number | null
  samples: number
  estimates: number[]
  t_ms: number
}

export type AIRecommendation = {
  query: string
  recommendations: Array<{
    query: string
    count: number
    last_searched?: string
  }>
  source: 'analytics' | 'none'
}

export type AITrending = {
  days: number
  trending: Array<{
    query: string
    count: number
    trend?: 'up' | 'down' | 'stable'
  }>
  source: 'analytics' | 'none'
}

export type AIPriceTrends = {
  count: number
  low: number | null
  p50: number | null
  high: number | null
  query: string
  discogs_titles: string[]
  ebay_price_summ: {
    count: number
    low: number | null
    p50: number | null
    high: number | null
  }
}

export type AIChatRequest = {
  message: string
  user_id?: string
  context?: string
}

export type AIChatResponse = {
  message: string
  response: string
  analytics_context?: {
    recommendations?: Array<{
      query: string
      count: number
    }>
  }
  timestamp: number
}

// AI-enhanced price prediction
export async function aiPredictPrice(items: PredictItem[]): Promise<AIPricePrediction> {
  return apiFetch<AIPricePrediction>('/api/ai/predict-price', {
    method: 'POST',
    auth: true,
    data: { items },
  })
}

// AI-powered recommendations
export async function aiGetRecommendations(query: string, userId?: string, limit = 10): Promise<AIRecommendation> {
  const params = new URLSearchParams({ q: query, limit: String(limit) })
  if (userId) params.append('user_id', userId)
  return apiFetch<AIRecommendation>(`/api/ai/recommendations?${params}`, {
    auth: true,
  })
}

// AI-enhanced trending
export async function aiGetTrending(days = 7, limit = 20): Promise<AITrending> {
  return apiFetch<AITrending>(`/api/ai/trending?days=${days}&limit=${limit}`, {
    auth: true,
  })
}

// AI price trends
export async function aiGetPriceTrends(query: string): Promise<AIPriceTrends> {
  return apiFetch<AIPriceTrends>(`/api/ai/price-trends?q=${encodeURIComponent(query)}`, {
    auth: true,
  })
}

// AI chat
export async function aiChat(request: AIChatRequest): Promise<AIChatResponse> {
  return apiFetch<AIChatResponse>('/api/ai/chat', {
    method: 'POST',
    auth: true,
    data: request,
  })
}

