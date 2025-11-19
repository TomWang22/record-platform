import { Pool, type QueryResult } from 'pg'

const DB_URL = process.env.DATABASE_URL || ''
if (!DB_URL) {
  console.warn('[analytics] DATABASE_URL is empty at startup')
}

export const pool = new Pool({
  connectionString: DB_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

pool.on('error', (err) => {
  console.error('[analytics] Unexpected DB pool error:', err)
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

// User search history analysis
export async function getUserSearchHistory(
  userId: string,
  limit: number = 50
): Promise<SearchHistoryRow[]> {
  const result = await pool.query<SearchHistoryRow>(
    `SELECT id, user_id, source, q, results, created_at
     FROM listings.search_history
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  )
  return result.rows
}

// Get similar searches (for recommendations)
export async function getSimilarSearches(
  query: string,
  userId?: string,
  limit: number = 10
): Promise<SimilarSearch[]> {
  const result = await pool.query<SimilarSearch>(
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

// Get trending searches (most popular in last N days)
export async function getTrendingSearches(
  days: number = 7,
  limit: number = 20
): Promise<Array<{ query: string; count: number }>> {
  const result = await pool.query<{ query: string; count: number }>(
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

// Price trend analysis from snapshots
export async function getPriceTrend(
  artist: string,
  name: string,
  format?: string,
  days: number = 90
): Promise<PriceSnapshotRow[]> {
  let query = `SELECT id, snap_date, artist, name, format, median_price, sample_count
               FROM analytics.price_snapshots
               WHERE artist ILIKE $1 AND name ILIKE $2`
  const params: any[] = [artist, name]
  
  if (format) {
    query += ` AND format = $3`
    params.push(format)
    query += ` AND snap_date >= NOW() - INTERVAL '${days} days'
               ORDER BY snap_date DESC`
  } else {
    query += ` AND snap_date >= NOW() - INTERVAL '${days} days'
               ORDER BY snap_date DESC`
  }
  
  const result = await pool.query<PriceSnapshotRow>(query, params)
  return result.rows
}

// Get average price from historical snapshots
export async function getHistoricalAveragePrice(
  artist: string,
  name: string,
  format?: string
): Promise<number | null> {
  let query = `SELECT AVG(median_price) as avg_price
               FROM analytics.price_snapshots
               WHERE artist ILIKE $1 AND name ILIKE $2`
  const params: any[] = [artist, name]
  
  if (format) {
    query += ` AND format = $3`
    params.push(format)
  }
  
  const result = await pool.query<{ avg_price: number | null }>(query, params)
  return result.rows[0]?.avg_price ?? null
}

// Log a search (for building history)
export async function logSearch(
  userId: string | null,
  source: string,
  query: string,
  results: number | null = null
): Promise<void> {
  await pool.query(
    `INSERT INTO listings.search_history (user_id, source, q, results)
     VALUES ($1, $2, $3, $4)`,
    [userId, source, query, results]
  )
}











