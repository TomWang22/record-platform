import { Router, type Response, type Router as ExpressRouter } from 'express'
import type Redis from 'ioredis'
import type { AuthedRequest } from '../lib/auth.js'
import { pool, withRetry } from '../lib/db.js'
import { CacheManager } from '../lib/cache.js'
import { normalizeWatchlistItems } from '../lib/shopping-product-contract.js'
import {
  removeWatchlistWithOutbox,
  upsertWatchlistWithOutbox,
} from '../application/shoppingOutbox.js'

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
          `SELECT w.id, w.listing_id, w.item_type, w.item_id, w.metadata, w.created_at
           FROM shopping.watchlist w
           WHERE w.user_id = $1
           ORDER BY w.created_at DESC
           LIMIT $2 OFFSET $3`,
          [userId, limit, offset]
        ),
        3,
        'get watchlist'
      )

      const items = await normalizeWatchlistItems(result.rows)

      const countResult = await withRetry(
        () => pool.query(
          `SELECT COUNT(*) as total FROM shopping.watchlist WHERE user_id = $1`,
          [userId]
        ),
        3,
        'count watchlist'
      )

      res.json({
        items,
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
        () =>
          upsertWatchlistWithOutbox(pool, {
            userId,
            itemType: item_type,
            itemId: item_id,
            listingId: listing_id || null,
            notifyOn: notify_on,
            metadata,
          }),
        3,
        'add to watchlist'
      )

      // Update LFU cache
      await cacheManager.incrementLFU(`watchlist:${item_type}:${item_id}`, userId)

      res.status(201).json({
        success: true,
        watchlist_id: result.watchlistId,
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
        () =>
          removeWatchlistWithOutbox(pool, {
            userId,
            itemType,
            itemId,
          }),
        3,
        'remove from watchlist'
      )

      if (result.kind === 'not_found') {
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

