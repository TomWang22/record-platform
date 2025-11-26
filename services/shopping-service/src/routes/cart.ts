import { Router, type Response, type Router as ExpressRouter } from 'express'
import type Redis from 'ioredis'
import type { AuthedRequest } from '../lib/auth.js'
import { pool } from '../lib/db.js'
import { CacheManager } from '../lib/cache.js'
import { cleanupUnavailableItems, removeSoldOutFromCarts, markWatchlistSoldOut } from '../lib/availability.js'

export default function cartRouter(redis: Redis | null, cacheManager: CacheManager): ExpressRouter {
  const router: Router = Router()

  // GET /cart - Get user's shopping cart (automatically removes sold-out items)
  router.get('/', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    try {
      // Clean up unavailable items first
      const removedCount = await cleanupUnavailableItems(pool, userId)
      if (removedCount > 0) {
        console.log(`[shopping] Removed ${removedCount} unavailable items from cart for user ${userId}`)
      }

      // Get remaining cart items
      const result = await pool.query(
        `SELECT c.id, c.listing_id, c.item_type, c.item_id, c.quantity, c.price, c.metadata, c.created_at, c.updated_at,
                CASE 
                  WHEN c.item_type = 'listing' AND c.listing_id IS NOT NULL THEN
                    (SELECT json_build_object(
                      'is_active', l.is_active,
                      'sold_at', l.sold_at,
                      'stock_quantity', l.stock_quantity
                    ) FROM listings.listings l WHERE l.id = c.listing_id)
                  ELSE NULL
                END as availability
         FROM shopping.shopping_cart c
         WHERE c.user_id = $1
         ORDER BY c.created_at DESC`,
        [userId]
      )

      // Filter out any items that became unavailable (double-check)
      const availableItems = result.rows.filter((item: any) => {
        if (item.item_type === 'listing' && item.availability) {
          return item.availability.is_active && 
                 !item.availability.sold_at && 
                 item.availability.stock_quantity > 0
        }
        return true
      })

      const totalPrice = availableItems.reduce((sum: number, item: any) => {
        return sum + (Number(item.price || 0) * item.quantity)
      }, 0)

      res.json({
        items: availableItems,
        total_items: availableItems.reduce((sum: number, item: any) => sum + item.quantity, 0),
        total_price: totalPrice,
        removed_items: removedCount,
      })
    } catch (err) {
      console.error('[shopping] Get cart error:', err)
      res.status(500).json({ error: 'Failed to get cart' })
    }
  })

  // POST /cart - Add item to cart
  router.post('/', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const { item_type, item_id, quantity = 1, listing_id, price, metadata } = req.body

    if (!item_type || !item_id) {
      return res.status(400).json({ error: 'item_type and item_id required' })
    }

    try {
      // Check if item already in cart
      const existing = await pool.query(
        `SELECT id, quantity FROM shopping.shopping_cart
         WHERE user_id = $1 AND item_type = $2 AND item_id = $3`,
        [userId, item_type, item_id]
      )

      let cartItemId: string
      if (existing.rows.length > 0) {
        // Update quantity
        const newQuantity = existing.rows[0].quantity + quantity
        await pool.query(
          `UPDATE shopping.shopping_cart
           SET quantity = $1, updated_at = now()
           WHERE id = $2`,
          [newQuantity, existing.rows[0].id]
        )
        cartItemId = existing.rows[0].id
      } else {
        // Insert new item
        const result = await pool.query(
          `INSERT INTO shopping.shopping_cart (user_id, item_type, item_id, listing_id, quantity, price, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
           RETURNING id`,
          [userId, item_type, item_id, listing_id || null, quantity, price || null, metadata ? JSON.stringify(metadata) : null]
        )
        cartItemId = result.rows[0].id
      }

      // Update LFU cache
      await cacheManager.incrementLFU(`cart:${item_type}:${item_id}`, userId)

      res.status(201).json({
        success: true,
        cart_item_id: cartItemId,
        message: 'Item added to cart',
      })
    } catch (err) {
      console.error('[shopping] Add to cart error:', err)
      res.status(500).json({ error: 'Failed to add item to cart' })
    }
  })

  // DELETE /cart/:itemId - Remove item from cart
  router.delete('/:itemId', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const { itemId } = req.params

    try {
      const result = await pool.query(
        `DELETE FROM shopping.shopping_cart
         WHERE id = $1 AND user_id = $2
         RETURNING id`,
        [itemId, userId]
      )

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Item not found in cart' })
      }

      res.json({ success: true, message: 'Item removed from cart' })
    } catch (err) {
      console.error('[shopping] Remove from cart error:', err)
      res.status(500).json({ error: 'Failed to remove item from cart' })
    }
  })

  // PUT /cart/:itemId - Update cart item
  router.put('/:itemId', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const { itemId } = req.params
    const { quantity, price } = req.body

    try {
      const updates: string[] = []
      const values: any[] = [itemId, userId]
      let paramIndex = 3

      if (quantity !== undefined) {
        updates.push(`quantity = $${paramIndex++}`)
        values.push(quantity)
      }
      if (price !== undefined) {
        updates.push(`price = $${paramIndex++}`)
        values.push(price)
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' })
      }

      updates.push('updated_at = now()')

      const result = await pool.query(
        `UPDATE shopping.shopping_cart
         SET ${updates.join(', ')}
         WHERE id = $1 AND user_id = $2
         RETURNING id`,
        values
      )

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Item not found in cart' })
      }

      res.json({ success: true, message: 'Cart item updated' })
    } catch (err) {
      console.error('[shopping] Update cart error:', err)
      res.status(500).json({ error: 'Failed to update cart item' })
    }
  })

  // DELETE /cart - Clear entire cart
  router.delete('/', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    try {
      const result = await pool.query(
        `DELETE FROM shopping.shopping_cart
         WHERE user_id = $1
         RETURNING id`,
        [userId]
      )

      res.json({
        success: true,
        items_removed: result.rows.length,
      })
    } catch (err) {
      console.error('[shopping] Clear cart error:', err)
      res.status(500).json({ error: 'Failed to clear cart' })
    }
  })

  // POST /cart/checkout - Checkout items (marks as sold, removes from other carts)
  router.post('/checkout', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const { items } = req.body as { items: Array<{ item_type: string; item_id: string; listing_id?: string }> }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items array required' })
    }

    try {
      const results = []

      for (const item of items) {
        // Mark listing as sold (if it's a listing)
        if (item.item_type === 'listing' && item.listing_id) {
          // Update listing to sold
          await pool.query(
            `UPDATE listings.listings
             SET sold_at = NOW(),
                 sold_to = $1::uuid,
                 is_active = FALSE,
                 stock_quantity = 0
             WHERE id = $2::uuid AND is_active = TRUE AND stock_quantity > 0`,
            [userId, item.listing_id]
          )

          // Remove from all other users' carts
          const removedFromCarts = await removeSoldOutFromCarts(
            pool,
            item.item_type,
            item.item_id,
            userId
          )

          // Mark in watchlist/wishlist as sold out (but keep them)
          const markedInWatchlist = await markWatchlistSoldOut(
            pool,
            item.item_type,
            item.item_id
          )

          results.push({
            item_id: item.item_id,
            removed_from_carts: removedFromCarts,
            marked_in_watchlist: markedInWatchlist,
          })
        }
      }

      // Remove checked-out items from buyer's cart
      const itemIds = items.map((item) => item.item_id)
      await pool.query(
        `DELETE FROM shopping.shopping_cart
         WHERE user_id = $1::uuid AND item_id = ANY($2::uuid[])`,
        [userId, itemIds]
      )

      res.json({
        success: true,
        checked_out: items.length,
        results,
      })
    } catch (err) {
      console.error('[shopping] Checkout error:', err)
      res.status(500).json({ error: 'Failed to checkout items' })
    }
  })

  return router
}

