import { Router, type Response, type Router as ExpressRouter } from 'express'
import type Redis from 'ioredis'
import type { AuthedRequest } from '../lib/auth.js''
import { pool } from '../lib/db.js''
import { CacheManager } from '../lib/cache.js''

export default function watchlistRouter(redis: Redis | null, cacheManager: CacheManager): ExpressRouter {
  const router = Router()

  // GET /watchlist - Get user's watchlist
  router.get('/', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const limit = parseInt(req.query.limit as string) || 50
    const offset = parseInt(req.query.offset as string) || 0

    try {
      const result = await pool.query(
        `SELECT id, listing_id, item_type, item_id, notify_on, metadata, created_at
         FROM shopping.watchlist
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      )

      const countResult = await pool.query(
        `SELECT COUNT(*) as total FROM shopping.watchlist WHERE user_id = $1`,
        [userId]
      )

      res.json({
        items: result.rows,
        total: parseInt(countResult.rows[0].total),
      })
    } catch (err) {
      console.error('[shopping] Get watchlist error:', err)
      res.status(500).json({ error: 'Failed to get watchlist' })
    }
  })

  // POST /watchlist - Add to watchlist
  router.post('/', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const { item_type, item_id, listing_id, notify_on = [], metadata } = req.body

    if (!item_type || !item_id) {
      return res.status(400).json({ error: 'item_type and item_id required' })
    }

    try {
      const result = await pool.query(
        `INSERT INTO shopping.watchlist (user_id, item_type, item_id, listing_id, notify_on, metadata)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (user_id, item_type, item_id) 
         DO UPDATE SET notify_on = $5, metadata = $6::jsonb, updated_at = now()
         RETURNING id`,
        [userId, item_type, item_id, listing_id || null, notify_on, metadata ? JSON.stringify(metadata) : null]
      )

      // Update LFU cache
      await cacheManager.incrementLFU(`watchlist:${item_type}:${item_id}`, userId)

      res.status(201).json({
        success: true,
        watchlist_id: result.rows[0].id,
        message: 'Item added to watchlist',
      })
    } catch (err) {
      console.error('[shopping] Add to watchlist error:', err)
      res.status(500).json({ error: 'Failed to add to watchlist' })
    }
  })

  // DELETE /watchlist/:itemType/:itemId - Remove from watchlist
  router.delete('/:itemType/:itemId', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const { itemType, itemId } = req.params

    try {
      const result = await pool.query(
        `DELETE FROM shopping.watchlist
         WHERE user_id = $1 AND item_type = $2 AND item_id = $3
         RETURNING id`,
        [userId, itemType, itemId]
      )

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Item not found in watchlist' })
      }

      res.json({ success: true, message: 'Item removed from watchlist' })
    } catch (err) {
      console.error('[shopping] Remove from watchlist error:', err)
      res.status(500).json({ error: 'Failed to remove from watchlist' })
    }
  })

  return router
}

