import { Router, type Response, type Router as ExpressRouter } from 'express'
import type Redis from 'ioredis'
import type { AuthedRequest } from '../lib/auth.js'
import { pool } from '../lib/db.js'
import { CacheManager } from '../lib/cache.js'

export default function wishlistRouter(redis: Redis | null, cacheManager: CacheManager): ExpressRouter {
  const router: Router = Router()

  // GET /wishlist - Get user's wishlist (includes sold-out status)
  router.get('/', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const limit = parseInt(req.query.limit as string) || 50
    const offset = parseInt(req.query.offset as string) || 0

    try {
      const result = await pool.query(
        `SELECT w.id, w.listing_id, w.item_type, w.item_id, w.priority, w.notes, w.metadata, w.created_at,
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
         FROM shopping.wishlist w
         WHERE w.user_id = $1
         ORDER BY w.priority DESC, w.created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
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

      const countResult = await pool.query(
        `SELECT COUNT(*) as total FROM shopping.wishlist WHERE user_id = $1`,
        [userId]
      )

      res.json({
        items: enrichedItems,
        total: parseInt(countResult.rows[0].total),
      })
    } catch (err) {
      console.error('[shopping] Get wishlist error:', err)
      res.status(500).json({ error: 'Failed to get wishlist' })
    }
  })

  // POST /wishlist - Add to wishlist
  router.post('/', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const { item_type, item_id, listing_id, priority = 0, notes, metadata } = req.body

    if (!item_type || !item_id) {
      return res.status(400).json({ error: 'item_type and item_id required' })
    }

    try {
      const result = await pool.query(
        `INSERT INTO shopping.wishlist (user_id, item_type, item_id, listing_id, priority, notes, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT (user_id, item_type, item_id)
         DO UPDATE SET priority = $5, notes = $6, metadata = $7::jsonb, updated_at = now()
         RETURNING id`,
        [userId, item_type, item_id, listing_id || null, priority, notes || null, metadata ? JSON.stringify(metadata) : null]
      )

      // Update LFU cache
      await cacheManager.incrementLFU(`wishlist:${item_type}:${item_id}`, userId)

      res.status(201).json({
        success: true,
        wishlist_id: result.rows[0].id,
      })
    } catch (err) {
      console.error('[shopping] Add to wishlist error:', err)
      res.status(500).json({ error: 'Failed to add to wishlist' })
    }
  })

  // DELETE /wishlist/:itemType/:itemId - Remove from wishlist
  router.delete('/:itemType/:itemId', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const { itemType, itemId } = req.params

    try {
      const result = await pool.query(
        `DELETE FROM shopping.wishlist
         WHERE user_id = $1 AND item_type = $2 AND item_id = $3
         RETURNING id`,
        [userId, itemType, itemId]
      )

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Item not found in wishlist' })
      }

      res.json({ success: true })
    } catch (err) {
      console.error('[shopping] Remove from wishlist error:', err)
      res.status(500).json({ error: 'Failed to remove from wishlist' })
    }
  })

  // PUT /wishlist/:itemType/:itemId - Update wishlist item
  router.put('/:itemType/:itemId', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const { itemType, itemId } = req.params
    const { priority, notes } = req.body

    try {
      const updates: string[] = []
      const values: any[] = [userId, itemType, itemId]
      let paramIndex = 4

      if (priority !== undefined) {
        updates.push(`priority = $${paramIndex++}`)
        values.push(priority)
      }
      if (notes !== undefined) {
        updates.push(`notes = $${paramIndex++}`)
        values.push(notes)
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' })
      }

      updates.push('updated_at = now()')

      const result = await pool.query(
        `UPDATE shopping.wishlist
         SET ${updates.join(', ')}
         WHERE user_id = $1 AND item_type = $2 AND item_id = $3
         RETURNING id`,
        values
      )

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Item not found in wishlist' })
      }

      res.json({ success: true })
    } catch (err) {
      console.error('[shopping] Update wishlist error:', err)
      res.status(500).json({ error: 'Failed to update wishlist item' })
    }
  })

  return router
}

