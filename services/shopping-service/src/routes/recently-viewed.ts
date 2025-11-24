import { Router, type Response, type Router as ExpressRouter } from 'express'
import type Redis from 'ioredis'
import type { AuthedRequest } from '../lib/auth'
import { pool } from '../lib/db'
import { CacheManager } from '../lib/cache'

export default function recentlyViewedRouter(redis: Redis | null, cacheManager: CacheManager): ExpressRouter {
  const router = Router()

  // GET /recently-viewed - Get user's recently viewed items
  router.get('/', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const itemType = req.query.item_type as string | undefined
    const limit = parseInt(req.query.limit as string) || 50

    try {
      let query = `
        SELECT item_type, item_id, viewed_at, metadata
        FROM shopping.recently_viewed
        WHERE user_id = $1
      `
      const params: any[] = [userId]
      let paramIndex = 2

      if (itemType) {
        query += ` AND item_type = $${paramIndex++}`
        params.push(itemType)
      }

      query += ` ORDER BY viewed_at DESC LIMIT $${paramIndex}`
      params.push(limit)

      const result = await pool.query(query, params)

      res.json({ items: result.rows })
    } catch (err) {
      console.error('[shopping] Get recently viewed error:', err)
      res.status(500).json({ error: 'Failed to get recently viewed' })
    }
  })

  // POST /recently-viewed - Add recently viewed item
  router.post('/', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const { item_type, item_id, metadata } = req.body

    if (!item_type || !item_id) {
      return res.status(400).json({ error: 'item_type and item_id required' })
    }

    try {
      // Upsert (update viewed_at if exists, insert if not)
      await pool.query(
        `INSERT INTO shopping.recently_viewed (user_id, item_type, item_id, metadata)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (user_id, item_type, item_id)
         DO UPDATE SET viewed_at = now(), metadata = $4::jsonb`,
        [userId, item_type, item_id, metadata ? JSON.stringify(metadata) : null]
      )

      // Update LRU cache
      await cacheManager.addRecentlyViewed(userId, item_type, item_id, metadata)
      await cacheManager.updateLRU(`recently_viewed:${userId}:${item_type}:${item_id}`, userId)

      res.status(201).json({ success: true })
    } catch (err) {
      console.error('[shopping] Add recently viewed error:', err)
      res.status(500).json({ error: 'Failed to add recently viewed' })
    }
  })

  return router
}

