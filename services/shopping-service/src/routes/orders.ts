import { Router, type Response, type Router as ExpressRouter } from 'express'
import type Redis from 'ioredis'
import type { AuthedRequest } from '../lib/auth.js'
import { pool, withRetry } from '../lib/db.js'
import { CacheManager } from '../lib/cache.js'

export default function ordersRouter(redis: Redis | null, cacheManager: CacheManager): ExpressRouter {
  const router: Router = Router()

  // GET /orders - Get user's orders
  router.get('/', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const limit = parseInt(req.query.limit as string) || 50
    const offset = parseInt(req.query.offset as string) || 0
    const status = req.query.status as string | undefined

    try {
      let query = `
        SELECT id, order_number, status, payment_status, payment_method,
               subtotal, shipping_cost, tax, total, currency,
               created_at, updated_at, completed_at, cancelled_at
        FROM shopping.orders
        WHERE user_id = $1
      `
      const params: any[] = [userId]
      let paramIndex = 2

      if (status) {
        query += ` AND status = $${paramIndex++}`
        params.push(status)
      }

      query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`
      params.push(limit, offset)

      const result = await withRetry(
        () => pool.query(query, params),
        3,
        'get orders'
      )

      const countQuery = status
        ? `SELECT COUNT(*) as total FROM shopping.orders WHERE user_id = $1 AND status = $2`
        : `SELECT COUNT(*) as total FROM shopping.orders WHERE user_id = $1`
      const countParams = status ? [userId, status] : [userId]
      const countResult = await withRetry(
        () => pool.query(countQuery, countParams),
        3,
        'count orders'
      )

      res.json({
        orders: result.rows,
        total: parseInt(countResult.rows[0].total),
        limit,
        offset,
      })
    } catch (err) {
      console.error('[shopping] Get orders error:', err)
      res.status(500).json({ error: 'Failed to get orders' })
    }
  })

  // GET /orders/:orderId - Get order details
  router.get('/:orderId', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const { orderId } = req.params

    try {
      const orderResult = await withRetry(
        () => pool.query(
          `SELECT id, order_number, status, payment_status, payment_method, payment_transaction_id,
                  subtotal, shipping_cost, tax, total, currency,
                  shipping_address, billing_address, notes, metadata,
                  created_at, updated_at, completed_at, cancelled_at
           FROM shopping.orders
           WHERE id = $1::uuid AND user_id = $2::uuid`,
          [orderId, userId]
        ),
        3,
        'get order details'
      )

      if (orderResult.rows.length === 0) {
        return res.status(404).json({ error: 'Order not found' })
      }

      // Get purchase history items for this order
      const purchasesResult = await withRetry(
        () => pool.query(
          `SELECT id, listing_id, item_type, item_id, quantity, price_paid, currency,
                  purchase_type, status, purchased_at, metadata, resellable
           FROM shopping.purchase_history
           WHERE order_id = $1
           ORDER BY purchased_at DESC`,
          [orderId]
        ),
        3,
        'get order purchase history'
      )

      res.json({
        order: orderResult.rows[0],
        items: purchasesResult.rows,
      })
    } catch (err) {
      console.error('[shopping] Get order details error:', err)
      res.status(500).json({ error: 'Failed to get order details' })
    }
  })

  return router
}

