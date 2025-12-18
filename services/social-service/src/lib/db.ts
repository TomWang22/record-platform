import { Pool } from 'pg'

// Use POSTGRES_URL_SOCIAL for port 5434, fallback to DATABASE_URL
const DB_URL = process.env.POSTGRES_URL_SOCIAL || process.env.DATABASE_URL || ''
if (!DB_URL) {
  console.warn('[social] POSTGRES_URL_SOCIAL and DATABASE_URL are empty at startup')
}

// Optimized connection pool for high-volume social service
// Increased pool size for concurrent message/forum operations
// Longer timeouts for connection stability under load
export const pool = new Pool({
  connectionString: DB_URL,
  max: parseInt(process.env.DB_POOL_MAX || '50', 10), // Increased from 10 to 50 for high concurrency
  min: parseInt(process.env.DB_POOL_MIN || '5', 10), // Keep minimum connections warm
  idleTimeoutMillis: 60000, // Increased idle timeout (1 minute)
  connectionTimeoutMillis: 10000, // Increased connection timeout (10 seconds)
  statement_timeout: 30000, // 30 second statement timeout to prevent runaway queries
  query_timeout: 30000, // 30 second query timeout
  // Enable keep-alive for connection reuse
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
})

pool.on('error', (err) => {
  console.error('[social] Unexpected DB pool error:', err)
})

// Placeholder types - will be replaced when DB schema is designed
export interface ForumPost {
  id: string
  user_id: string
  title: string
  content: string
  flair: string
  upvotes: number
  downvotes: number
  comment_count: number
  is_pinned: boolean
  is_locked: boolean
  created_at: Date
  updated_at: Date
}

export interface ForumComment {
  id: string
  post_id: string
  user_id: string
  parent_id: string | null
  content: string
  upvotes: number
  downvotes: number
  created_at: Date
  updated_at: Date
}

export interface Message {
  id: string
  sender_id: string
  recipient_id: string | null
  parent_message_id: string | null
  thread_id: string | null
  message_type: string
  subject: string
  content: string
  is_read: boolean
  created_at: Date
  updated_at: Date
}


