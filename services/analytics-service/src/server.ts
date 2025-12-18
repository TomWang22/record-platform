// Load environment variables from .env file if it exists
try {
  require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
} catch (e) {
  // dotenv not installed or .env not found, continue without it
}

import express from 'express'
import os from 'os'
import { Worker } from 'worker_threads'
import path from 'path'
import crypto from 'crypto'
import { register, httpCounter } from '@common/utils'
import { kafka } from '@common/utils/kafka'
import { getRedis } from '@common/utils/redis'
import {
  pool,
  listingsPool,
  analyticsPool,
  getUserSearchHistory,
  getSimilarSearches,
  getTrendingSearches,
  getPriceTrend,
  getHistoricalAveragePrice,
  logSearch,
} from "./db.js";

// Kafka producer for real-time analytics events (optional - fails gracefully if Kafka is unavailable)
let kafkaProducer: any = null
let kafkaConnectionFailed = false
async function getKafkaProducer() {
  if (kafkaConnectionFailed) {
    return null // Don't retry if we've already failed
  }
  if (!kafkaProducer) {
    try {
      kafkaProducer = kafka.producer()
      // Add connection timeout
      await Promise.race([
        kafkaProducer.connect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Kafka connection timeout')), 2000)
        )
      ])
    } catch (err) {
      console.warn('[analytics] Kafka producer connection failed (non-fatal):', (err as Error)?.message || err)
      kafkaConnectionFailed = true
      kafkaProducer = null
      return null
    }
  }
  return kafkaProducer
}

// Helper to publish analytics events to Kafka
async function publishAnalyticsEvent(topic: string, event: any) {
  try {
    const producer = await getKafkaProducer()
    if (producer) {
      await producer.send({
        topic,
        messages: [
          {
            key: event.record_id || event.query || event.user_id || 'analytics',
            value: JSON.stringify({
              ...event,
              timestamp: new Date().toISOString(),
            }),
          },
        ],
      })
    }
  } catch (err) {
    console.warn('[analytics] Kafka publish failed (non-fatal):', err)
  }
}

const app = express()
app.use(express.json())
app.use((req, res, next) => {
  res.on('finish', () =>
    httpCounter.inc({ service: 'analytics', route: req.path, method: req.method, code: res.statusCode })
  )
  next()
})

app.get('/metrics', async (_req, res) => {
  res.setHeader('Content-Type', register.contentType)
  res.end(await register.metrics())
})

// Cache DB health status to avoid blocking health checks
let dbHealthCache = { listings: true, analytics: true, lastCheck: 0 }
const DB_HEALTH_CACHE_TTL = 5000 // 5 seconds

// Background health check (non-blocking)
setInterval(async () => {
  try {
    await Promise.all([
      listingsPool.query('SELECT 1').catch(() => ({ rows: [] })),
      analyticsPool.query('SELECT 1').catch(() => ({ rows: [] }))
    ])
    dbHealthCache = { listings: true, analytics: true, lastCheck: Date.now() }
  } catch {
    dbHealthCache = { listings: false, analytics: false, lastCheck: Date.now() }
  }
}, DB_HEALTH_CACHE_TTL)

app.get('/healthz', async (_req, res) => {
  try {
    // Use cached health status for fast response (<10ms instead of 1s+)
    const age = Date.now() - dbHealthCache.lastCheck
    if (age > DB_HEALTH_CACHE_TTL * 2) {
      // Cache too old, do quick check (but don't wait for both)
      Promise.all([
        listingsPool.query('SELECT 1').catch(() => null),
        analyticsPool.query('SELECT 1').catch(() => null)
      ]).then(() => {
        dbHealthCache = { listings: true, analytics: true, lastCheck: Date.now() }
      })
    }
    
    res.json({ 
      ok: dbHealthCache.listings && dbHealthCache.analytics, 
      db: dbHealthCache.listings && dbHealthCache.analytics ? 'connected' : 'checking',
      listings: dbHealthCache.listings ? 'ok' : 'checking',
      analytics: dbHealthCache.analytics ? 'ok' : 'checking',
      cacheAge: age
    })
  } catch (err) {
    res.status(503).json({ ok: false, db: 'disconnected', error: String(err) })
  }
})

// Enhanced predict-price: uses historical data + worker threads + Redis caching
app.post('/analytics/predict-price', async (req, res) => {
  const items = (req.body?.items as any[]) ?? []
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items required' })
  }

  try {
    // Generate cache key from items (hash of sorted items for consistency)
    const cacheKey = `analytics:predict-price:${crypto
      .createHash('sha256')
      .update(JSON.stringify(items.sort((a, b) => (a.query || '').localeCompare(b.query || ''))))
      .digest('hex')
      .substring(0, 16)}`
    
    // Try to get from cache first (TTL: 10 minutes = 600 seconds)
    try {
      const redis = getRedis()
      const cached = await redis.get(cacheKey)
      if (cached) {
        const cachedResult = JSON.parse(cached)
        console.log(`[analytics] Cache hit for predict-price (${items.length} items)`)
        return res.json(cachedResult)
      }
    } catch (cacheErr) {
      // Cache miss or error - continue with computation (non-fatal)
      console.debug('[analytics] Cache miss or error, computing prediction:', (cacheErr as Error)?.message)
    }

    // Try to enrich with historical prices
    const enriched = await Promise.all(
      items.map(async (item: any) => {
        if (item.query) {
          // Extract artist/name from query (simple heuristic)
          const parts = item.query.split(/\s+/)
          if (parts.length >= 2) {
            const artist = parts[0]
            const name = parts.slice(1).join(' ')
            const historical = await getHistoricalAveragePrice(artist, name, item.format)
            if (historical && historical > 0) {
              return { ...item, base_price: item.base_price || historical }
            }
          }
        }
        return item
      })
    )

    // Worker thread processing (existing logic)
    const cores = os.cpus().length
    const chunkSize = Math.ceil(enriched.length / cores)
    const chunks = Array.from({ length: cores }, (_, i) =>
      enriched.slice(i * chunkSize, (i + 1) * chunkSize)
    ).filter((c) => c.length)

    const results = await Promise.all(
      chunks.map(
        (c) =>
          new Promise<number[]>((resolve, reject) => {
            const w = new Worker(path.join(__dirname, 'worker.js'), { workerData: { items: c } })
            w.on('message', (m) => resolve(m))
            w.on('error', reject)
          })
      )
    )

    const flat = results.flat()
    const avg = flat.length > 0 ? flat.reduce((a, b) => a + b, 0) / flat.length : 0
    const result = { suggested: Math.round(avg * 100) / 100, samples: flat.length }
    
    // Cache the result (TTL: 10 minutes = 600 seconds)
    try {
      const redis = getRedis()
      await redis.set(cacheKey, JSON.stringify(result), 'EX', 600)
      console.log(`[analytics] Cached predict-price result (${items.length} items)`)
    } catch (cacheErr) {
      // Cache write failed - non-fatal, continue
      console.debug('[analytics] Cache write failed (non-fatal):', (cacheErr as Error)?.message)
    }
    
    // Publish prediction event to Kafka
    await publishAnalyticsEvent('analytics-predictions', {
      event_type: 'price_prediction',
      items: enriched.map((item: any) => ({
        query: item.query,
        base_price: item.base_price,
        record_grade: item.record_grade,
        sleeve_grade: item.sleeve_grade,
      })),
      suggested_price: result.suggested,
      sample_count: result.samples,
    })
    
    res.json(result)
  } catch (err) {
    console.error('[analytics] predict-price error:', err)
    res.status(500).json({ error: 'Internal server error', details: String(err) })
  }
})

// User search history
app.get('/analytics/user/:userId/history', async (req, res) => {
  const { userId } = req.params
  const limit = parseInt(req.query.limit as string) || 50

  try {
    const history = await getUserSearchHistory(userId, limit)
    res.json({ userId, history, count: history.length })
  } catch (err) {
    console.error('[analytics] user history error:', err)
    res.status(500).json({ error: 'Internal server error', details: String(err) })
  }
})

// Recommendations: similar searches
app.get('/analytics/recommendations/similar', async (req, res) => {
  const query = req.query.q as string
  const userId = req.query.userId as string | undefined
  const limit = parseInt(req.query.limit as string) || 10

  if (!query || query.length < 2) {
    return res.status(400).json({ error: 'query parameter required (min 2 chars)' })
  }

  try {
    const similar = await getSimilarSearches(query, userId, limit)
    res.json({ query, recommendations: similar, count: similar.length })
  } catch (err) {
    console.error('[analytics] similar searches error:', err)
    res.status(500).json({ error: 'Internal server error', details: String(err) })
  }
})

// Trending searches
app.get('/analytics/trending', async (req, res) => {
  const days = parseInt(req.query.days as string) || 7
  const limit = parseInt(req.query.limit as string) || 20

  try {
    const trending = await getTrendingSearches(days, limit)
    res.json({ days, trending, count: trending.length })
  } catch (err) {
    console.error('[analytics] trending error:', err)
    res.status(500).json({ error: 'Internal server error', details: String(err) })
  }
})

// Price trends for a specific record
app.get('/analytics/price-trend', async (req, res) => {
  const artist = req.query.artist as string
  const name = req.query.name as string
  const format = req.query.format as string | undefined
  const days = parseInt(req.query.days as string) || 90

  if (!artist || !name) {
    return res.status(400).json({ error: 'artist and name parameters required' })
  }

  try {
    // TODO: Implement proper query with records.records join
    // For now, return empty array since schema doesn't match
    const trends = await getPriceTrend(artist, name, format, days)
    res.json({ artist, name, format, days, trends, count: trends.length })
  } catch (err) {
    console.error('[analytics] price trend error:', err)
    res.status(500).json({ error: 'Internal server error', details: String(err) })
  }
})

// Log a search (for building history)
app.post('/analytics/log-search', async (req, res) => {
  const { userId, source, query, results } = req.body

  if (!source || !query) {
    return res.status(400).json({ error: 'source and query required' })
  }

  try {
    await logSearch(userId || null, source, query, results || null)
    
    // Publish search event to Kafka
    await publishAnalyticsEvent('analytics-searches', {
      event_type: 'search_logged',
      user_id: userId || null,
      source,
      query,
      results_count: results?.length || 0,
    })
    
    res.json({ ok: true, logged: true })
  } catch (err) {
    console.error('[analytics] log search error:', err)
    res.status(500).json({ error: 'Internal server error', details: String(err) })
  }
})

// Fuzzy search across multiple data sources (data science core)
// This endpoint combs through search history, price snapshots, and listings
app.get('/analytics/fuzzy-search', async (req, res) => {
  const query = req.query.q as string
  const userId = req.query.userId as string | undefined
  const limit = parseInt(req.query.limit as string) || 20

  if (!query || query.length < 2) {
    return res.status(400).json({ error: 'query parameter required (min 2 chars)' })
  }

  try {
    // Search across multiple sources using fuzzy matching
    const [similarSearches, priceMatches, searchHistory] = await Promise.all([
      // Similar searches from search history
      getSimilarSearches(query, userId, limit),
      // Price snapshots matching query (fuzzy artist/name match)
      analyticsPool.query(
        `SELECT artist, name, format, median_price, sample_count, snap_date
         FROM analytics.price_snapshots
         WHERE artist % $1 OR name % $1
         ORDER BY similarity(artist, $1) + similarity(name, $1) DESC
         LIMIT $2`,
        [query, limit]
      ),
      // Recent search history matching query
      listingsPool.query(
        `SELECT q, source, COUNT(*)::int as count, MAX(created_at) as last_searched
         FROM listings.search_history
         WHERE ($3::uuid IS NULL OR user_id = $3)
           AND q % $1
         GROUP BY q, source
         ORDER BY similarity(q, $1) DESC, count DESC
         LIMIT $2`,
        [query, limit, userId || null]
      ),
    ])

    res.json({
      query,
      results: {
        similarSearches: similarSearches,
        priceMatches: priceMatches.rows,
        searchHistory: searchHistory.rows,
      },
      count: similarSearches.length + priceMatches.rows.length + searchHistory.rows.length,
    })
  } catch (err) {
    console.error('[analytics] fuzzy search error:', err)
    res.status(500).json({ error: 'Internal server error', details: String(err) })
  }
})

const PORT = process.env.ANALYTICS_PORT || 4004
const server = app.listen(PORT, () => {
  console.log(`[analytics] service listening on port ${PORT}`)
})

// Start gRPC server if enabled
let grpcServer: any = null
if (process.env.ENABLE_GRPC === 'true') {
  const { startGrpcServer } = require('./grpc-server')
  const grpcPort = parseInt(process.env.GRPC_PORT || '50054', 10)
  grpcServer = startGrpcServer(grpcPort)
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[analytics] SIGTERM received, shutting down gracefully')
  server.close(async () => {
    // Disconnect Kafka producer
    if (kafkaProducer) {
      try {
        await kafkaProducer.disconnect()
        console.log('[analytics] Kafka producer disconnected')
      } catch (err) {
        console.warn('[analytics] Error disconnecting Kafka producer:', err)
      }
    }
    
    if (grpcServer) {
      grpcServer.tryShutdown(() => {
        Promise.all([listingsPool.end(), analyticsPool.end()]).then(() => {
          console.log('[analytics] DB pools closed')
          process.exit(0)
        })
      })
    } else {
      Promise.all([listingsPool.end(), analyticsPool.end()]).then(() => {
        console.log('[analytics] DB pools closed')
        process.exit(0)
      })
    }
  })
})
