import { Router, type Response, type Router as ExpressRouter } from 'express'
import type Redis from 'ioredis'
import type { AuthedRequest } from '../lib/auth.js''
import { pool } from '../lib/db.js''
import { CacheManager } from '../lib/cache.js''

export default function historyRouter(redis: Redis | null, cacheManager: CacheManager): ExpressRouter {
  const router = Router()

  // GET /purchases - Get purchase history
  router.get('/purchases', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const limit = parseInt(req.query.limit as string) || 50
    const offset = parseInt(req.query.offset as string) || 0

    try {
      const result = await pool.query(
        `SELECT id, order_id, listing_id, item_type, item_id, quantity, price_paid, currency,
                purchase_type, status, purchased_at, metadata
         FROM shopping.purchase_history
         WHERE user_id = $1
         ORDER BY purchased_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      )

      const countResult = await pool.query(
        `SELECT COUNT(*) as total FROM shopping.purchase_history WHERE user_id = $1`,
        [userId]
      )

      res.json({
        items: result.rows,
        total: parseInt(countResult.rows[0].total),
      })
    } catch (err) {
      console.error('[shopping] Get purchase history error:', err)
      res.status(500).json({ error: 'Failed to get purchase history' })
    }
  })

  // POST /purchases - Add purchase
  router.post('/purchases', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const {
      order_id,
      item_type,
      item_id,
      listing_id,
      quantity = 1,
      price_paid,
      currency = 'USD',
      purchase_type,
      status = 'completed',
      metadata,
    } = req.body

    if (!order_id || !item_type || !item_id || !price_paid || !purchase_type) {
      return res.status(400).json({
        error: 'order_id, item_type, item_id, price_paid, and purchase_type required',
      })
    }

    try {
      const result = await pool.query(
        `INSERT INTO shopping.purchase_history 
         (user_id, order_id, item_type, item_id, listing_id, quantity, price_paid, currency, purchase_type, status, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
         RETURNING id`,
        [
          userId,
          order_id,
          item_type,
          item_id,
          listing_id || null,
          quantity,
          price_paid,
          currency,
          purchase_type,
          status,
          metadata ? JSON.stringify(metadata) : null,
        ]
      )

      res.status(201).json({
        success: true,
        purchase_id: result.rows[0].id,
      })
    } catch (err) {
      console.error('[shopping] Add purchase error:', err)
      res.status(500).json({ error: 'Failed to add purchase' })
    }
  })

  // GET /searches - Get search history
  router.get('/searches', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const queryType = req.query.query_type as string | undefined
    const limit = parseInt(req.query.limit as string) || 50

    try {
      let query = `
        SELECT id, query, query_type, filters, result_count, clicked_item, searched_at
        FROM shopping.search_history
        WHERE user_id = $1
      `
      const params: any[] = [userId]
      let paramIndex = 2

      if (queryType) {
        query += ` AND query_type = $${paramIndex++}`
        params.push(queryType)
      }

      query += ` ORDER BY searched_at DESC LIMIT $${paramIndex}`
      params.push(limit)

      const result = await pool.query(query, params)

      res.json({ items: result.rows })
    } catch (err) {
      console.error('[shopping] Get search history error:', err)
      res.status(500).json({ error: 'Failed to get search history' })
    }
  })

  // POST /searches - Add search
  router.post('/searches', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const { query, query_type, filters, result_count, clicked_item } = req.body

    if (!query || !query_type) {
      return res.status(400).json({ error: 'query and query_type required' })
    }

    try {
      await pool.query(
        `INSERT INTO shopping.search_history (user_id, query, query_type, filters, result_count, clicked_item)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
        [
          userId,
          query,
          query_type,
          filters ? JSON.stringify(filters) : null,
          result_count || null,
          clicked_item || null,
        ]
      )

      // Update LFU cache for search queries
      await cacheManager.incrementLFU(`search:${query_type}:${query}`, userId)

      res.status(201).json({ success: true })
    } catch (err) {
      console.error('[shopping] Add search error:', err)
      res.status(500).json({ error: 'Failed to add search' })
    }
  })

  // GET /searches/trending - Get trending searches
  router.get('/searches/trending', async (req: AuthedRequest, res: Response) => {
    const queryType = req.query.query_type as string | undefined
    const limit = parseInt(req.query.limit as string) || 20
    const timeRange = req.query.time_range as string || '24h'

    try {
      let timeFilter = "searched_at >= now() - interval '24 hours'"
      if (timeRange === '1h') {
        timeFilter = "searched_at >= now() - interval '1 hour'"
      } else if (timeRange === '7d') {
        timeFilter = "searched_at >= now() - interval '7 days'"
      } else if (timeRange === '30d') {
        timeFilter = "searched_at >= now() - interval '30 days'"
      }

      let query = `
        SELECT query, query_type, COUNT(*) as count
        FROM shopping.search_history
        WHERE ${timeFilter}
      `
      const params: any[] = []
      let paramIndex = 1

      if (queryType) {
        query += ` AND query_type = $${paramIndex++}`
        params.push(queryType)
      }

      query += `
        GROUP BY query, query_type
        ORDER BY count DESC
        LIMIT $${paramIndex}
      `
      params.push(limit)

      const result = await pool.query(query, params)

      res.json({
        items: result.rows.map((row) => ({
          query: row.query,
          query_type: row.query_type,
          count: parseInt(row.count),
        })),
      })
    } catch (err) {
      console.error('[shopping] Get trending searches error:', err)
      res.status(500).json({ error: 'Failed to get trending searches' })
    }
  })

  return router
}

