import { Router, type Response, type Router as ExpressRouter } from 'express'
import type Redis from 'ioredis'
import type { AuthedRequest } from '../lib/auth.js'
import { pool, withRetry } from '../lib/db.js'
import { CacheManager } from '../lib/cache.js'
import axios from 'axios'

export default function resellRouter(redis: Redis | null, cacheManager: CacheManager): ExpressRouter {
  const router: Router = Router()

  // GET /resell/purchases - Get resellable purchases (eBay-style)
  router.get('/purchases', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const limit = parseInt(req.query.limit as string) || 50
    const offset = parseInt(req.query.offset as string) || 0

    try {
      const result = await withRetry(
        () => pool.query(
          `SELECT ph.id, ph.order_id, ph.listing_id, ph.item_type, ph.item_id,
                  ph.quantity, ph.price_paid, ph.currency, ph.purchase_type,
                  ph.status, ph.purchased_at, ph.metadata, ph.resellable
           FROM shopping.purchase_history ph
           WHERE ph.user_id = $1 AND ph.resellable = TRUE
           ORDER BY ph.purchased_at DESC
           LIMIT $2 OFFSET $3`,
          [userId, limit, offset]
        ),
        3,
        'get resellable purchases'
      )

      const countResult = await withRetry(
        () => pool.query(
          `SELECT COUNT(*) as total
           FROM shopping.purchase_history
           WHERE user_id = $1 AND resellable = TRUE`,
          [userId]
        ),
        3,
        'count resellable purchases'
      )

      res.json({
        items: result.rows,
        total: parseInt(countResult.rows[0].total),
        limit,
        offset,
      })
    } catch (err) {
      console.error('[shopping] Get resellable purchases error:', err)
      res.status(500).json({ error: 'Failed to get resellable purchases' })
    }
  })

  // POST /resell/:purchaseId - Create a listing from a purchase (eBay-style resell)
  router.post('/:purchaseId', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const { purchaseId } = req.params
    const {
      title,
      description,
      price,
      currency = 'USD',
      listing_type = 'fixed_price',
      condition,
      category,
      location,
      shipping_cost = 0,
      media_type,
      has_obi,
      label_type,
      // Optional: override resellable flag
      mark_as_resold = true,
    } = req.body

    if (!title || !price) {
      return res.status(400).json({ error: 'title and price required' })
    }

    try {
      // Verify purchase belongs to user and is resellable
      const purchaseResult = await withRetry(
        () => pool.query(
          `SELECT ph.id, ph.item_type, ph.item_id, ph.listing_id, ph.metadata, ph.resellable
           FROM shopping.purchase_history ph
           WHERE ph.id = $1::uuid AND ph.user_id = $2::uuid AND ph.resellable = TRUE`,
          [purchaseId, userId]
        ),
        3,
        'verify purchase for resell'
      )

      if (purchaseResult.rows.length === 0) {
        return res.status(404).json({ error: 'Purchase not found or not resellable' })
      }

      const purchase = purchaseResult.rows[0]

      // Create listing via listings service
      // In Kubernetes, use the service name; fallback to localhost for local dev
      const listingsServiceUrl = process.env.LISTINGS_SERVICE_URL || 'http://listings-service:4003'
      const authHeader = req.headers.authorization

      try {
        const listingResponse = await axios.post(
          `${listingsServiceUrl}/listings`,
          {
            title,
            description: description || `Reselling item from purchase ${purchase.id}`,
            price: parseFloat(price),
            currency,
            listing_type,
            condition: condition || 'used',
            category: category || 'vinyl',
            location: location || 'US',
            shipping_cost: parseFloat(shipping_cost.toString()),
            media_type,
            has_obi,
            label_type,
            // Include purchase metadata
            metadata: {
              ...purchase.metadata,
              resold_from_purchase: purchase.id,
              original_purchase_price: purchase.metadata?.price_paid || purchase.metadata?.price,
            },
          },
          {
            headers: {
              Authorization: authHeader,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          }
        )

        const newListing = listingResponse.data

        // Mark purchase as resold (if requested)
        if (mark_as_resold) {
          await withRetry(
            () => pool.query(
              `UPDATE shopping.purchase_history
               SET resellable = FALSE,
                   metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('resold_listing_id', $1::text, 'resold_at', NOW())
               WHERE id = $2::uuid`,
              [newListing.id, purchaseId]
            ),
            3,
            'mark purchase as resold'
          )
        }

        res.status(201).json({
          success: true,
          listing: newListing,
          purchase_id: purchaseId,
          message: 'Item listed for resale successfully',
        })
      } catch (listingsError: any) {
        console.error('[shopping] Failed to create listing:', listingsError.response?.data || listingsError.message)
        return res.status(500).json({
          error: 'Failed to create listing',
          details: listingsError.response?.data?.error || listingsError.message,
        })
      }
    } catch (err) {
      console.error('[shopping] Resell error:', err)
      res.status(500).json({ error: 'Failed to resell item', details: err instanceof Error ? err.message : String(err) })
    }
  })

  // GET /resell/:purchaseId - Get purchase details for reselling
  router.get('/:purchaseId', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const { purchaseId } = req.params

    try {
      const result = await withRetry(
        () => pool.query(
          `SELECT ph.id, ph.order_id, ph.listing_id, ph.item_type, ph.item_id,
                  ph.quantity, ph.price_paid, ph.currency, ph.purchase_type,
                  ph.status, ph.purchased_at, ph.metadata, ph.resellable,
                  o.order_number
           FROM shopping.purchase_history ph
           LEFT JOIN shopping.orders o ON ph.order_id = o.id
           WHERE ph.id = $1::uuid AND ph.user_id = $2::uuid`,
          [purchaseId, userId]
        ),
        3,
        'get purchase details for resell'
      )

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Purchase not found' })
      }

      res.json({ purchase: result.rows[0] })
    } catch (err) {
      console.error('[shopping] Get purchase for resell error:', err)
      res.status(500).json({ error: 'Failed to get purchase details' })
    }
  })

  return router
}

