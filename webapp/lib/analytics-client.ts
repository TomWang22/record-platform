import { apiFetch } from './api-client'

export type PredictItem = {
  query?: string
  base_price?: number
  record_grade?: string
  sleeve_grade?: string
  promo?: boolean
  anniversary_boost?: number
}

export type PricePrediction = {
  suggested: number
  samples: number
}

export type SearchHistory = {
  query: string
  source: string
  created_at: string
}

export type Recommendation = {
  query: string
  count: number
  last_searched?: string
}

export type TrendingItem = {
  query: string
  count: number
  trend?: 'up' | 'down' | 'stable'
}

export type PriceTrend = {
  price: number
  snapshot_date: string
}

// Price prediction
export async function predictPrice(items: PredictItem[]): Promise<PricePrediction> {
  return apiFetch<PricePrediction>('/api/analytics/predict-price', {
    method: 'POST',
    auth: true,
    data: { items },
  })
}

// User search history
export async function getUserSearchHistory(userId: string, limit = 50): Promise<{ userId: string; history: SearchHistory[]; count: number }> {
  return apiFetch(`/api/analytics/user/${userId}/history?limit=${limit}`, {
    auth: true,
  })
}

// Similar searches / recommendations
export async function getSimilarSearches(query: string, userId?: string, limit = 10): Promise<{ query: string; recommendations: Recommendation[]; count: number }> {
  const params = new URLSearchParams({ q: query, limit: String(limit) })
  if (userId) params.append('userId', userId)
  return apiFetch(`/api/analytics/recommendations/similar?${params}`, {
    auth: true,
  })
}

// Trending searches
export async function getTrendingSearches(days = 7, limit = 20): Promise<{ days: number; trending: TrendingItem[]; count: number }> {
  return apiFetch(`/api/analytics/trending?days=${days}&limit=${limit}`, {
    auth: true,
  })
}

// Price trends
export async function getPriceTrend(artist: string, name: string, format?: string, days = 90): Promise<{ artist: string; name: string; format?: string; days: number; trends: PriceTrend[]; count: number }> {
  const params = new URLSearchParams({ artist, name, days: String(days) })
  if (format) params.append('format', format)
  return apiFetch(`/api/analytics/price-trend?${params}`, {
    auth: true,
  })
}

// Log search
export async function logSearch(userId: string | null, source: string, query: string, results?: string[]): Promise<{ ok: boolean; logged: boolean }> {
  return apiFetch('/api/analytics/log-search', {
    method: 'POST',
    auth: true,
    data: { userId, source, query, results },
  })
}

// Fuzzy search
export async function fuzzySearch(query: string, userId?: string, limit = 20): Promise<{
  query: string
  results: {
    similarSearches: Recommendation[]
    priceMatches: Array<{
      artist: string
      name: string
      format: string
      median_price: number
      sample_count: number
      snap_date: string
    }>
    searchHistory: Array<{
      q: string
      source: string
      count: number
      last_searched: string
    }>
  }
  count: number
}> {
  const params = new URLSearchParams({ q: query, limit: String(limit) })
  if (userId) params.append('userId', userId)
  return apiFetch(`/api/analytics/fuzzy-search?${params}`, {
    auth: true,
  })
}

