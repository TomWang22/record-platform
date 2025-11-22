import { Pool } from 'pg'

// Use POSTGRES_URL_SOCIAL for port 5434, fallback to DATABASE_URL
const DB_URL = process.env.POSTGRES_URL_SOCIAL || process.env.DATABASE_URL || ''
if (!DB_URL) {
  console.warn('[social] POSTGRES_URL_SOCIAL and DATABASE_URL are empty at startup')
}

export const pool = new Pool({
  connectionString: DB_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
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


