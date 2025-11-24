import { Router, type Response, type Router as ExpressRouter } from 'express'
import type Redis from 'ioredis'
import type { AuthedRequest } from '../lib/auth.js''
import { pool } from '../lib/db.js''
import { CacheManager } from '../lib/cache.js''

export default function cartRouter(redis: Redis | null, cacheManager: CacheManager): ExpressRouter {
  const router = Router()

  // GET /cart - Get user's shopping cart
  router.get('/', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    try {
      const result = await pool.query(
        `SELECT id, listing_id, item_type, item_id, quantity, price, metadata, created_at, updated_at
         FROM shopping.shopping_cart
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId]
      )

      const totalPrice = result.rows.reduce((sum, item) => {
        return sum + (Number(item.price || 0) * item.quantity)
      }, 0)

      res.json({
        items: result.rows,
        total_items: result.rows.reduce((sum, item) => sum + item.quantity, 0),
        total_price: totalPrice,
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

  return router
}

