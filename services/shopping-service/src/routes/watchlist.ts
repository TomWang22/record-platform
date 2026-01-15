import { Router, type Response, type Router as ExpressRouter } from 'express'
import type Redis from 'ioredis'
import type { AuthedRequest } from '../lib/auth.js'
import { pool, withRetry } from '../lib/db.js'
import { CacheManager } from '../lib/cache.js'

export default function watchlistRouter(redis: Redis | null, cacheManager: CacheManager): ExpressRouter {
  const router: Router = Router()

  // GET /watchlist - Get user's watchlist (includes sold-out status)
  router.get('/', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const limit = parseInt(req.query.limit as string) || 50
    const offset = parseInt(req.query.offset as string) || 0

    try {
      const result = await withRetry(
        () => pool.query(
          `SELECT w.id, w.listing_id, w.item_type, w.item_id, w.notify_on, w.metadata, w.created_at,
                  CASE 
                    WHEN w.item_type = 'listing' AND w.listing_id IS NOT NULL THEN
                      (SELECT json_build_object(
                        'is_active', l.is_active,
                        'sold_at', l.sold_at,
                        'stock_quantity', l.stock_quantity,
                        'title', l.title,
                        'price', l.price
                      ) FROM listings.listings l WHERE l.id = w.listing_id)
                    ELSE NULL
                  END as listing_info
           FROM shopping.watchlist w
           WHERE w.user_id = $1
           ORDER BY w.created_at DESC
           LIMIT $2 OFFSET $3`,
          [userId, limit, offset]
        ),
        3,
        'get watchlist'
      )

      // Enrich with sold-out status from metadata
      const enrichedItems = result.rows.map((item: any) => {
        const soldOut = item.metadata?.sold_out === true || 
                       (item.listing_info && (!item.listing_info.is_active || item.listing_info.sold_at || item.listing_info.stock_quantity <= 0))
        return {
          ...item,
          sold_out: soldOut,
          sold_out_at: item.metadata?.sold_out_at || (item.listing_info?.sold_at || null),
        }
      })

      const countResult = await withRetry(
        () => pool.query(
          `SELECT COUNT(*) as total FROM shopping.watchlist WHERE user_id = $1`,
          [userId]
        ),
        3,
        'count watchlist'
      )

      res.json({
        items: enrichedItems,
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
      const result = await withRetry(
        () => pool.query(
          `INSERT INTO shopping.watchlist (user_id, item_type, item_id, listing_id, notify_on, metadata)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)
           ON CONFLICT (user_id, item_type, item_id) 
           DO UPDATE SET notify_on = $5, metadata = $6::jsonb, updated_at = now()
           RETURNING id`,
          [userId, item_type, item_id, listing_id || null, notify_on, metadata ? JSON.stringify(metadata) : null]
        ),
        3,
        'add to watchlist'
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
      const result = await withRetry(
        () => pool.query(
          `DELETE FROM shopping.watchlist
           WHERE user_id = $1 AND item_type = $2 AND item_id = $3
           RETURNING id`,
          [userId, itemType, itemId]
        ),
        3,
        'remove from watchlist'
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

