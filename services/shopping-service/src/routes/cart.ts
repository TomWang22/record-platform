import { Router, type Response, type Router as ExpressRouter } from 'express'
import type Redis from 'ioredis'
import type { AuthedRequest } from '../lib/auth.js'
import { pool } from '../lib/db.js'
import { CacheManager } from '../lib/cache.js'
import { cleanupUnavailableItems, removeSoldOutFromCarts, markWatchlistSoldOut } from '../lib/availability.js'

export default function cartRouter(redis: Redis | null, cacheManager: CacheManager): ExpressRouter {
  const router: Router = Router()

  // POST /cart/checkout - Checkout items (marks as sold, removes from other carts)
  // MUST be defined BEFORE router.post('/') to ensure /checkout matches before the catch-all /
  router.post('/checkout', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const {
      items,
      shipping_address,
      billing_address,
      payment_method = 'simulated',
      notes,
    } = req.body as {
      items: Array<{ item_type: string; item_id: string; listing_id?: string; quantity?: number; price?: number }>
      shipping_address?: any
      billing_address?: any
      payment_method?: string
      notes?: string
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items array required' })
    }

    try {
      // Get cart items with prices
      const cartItems = await pool.query(
        `SELECT c.id, c.item_type, c.item_id, c.listing_id, c.quantity, c.price, c.metadata
         FROM shopping.shopping_cart c
         WHERE c.user_id = $1::uuid AND c.item_id = ANY($2::uuid[])`,
        [userId, items.map((item) => item.item_id)]
      )

      if (cartItems.rows.length === 0) {
        return res.status(400).json({ error: 'No items found in cart' })
      }

      // Calculate totals
      let subtotal = 0
      let shippingCost = 0
      const orderItems: any[] = []

      for (const cartItem of cartItems.rows) {
        const itemPrice = parseFloat(cartItem.price || '0')
        const quantity = cartItem.quantity || 1
        const itemTotal = itemPrice * quantity
        subtotal += itemTotal

        orderItems.push({
          item_type: cartItem.item_type,
          item_id: cartItem.item_id,
          listing_id: cartItem.listing_id,
          quantity,
          price: itemPrice,
          metadata: cartItem.metadata,
        })
      }

      // Simple shipping calculation (can be enhanced)
      shippingCost = subtotal > 100 ? 0 : 10 // Free shipping over $100
      const tax = subtotal * 0.08 // 8% tax (simulated)
      const total = subtotal + shippingCost + tax

      // Generate order number
      const orderNumberResult = await pool.query('SELECT shopping.generate_order_number() as order_number')
      const orderNumber = orderNumberResult.rows[0].order_number

      // Create order
      const orderResult = await pool.query(
        `INSERT INTO shopping.orders (
          user_id, order_number, status, payment_status, payment_method,
          subtotal, shipping_cost, tax, total, currency,
          shipping_address, billing_address, notes, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14::jsonb)
        RETURNING id, order_number, status, payment_status, total, created_at`,
        [
          userId,
          orderNumber,
          'processing',
          'processing',
          payment_method,
          subtotal,
          shippingCost,
          tax,
          total,
          'USD',
          shipping_address ? JSON.stringify(shipping_address) : null,
          billing_address ? JSON.stringify(billing_address) : null,
          notes || null,
          JSON.stringify({ simulated_payment: true }),
        ]
      )

      const order = orderResult.rows[0]
      const orderId = order.id

      // Simulate payment processing (always succeeds in simulation)
      const paymentTransactionId = `PAY-SIM-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

      // Update order with payment success
      await pool.query(
        `UPDATE shopping.orders
         SET payment_status = 'paid',
             payment_transaction_id = $1,
             status = 'completed',
             completed_at = NOW()
         WHERE id = $2`,
        [paymentTransactionId, orderId]
      )

      // Process each item: mark as sold, create purchase history, clean up carts
      const purchaseResults = []

      for (const item of orderItems) {
        // Mark listing as sold (if it's a listing)
        if (item.item_type === 'listing' && item.listing_id) {
          // Update listing in listings database (port 5435)
          try {
            const { listingsPool } = await import('../lib/availability.js')
            const listingsDbResult = await listingsPool.query(
              `UPDATE listings.listings
               SET sold_at = NOW(),
                   sold_to = $1::uuid,
                   is_active = FALSE,
                   stock_quantity = 0
               WHERE id = $2::uuid AND is_active = TRUE AND stock_quantity > 0`,
              [userId, item.listing_id]
            )

            if (listingsDbResult.rowCount && listingsDbResult.rowCount > 0) {
              // Remove from all other users' carts
              const removedFromCarts = await removeSoldOutFromCarts(
                pool,
                item.item_type,
                item.item_id,
                userId
              )

              // Mark in watchlist/wishlist as sold out
              const markedInWatchlist = await markWatchlistSoldOut(
                pool,
                item.item_type,
                item.item_id
              )

              // Create purchase history entry
              const purchaseResult = await pool.query(
                `INSERT INTO shopping.purchase_history (
                  user_id, order_id, listing_id, item_type, item_id,
                  quantity, price_paid, currency, purchase_type, status,
                  metadata, resellable
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
                RETURNING id`,
                [
                  userId,
                  orderId,
                  item.listing_id,
                  item.item_type,
                  item.item_id,
                  item.quantity,
                  item.price,
                  'USD',
                  'buy_now',
                  'completed',
                  JSON.stringify({
                    ...item.metadata,
                    order_number: orderNumber,
                    payment_transaction_id: paymentTransactionId,
                  }),
                  true, // Resellable by default (eBay-style)
                ]
              )

              purchaseResults.push({
                purchase_id: purchaseResult.rows[0].id,
                item_id: item.item_id,
                removed_from_carts: removedFromCarts,
                marked_in_watchlist: markedInWatchlist,
              })
            }
          } catch (listingErr: any) {
            // Listings DB connection may fail - log but continue
            console.warn('[shopping] Could not update listing in listings DB:', listingErr.message)
            // Still create purchase history even if listing update failed
            const purchaseResult = await pool.query(
              `INSERT INTO shopping.purchase_history (
                user_id, order_id, listing_id, item_type, item_id,
                quantity, price_paid, currency, purchase_type, status,
                metadata, resellable
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
              RETURNING id`,
              [
                userId,
                orderId,
                item.listing_id,
                item.item_type,
                item.item_id,
                item.quantity,
                item.price,
                'USD',
                'buy_now',
                'completed',
                JSON.stringify({
                  ...item.metadata,
                  order_number: orderNumber,
                  payment_transaction_id: paymentTransactionId,
                }),
                true,
              ]
            )
            purchaseResults.push({
              purchase_id: purchaseResult.rows[0].id,
              item_id: item.item_id,
            })
          }
        } else {
          // For non-listing items, still create purchase history
          const purchaseResult = await pool.query(
            `INSERT INTO shopping.purchase_history (
              user_id, order_id, item_type, item_id,
              quantity, price_paid, currency, purchase_type, status,
              metadata, resellable
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
            RETURNING id`,
            [
              userId,
              orderId,
              item.item_type,
              item.item_id,
              item.quantity,
              item.price,
              'USD',
              'buy_now',
              'completed',
              JSON.stringify({
                ...item.metadata,
                order_number: orderNumber,
                payment_transaction_id: paymentTransactionId,
              }),
              true,
            ]
          )

          purchaseResults.push({
            purchase_id: purchaseResult.rows[0].id,
            item_id: item.item_id,
          })
        }
      }

      // Remove checked-out items from buyer's cart
      const cartItemIds = cartItems.rows.map((item) => item.id)
      await pool.query(
        `DELETE FROM shopping.shopping_cart
         WHERE user_id = $1::uuid AND id = ANY($2::uuid[])`,
        [userId, cartItemIds]
      )

      // Get final order details
      const finalOrder = await pool.query(
        `SELECT id, order_number, status, payment_status, payment_transaction_id,
                subtotal, shipping_cost, tax, total, currency, created_at, completed_at
         FROM shopping.orders
         WHERE id = $1`,
        [orderId]
      )

      res.json({
        success: true,
        order: finalOrder.rows[0],
        purchases: purchaseResults,
        message: 'Checkout completed successfully',
      })
    } catch (err) {
      console.error('[shopping] Checkout error:', err)
      res.status(500).json({ error: 'Failed to checkout items', details: err instanceof Error ? err.message : String(err) })
    }
  })

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
      // Note: We removed the listings.listings subquery because the listings schema
      // may not be accessible from the shopping service's database connection.
      // The cleanupUnavailableItems function already handles availability checks.
      const result = await pool.query(
        `SELECT c.id, c.listing_id, c.item_type, c.item_id, c.quantity, c.price, c.metadata, c.created_at, c.updated_at
         FROM shopping.shopping_cart c
         WHERE c.user_id = $1
         ORDER BY c.created_at DESC`,
        [userId]
      )

      // All items are considered available (cleanupUnavailableItems already removed unavailable ones)
      const availableItems = result.rows

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

  // NOTE: POST /cart/checkout route is now defined at the TOP of this file (before POST /)
  // to ensure route matching works correctly. This duplicate has been removed.

  return router
}

