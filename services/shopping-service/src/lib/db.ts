import { Pool } from 'pg'

// Database connection pool for shopping service
// Uses POSTGRES_URL_SHOPPING (port 5436)
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL_SHOPPING || 'postgresql://postgres:postgres@localhost:5436/records',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
})

pool.on('error', (err) => {
  console.error('[shopping] Unexpected database error:', err)
})

pool.on('connect', () => {
  console.log('[shopping] Database connection established')
})

export { pool }

