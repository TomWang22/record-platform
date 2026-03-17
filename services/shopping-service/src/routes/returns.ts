import { Router, type Response, type Router as ExpressRouter } from 'express'
import type Redis from 'ioredis'
import type { AuthedRequest } from '../lib/auth.js'
import { pool, withRetry } from '../lib/db.js'
import type { CacheManager } from '../lib/cache.js'

export default function returnsRouter(_redis: Redis | null, _cacheManager: CacheManager): ExpressRouter {
  const router: Router = Router()

  // GET /returns - List current user's return requests
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
          `SELECT r.id, r.order_id, r.purchase_id, r.status, r.reason,
                  r.requested_at, r.responded_at, r.received_at, r.refunded_at,
                  r.created_at, r.updated_at,
                  o.order_number
           FROM shopping.returns r
           JOIN shopping.orders o ON o.id = r.order_id
           WHERE r.requested_by = $1::uuid
           ORDER BY r.requested_at DESC
           LIMIT $2 OFFSET $3`,
          [userId, limit, offset]
        ),
        3,
        'list returns'
      )

      const countResult = await withRetry(
        () => pool.query(
          `SELECT COUNT(*) as total FROM shopping.returns WHERE requested_by = $1::uuid`,
          [userId]
        ),
        3,
        'count returns'
      )

      res.json({
        returns: result.rows,
        total: parseInt(countResult.rows[0]?.total ?? '0'),
        limit,
        offset,
      })
    } catch (err) {
      console.error('[shopping] List returns error:', err)
      res.status(500).json({ error: 'Failed to list returns' })
    }
  })

  // POST /returns - Request a return for an order item (eBay-style)
  router.post('/', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const { order_id, purchase_id, reason } = req.body as { order_id?: string; purchase_id?: string; reason?: string }

    if (!order_id || !purchase_id) {
      return res.status(400).json({ error: 'order_id and purchase_id required' })
    }

    try {
      // Verify purchase belongs to user and to this order
      const purchaseCheck = await withRetry(
        () => pool.query(
          `SELECT id, order_id, item_id, listing_id FROM shopping.purchase_history
           WHERE id = $1::uuid AND order_id = $2::uuid AND user_id = $3::uuid`,
          [purchase_id, order_id, userId]
        ),
        3,
        'verify purchase for return'
      )

      if (purchaseCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Purchase not found or not yours' })
      }

      // Check no open return already for this purchase
      const existing = await withRetry(
        () => pool.query(
          `SELECT id FROM shopping.returns
           WHERE purchase_id = $1::uuid AND status NOT IN ('rejected', 'refunded')`,
          [purchase_id]
        ),
        3,
        'check existing return'
      )
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Return already requested for this item' })
      }

      const insertResult = await withRetry(
        () => pool.query(
          `INSERT INTO shopping.returns (order_id, purchase_id, requested_by, status, reason)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'requested', $4)
           RETURNING id, order_id, purchase_id, status, reason, requested_at`,
          [order_id, purchase_id, userId, reason ?? null]
        ),
        3,
        'create return request'
      )

      res.status(201).json({
        success: true,
        return: insertResult.rows[0],
        message: 'Return requested',
      })
    } catch (err) {
      console.error('[shopping] Request return error:', err)
      res.status(500).json({ error: 'Failed to request return' })
    }
  })

  // GET /returns/:returnId - Get one return by id (must be requested_by user)
  router.get('/:returnId', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const { returnId } = req.params

    try {
      const result = await withRetry(
        () => pool.query(
          `SELECT r.id, r.order_id, r.purchase_id, r.status, r.reason,
                  r.requested_at, r.responded_at, r.received_at, r.refunded_at,
                  r.created_at, r.updated_at,
                  o.order_number
           FROM shopping.returns r
           JOIN shopping.orders o ON o.id = r.order_id
           WHERE r.id = $1::uuid AND r.requested_by = $2::uuid`,
          [returnId, userId]
        ),
        3,
        'get return'
      )

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Return not found' })
      }

      res.json(result.rows[0])
    } catch (err) {
      console.error('[shopping] Get return error:', err)
      res.status(500).json({ error: 'Failed to get return' })
    }
  })

  return router
}
