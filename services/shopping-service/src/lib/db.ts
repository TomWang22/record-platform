import { Pool } from 'pg'

// Database connection pool for shopping service
// Uses POSTGRES_URL_SHOPPING (port 5436)
// Optimized connection pool for high-volume shopping operations
// Increased pool size for concurrent cart/checkout/order operations
// Formula: max = (VUs * avg_concurrent_per_vu) + headroom
// For 50 VUs with 2-3 concurrent requests each: 100-150 + 50 headroom = 150-200
// Increased to 100 to handle peak load and prevent connection exhaustion
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL_SHOPPING || 'postgresql://postgres:postgres@localhost:5436/records',
  max: parseInt(process.env.DB_POOL_MAX || '100', 10), // Increased from 20 to 100 for high concurrency
  min: parseInt(process.env.DB_POOL_MIN || '10', 10), // Keep minimum connections warm
  idleTimeoutMillis: 60000, // Increased idle timeout (1 minute)
  connectionTimeoutMillis: 10000, // Increased connection timeout (10 seconds)
  statement_timeout: 30000, // 30 second statement timeout to prevent runaway queries
  query_timeout: 30000, // 30 second query timeout
  // Enable keep-alive for connection reuse
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
})

pool.on('error', (err) => {
  console.error('[shopping] Unexpected database error:', err)
})

pool.on('connect', () => {
  console.log('[shopping] Database connection established')
})

export { pool }

