import { Pool, type QueryResult } from 'pg'

// Dual-DB setup: listings DB for search_history, analytics DB for price_snapshots
const LISTINGS_DB_URL = process.env.POSTGRES_URL_LISTINGS || process.env.DATABASE_URL || ''
const ANALYTICS_DB_URL = process.env.POSTGRES_URL_ANALYTICS || process.env.DATABASE_URL || ''

if (!LISTINGS_DB_URL || !ANALYTICS_DB_URL) {
  console.warn('[analytics] POSTGRES_URL_LISTINGS or POSTGRES_URL_ANALYTICS is empty at startup')
}

// Pool for listings DB (search_history)
// Increased pool size to handle 50+ VUs with headroom for concurrent requests
// Formula: max = (VUs * avg_concurrent_per_vu) + headroom
// For 50 VUs with 2 concurrent requests each: 100 + 50 headroom = 150
// But we cap at reasonable limit to avoid overwhelming DB
export const listingsPool = new Pool({
  connectionString: LISTINGS_DB_URL,
  max: 100,  // Increased from 50 to handle 50+ VUs with headroom (2 replicas * 50 = 100, but we need more for concurrent requests)
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

// Pool for analytics DB (price_snapshots, search_analytics, etc.)
// Increased pool size to handle 50+ VUs with headroom
export const analyticsPool = new Pool({
  connectionString: ANALYTICS_DB_URL,
  max: 100,  // Increased from 50 to handle 50+ VUs with headroom
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

// Legacy pool for backward compatibility (defaults to analytics DB)
export const pool = analyticsPool

listingsPool.on('error', (err) => {
  console.error('[analytics] Listings DB pool error:', err)
})

analyticsPool.on('error', (err) => {
  console.error('[analytics] Analytics DB pool error:', err)
})

export interface SearchHistoryRow {
  id: number
  user_id: string | null
  source: string
  q: string
  results: number | null
  created_at: Date
}

export interface PriceSnapshotRow {
  id: number
  snap_date: Date
  artist: string
  name: string
  format: string | null
  median_price: number | null
  sample_count: number
}

export interface SimilarSearch {
  query: string
  count: number
  similarity: number
}

// User search history analysis (from listings DB)
export async function getUserSearchHistory(
  userId: string,
  limit: number = 50
): Promise<SearchHistoryRow[]> {
  const result = await listingsPool.query<SearchHistoryRow>(
    `SELECT id, user_id, source, q, results, created_at
     FROM listings.search_history
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  )
  return result.rows
}

// Get similar searches (for recommendations) - from listings DB
export async function getSimilarSearches(
  query: string,
  userId?: string,
  limit: number = 10
): Promise<SimilarSearch[]> {
  const result = await listingsPool.query<SimilarSearch>(
    `SELECT q as query, COUNT(*)::int as count,
            MAX(similarity(q, $1)) as similarity
     FROM listings.search_history
     WHERE ($2::uuid IS NULL OR user_id = $2)
       AND q % $1
       AND q != $1
     GROUP BY q
     ORDER BY similarity DESC, count DESC
     LIMIT $3`,
    [query, userId || null, limit]
  )
  return result.rows
}

// Get trending searches (most popular in last N days) - from listings DB
export async function getTrendingSearches(
  days: number = 7,
  limit: number = 20
): Promise<Array<{ query: string; count: number }>> {
  const result = await listingsPool.query<{ query: string; count: number }>(
    `SELECT q as query, COUNT(*)::int as count
     FROM listings.search_history
     WHERE created_at >= NOW() - INTERVAL '${days} days'
     GROUP BY q
     ORDER BY count DESC
     LIMIT $1`,
    [limit]
  )
  return result.rows
}

// Price trend analysis from snapshots (from analytics DB)
// Note: This queries the actual schema which uses record_id and price
// For now, return empty array since we need record_id to query (would need to join with records table)
export async function getPriceTrend(
  artist: string,
  name: string,
  format?: string,
  days: number = 90
): Promise<PriceSnapshotRow[]> {
  // The actual schema uses record_id, not artist/name directly
  // We'd need to join with records.records table to match artist/name
  // For now, return empty array - this endpoint needs proper implementation
  // TODO: Join with records.records table to match artist/name
  return []
  
  // Original query (doesn't match actual schema):
  // let query = `SELECT id, snapshot_date, record_id, source, price, currency, condition_record, condition_sleeve, created_at
  //              FROM analytics.price_snapshots
  //              WHERE ... (need to join with records.records)`
  // const result = await analyticsPool.query<PriceSnapshotRow>(query, params)
  // return result.rows
}

// Get average price from historical snapshots (from analytics DB)
// Note: Schema uses record_id, would need to join with records table
export async function getHistoricalAveragePrice(
  artist: string,
  name: string,
  format?: string
): Promise<number | null> {
  // The actual schema uses record_id, not artist/name directly
  // We'd need to join with records.records table to match artist/name
  // For now, return null - this endpoint needs proper implementation
  // TODO: Join with records.records table to match artist/name
  return null
}

// Log a search (for building history) - writes to listings DB
export async function logSearch(
  userId: string | null,
  source: string,
  query: string,
  results: number | null = null
): Promise<void> {
  await listingsPool.query(
    `INSERT INTO listings.search_history (user_id, source, q, results)
     VALUES ($1, $2, $3, $4)`,
    [userId, source, query, results]
  )
}











