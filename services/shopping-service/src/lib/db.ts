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
  connectionTimeoutMillis: 15000, // Increased connection timeout (15 seconds) to handle network latency
  statement_timeout: 30000, // 30 second statement timeout to prevent runaway queries
  query_timeout: 30000, // 30 second query timeout
  // Enable keep-alive for connection reuse
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  // Connection retry settings
  allowExitOnIdle: false, // Keep pool alive even when idle
})

pool.on('error', (err) => {
  console.error('[shopping] Unexpected database error:', err)
  // On connection errors, try to reconnect
  if (err.message && (err.message.includes('terminated') || err.message.includes('timeout') || err.message.includes('ECONNREFUSED'))) {
    console.warn('[shopping] Connection error detected, pool will retry on next query')
  }
})

pool.on('connect', () => {
  console.log('[shopping] Database connection established')
})

// Connection retry wrapper for database queries
// Retries queries up to 3 times with exponential backoff on connection errors
async function withRetry<T>(
  queryFn: () => Promise<T>,
  maxRetries: number = 3,
  operation: string = 'query'
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await queryFn();
    } catch (err: any) {
      lastError = err;
      const isConnectionError = err?.message && (
        err.message.includes('terminated') ||
        err.message.includes('timeout') ||
        err.message.includes('ECONNREFUSED') ||
        err.message.includes('Connection terminated') ||
        err.message.includes('Connection terminated due to connection timeout') ||
        err.code === 'ECONNRESET' ||
        err.code === 'ETIMEDOUT'
      );
      
      if (isConnectionError && attempt < maxRetries - 1) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000); // Exponential backoff, max 5s
        console.warn(`[shopping] ${operation} failed (attempt ${attempt + 1}/${maxRetries}): ${err.message}, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // Not a connection error or max retries reached
      throw err;
    }
  }
  
  throw lastError || new Error('Query failed after retries');
}

export { pool, withRetry }

