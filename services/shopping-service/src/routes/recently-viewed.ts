import { Router, type Response, type Router as ExpressRouter } from 'express'
import type Redis from 'ioredis'
import type { AuthedRequest } from '../lib/auth.js'
import { pool, withRetry } from '../lib/db.js'
import { CacheManager } from '../lib/cache.js'
import { normalizeRecentlyViewedItems } from '../lib/shopping-product-contract.js'

export default function recentlyViewedRouter(redis: Redis | null, cacheManager: CacheManager): ExpressRouter {
  const router: Router = Router()

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

      const result = await withRetry(
        () => pool.query(query, params),
        3,
        'get recently viewed'
      )

      const items = await normalizeRecentlyViewedItems(result.rows)
      res.json({ items })
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
      await withRetry(
        () => pool.query(
          `INSERT INTO shopping.recently_viewed (user_id, item_type, item_id, metadata)
           VALUES ($1, $2, $3, $4::jsonb)
           ON CONFLICT (user_id, item_type, item_id)
           DO UPDATE SET viewed_at = now(), metadata = $4::jsonb`,
          [userId, item_type, item_id, metadata ? JSON.stringify(metadata) : null]
        ),
        3,
        'add recently viewed'
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

  // DELETE /recently-viewed?item_type=listing — clear all, or ?item_type=&item_id= — remove one
  router.delete('/', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const itemType = req.query.item_type as string | undefined
    const itemId = req.query.item_id as string | undefined

    try {
      if (itemId) {
        if (!itemType) {
          return res.status(400).json({ error: 'item_type required when item_id is set' })
        }
        const result = await withRetry(
          () =>
            pool.query(
              `DELETE FROM shopping.recently_viewed
               WHERE user_id = $1 AND item_type = $2 AND item_id = $3
               RETURNING item_id`,
              [userId, itemType, itemId],
            ),
          3,
          'remove recently viewed',
        )
        if (result.rowCount === 0) {
          return res.status(404).json({ error: 'not found' })
        }
        return res.json({ success: true })
      }

      let query = `DELETE FROM shopping.recently_viewed WHERE user_id = $1`
      const params: string[] = [userId]
      if (itemType) {
        query += ` AND item_type = $2`
        params.push(itemType)
      }
      query += ` RETURNING item_id`
      const result = await withRetry(() => pool.query(query, params), 3, 'clear recently viewed')
      res.json({ success: true, removed: result.rowCount ?? 0 })
    } catch (err) {
      console.error('[shopping] Delete recently viewed error:', err)
      res.status(500).json({ error: 'Failed to delete recently viewed' })
    }
  })

  return router
}

