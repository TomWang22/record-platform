import { Router, type Response, type Router as ExpressRouter } from 'express'
import type Redis from 'ioredis'
import type { AuthedRequest } from '../lib/auth.js'
import { pool, withRetry } from '../lib/db.js'
import { CacheManager } from '../lib/cache.js'

interface RecommendationItem {
  item_id: string
  item_type: string
  score: number
  reason: string
  metadata?: any
}

interface RecommendationResult {
  items: RecommendationItem[]
  total: number
  sources: {
    from_searches: number
    from_viewed: number
    from_purchases: number
    from_trending: number
  }
}

export default function recommendationsRouter(
  redis: Redis | null,
  cacheManager: CacheManager
): ExpressRouter {
  const router: Router = Router()

  // GET /recommendations - Get personalized recommendations
  router.get('/', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const limit = parseInt(req.query.limit as string) || 20
    const itemType = req.query.item_type as string | undefined

    try {
      // Check cache first
      const cacheKey = `recommendations:${userId}:${itemType || 'all'}:${limit}`
      const cached = await cacheManager.get<RecommendationResult>(cacheKey)
      if (cached) {
        return res.json(cached)
      }

      const recommendations = await generateRecommendations(userId, limit, itemType)

      // Cache for 1 hour
      await cacheManager.set(cacheKey, recommendations, 3600)

      res.json(recommendations)
    } catch (err) {
      console.error('[shopping] Get recommendations error:', err)
      res.status(500).json({ error: 'Failed to get recommendations' })
    }
  })

  // GET /recommendations/similar/:item_type/:item_id - Get similar items
  router.get('/similar/:item_type/:item_id', async (req: AuthedRequest, res: Response) => {
    const userId = req.user?.sub
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' })
    }

    const { item_type, item_id } = req.params
    const limit = parseInt(req.query.limit as string) || 10

    try {
      // Check cache first
      const cacheKey = `recommendations:similar:${item_type}:${item_id}:${limit}`
      const cached = await cacheManager.get<RecommendationItem[]>(cacheKey)
      if (cached) {
        return res.json({ items: cached })
      }

      const similarItems = await getSimilarItems(item_type, item_id, limit)

      // Cache for 30 minutes
      await cacheManager.set(cacheKey, similarItems, 1800)

      res.json({ items: similarItems })
    } catch (err) {
      console.error('[shopping] Get similar items error:', err)
      res.status(500).json({ error: 'Failed to get similar items' })
    }
  })

  return router
}

/**
 * Generate personalized recommendations based on:
 * 1. User's search history (extract keywords/artists)
 * 2. Recently viewed items (items they've shown interest in)
 * 3. Purchase history (similar items to what they've bought)
 * 4. Trending searches (popular items)
 */
async function generateRecommendations(
  userId: string,
  limit: number,
  itemType?: string
): Promise<RecommendationResult> {
  const recommendations = new Map<string, RecommendationItem>()
  const sources = {
    from_searches: 0,
    from_viewed: 0,
    from_purchases: 0,
    from_trending: 0,
  }

  // 1. Based on search history - extract keywords and find similar items
  try {
    const searchHistory = await withRetry(
      () => pool.query(
        `SELECT DISTINCT query, query_type, clicked_item
         FROM shopping.search_history
         WHERE user_id = $1
           AND searched_at >= now() - interval '30 days'
           ${itemType ? `AND query_type = $2` : ''}
         ORDER BY searched_at DESC
         LIMIT 50`,
        itemType ? [userId, itemType] : [userId]
      ),
      3,
      'get search history for recommendations'
    )

    if (searchHistory.rows.length > 0) {
      // Extract common keywords from searches
      const searchTerms = new Set<string>()
      searchHistory.rows.forEach((row) => {
        const terms = row.query.toLowerCase().split(/\s+/).filter((t: string) => t.length > 2)
        terms.forEach((term: string) => searchTerms.add(term))
      })

      // Find items matching search terms (this would typically query listings/records service)
      // For now, we'll use clicked items as recommendations
      searchHistory.rows.forEach((row) => {
        if (row.clicked_item) {
          const key = `${row.query_type}:${row.clicked_item}`
          if (!recommendations.has(key)) {
            recommendations.set(key, {
              item_id: row.clicked_item,
              item_type: row.query_type,
              score: 0.8, // High score for clicked items
              reason: `Based on your search: "${row.query}"`,
            })
            sources.from_searches++
          }
        }
      })
    }
  } catch (err) {
    console.error('[shopping] Error processing search history:', err)
  }

  // 2. Based on recently viewed items - recommend similar items
  try {
    const recentlyViewed = await withRetry(
      () => pool.query(
        `SELECT DISTINCT item_type, item_id, metadata
         FROM shopping.recently_viewed
         WHERE user_id = $1
           AND viewed_at >= now() - interval '7 days'
           ${itemType ? `AND item_type = $2` : ''}
         ORDER BY viewed_at DESC
         LIMIT 20`,
        itemType ? [userId, itemType] : [userId]
      ),
      3,
      'get recently viewed for recommendations'
    )

    recentlyViewed.rows.forEach((row) => {
      const key = `${row.item_type}:${row.item_id}`
      if (!recommendations.has(key)) {
        recommendations.set(key, {
          item_id: row.item_id,
          item_type: row.item_type,
          score: 0.7, // Good score for viewed items
          reason: 'Based on items you recently viewed',
          metadata: row.metadata,
        })
        sources.from_viewed++
      } else {
        // Boost score if also viewed
        const existing = recommendations.get(key)!
        existing.score = Math.min(1.0, existing.score + 0.1)
        existing.reason = `${existing.reason} (also viewed)`
      }
    })
  } catch (err) {
    console.error('[shopping] Error processing recently viewed:', err)
  }

  // 3. Based on purchase history - recommend similar items
  try {
    const purchases = await withRetry(
      () => pool.query(
        `SELECT DISTINCT item_type, item_id, metadata
         FROM shopping.purchase_history
         WHERE user_id = $1
           AND purchased_at >= now() - interval '90 days'
           ${itemType ? `AND item_type = $2` : ''}
         ORDER BY purchased_at DESC
         LIMIT 10`,
        itemType ? [userId, itemType] : [userId]
      ),
      3,
      'get purchase history for recommendations'
    )

    // Extract metadata to find similar items (artist, genre, etc.)
    purchases.rows.forEach((row) => {
      const key = `${row.item_type}:${row.item_id}`
      if (!recommendations.has(key)) {
        recommendations.set(key, {
          item_id: row.item_id,
          item_type: row.item_type,
          score: 0.6, // Moderate score for purchased items (they already have it)
          reason: 'Similar to items you purchased',
          metadata: row.metadata,
        })
        sources.from_purchases++
      }
    })
  } catch (err) {
    console.error('[shopping] Error processing purchase history:', err)
  }

  // 4. Based on trending searches - popular items
  try {
    const trending = await withRetry(
      () => pool.query(
        `SELECT query, query_type, COUNT(*) as count
         FROM shopping.search_history
         WHERE searched_at >= now() - interval '7 days'
           ${itemType ? `AND query_type = $1` : ''}
         GROUP BY query, query_type
         ORDER BY count DESC
         LIMIT 10`,
        itemType ? [itemType] : []
      ),
      3,
      'get trending searches for recommendations'
    )

    // Add trending items (lower priority, but fills gaps)
    trending.rows.forEach((row, index) => {
      // Use query as a recommendation hint (would need to resolve to actual items)
      // For now, we'll just note that trending data is available
      // In a real implementation, you'd query listings/records service with these queries
      sources.from_trending = trending.rows.length
    })
  } catch (err) {
    console.error('[shopping] Error processing trending searches:', err)
  }

  // Sort by score and return top N
  const sorted = Array.from(recommendations.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  return {
    items: sorted,
    total: sorted.length,
    sources,
  }
}

/**
 * Get recommendations based on a specific item (item-based collaborative filtering)
 * GET /recommendations/similar/:item_type/:item_id
 */
export async function getSimilarItems(
  itemType: string,
  itemId: string,
  limit: number = 10
): Promise<RecommendationItem[]> {
  try {
    // Find users who viewed/purchased this item
    const similarUsers = await withRetry(
      () => pool.query(
        `SELECT DISTINCT user_id
         FROM (
           SELECT user_id FROM shopping.recently_viewed WHERE item_type = $1 AND item_id = $2
           UNION
           SELECT user_id FROM shopping.purchase_history WHERE item_type = $1 AND item_id = $2
         ) AS users
         LIMIT 100`,
        [itemType, itemId]
      ),
      3,
      'get similar users'
    )

    if (similarUsers.rows.length === 0) {
      return []
    }

    const userIds = similarUsers.rows.map((row) => row.user_id)

    // Find items those users also viewed/purchased
    const similarItems = await withRetry(
      () => pool.query(
        `SELECT item_type, item_id, COUNT(*) as count
         FROM (
           SELECT item_type, item_id FROM shopping.recently_viewed
           WHERE user_id = ANY($1::uuid[]) AND (item_type != $2 OR item_id != $3)
           UNION ALL
           SELECT item_type, item_id FROM shopping.purchase_history
           WHERE user_id = ANY($1::uuid[]) AND (item_type != $2 OR item_id != $3)
         ) AS items
         GROUP BY item_type, item_id
         ORDER BY count DESC
         LIMIT $4`,
        [userIds, itemType, itemId, limit]
      ),
      3,
      'get similar items'
    )

    return similarItems.rows.map((row) => ({
      item_id: row.item_id,
      item_type: row.item_type,
      score: Math.min(1.0, parseFloat(row.count) / 10), // Normalize score
      reason: `Users who viewed "${itemId}" also viewed this`,
    }))
  } catch (err) {
    console.error('[shopping] Error getting similar items:', err)
    return []
  }
}

