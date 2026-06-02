import { Pool, type QueryResult } from 'pg'

// Triple-DB setup: records for listings.search_history (table lives in records), listings for future, analytics for price_snapshots
const RECORDS_DB_URL = process.env.POSTGRES_URL_RECORDS || process.env.DATABASE_URL || ''
const LISTINGS_DB_URL = process.env.POSTGRES_URL_LISTINGS || process.env.DATABASE_URL || ''
const ANALYTICS_DB_URL = process.env.POSTGRES_URL_ANALYTICS || process.env.DATABASE_URL || ''

if (!RECORDS_DB_URL || !ANALYTICS_DB_URL) {
  console.warn('[analytics] POSTGRES_URL_RECORDS or POSTGRES_URL_ANALYTICS is empty at startup')
}

// Idle timeout: 0 = never expire (avoids recycle during rotation/chaos); else use env or 60s
const IDLE_MS = process.env.DB_IDLE_TIMEOUT_MS != null ? parseInt(process.env.DB_IDLE_TIMEOUT_MS, 10) : 60000

// Pool for records DB — listings.search_history lives in records (port 5433), not listings DB (5435)
// See CURRENT_DB_SCHEMA_REPORT.md and infra/db/03-database.sql
export const recordsPool = new Pool({
  connectionString: RECORDS_DB_URL,
  max: parseInt(process.env.DB_POOL_MAX || '100', 10),
  min: parseInt(process.env.DB_POOL_MIN || '10', 10),
  idleTimeoutMillis: IDLE_MS === 0 ? 0 : IDLE_MS,
  connectionTimeoutMillis: 10000,
  statement_timeout: 30000,
  query_timeout: 30000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
})

// Pool for listings DB (used for cross-DB queries if needed; search_history is in records)
export const listingsPool = new Pool({
  connectionString: LISTINGS_DB_URL,
  max: parseInt(process.env.DB_POOL_MAX || '100', 10),
  min: parseInt(process.env.DB_POOL_MIN || '10', 10),
  idleTimeoutMillis: IDLE_MS === 0 ? 0 : IDLE_MS,
  connectionTimeoutMillis: 10000,
  statement_timeout: 30000,
  query_timeout: 30000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
})

// Pool for analytics DB (price_snapshots, search_analytics, etc.)
export const analyticsPool = new Pool({
  connectionString: ANALYTICS_DB_URL,
  max: parseInt(process.env.DB_POOL_MAX || '100', 10),
  min: parseInt(process.env.DB_POOL_MIN || '10', 10),
  idleTimeoutMillis: IDLE_MS === 0 ? 0 : IDLE_MS,
  connectionTimeoutMillis: 10000,
  statement_timeout: 30000,
  query_timeout: 30000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
})

// Legacy pool for backward compatibility (defaults to analytics DB)
export const pool = analyticsPool

recordsPool.on('error', (err) => {
  console.error('[analytics] Records DB pool error:', err)
})

listingsPool.on('error', (err) => {
  console.error('[analytics] Listings DB pool error:', err)
})

analyticsPool.on('error', (err) => {
  console.error('[analytics] Analytics DB pool error:', err)
})

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Warm all pools before accepting traffic (avoids poisoned min connections when Postgres warms after pod start). */
export async function waitForAnalyticsPools(): Promise<void> {
  const maxAttempts = parseInt(process.env.ANALYTICS_DB_WARMUP_ATTEMPTS || '60', 10)
  const delayMs = parseInt(process.env.ANALYTICS_DB_WARMUP_DELAY_MS || '2000', 10)
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await Promise.all([
        recordsPool.query('SELECT 1'),
        listingsPool.query('SELECT 1'),
        analyticsPool.query('SELECT 1'),
      ])
      console.log('[analytics] DB pools ready')
      return
    } catch (err) {
      const msg = (err as Error)?.message || String(err)
      console.warn(`[analytics] DB warmup attempt ${attempt}/${maxAttempts}: ${msg}`)
      if (attempt === maxAttempts) throw err
      await sleep(delayMs)
    }
  }
}

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

// User search history analysis — table is in records DB (listings.search_history)
export async function getUserSearchHistory(
  userId: string,
  limit: number = 50
): Promise<SearchHistoryRow[]> {
  const result = await recordsPool.query<SearchHistoryRow>(
    `SELECT id, user_id, source, q, results, created_at
     FROM listings.search_history
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  )
  return result.rows
}

// Get similar searches (for recommendations) — table is in records DB
export async function getSimilarSearches(
  query: string,
  userId?: string,
  limit: number = 10
): Promise<SimilarSearch[]> {
  const result = await recordsPool.query<SimilarSearch>(
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

// Get trending searches (most popular in last N days) — table is in records DB
export async function getTrendingSearches(
  days: number = 7,
  limit: number = 20
): Promise<Array<{ query: string; count: number }>> {
  const result = await recordsPool.query<{ query: string; count: number }>(
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

// Log a search (for building history) — writes to records DB (listings.search_history lives there)
export async function logSearch(
  userId: string | null,
  source: string,
  query: string,
  results: number | null = null
): Promise<void> {
  await recordsPool.query(
    `INSERT INTO listings.search_history (user_id, source, q, results)
     VALUES ($1, $2, $3, $4)`,
    [userId, source, query, results]
  )
}











