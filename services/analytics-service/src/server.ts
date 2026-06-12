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
  recordsPool,
  listingsPool,
  analyticsPool,
  waitForAnalyticsPools,
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
      // Add connection timeout (match Kafka's 3s connectionTimeout)
      await Promise.race([
        kafkaProducer.connect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Kafka connection timeout')), 5000)
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
let dbHealthCache = { records: true, listings: true, analytics: true, lastCheck: 0 }
const DB_HEALTH_CACHE_TTL = 5000 // 5 seconds

// Background health check (non-blocking)
setInterval(async () => {
  try {
    await Promise.all([
      recordsPool.query('SELECT 1').catch(() => ({ rows: [] })),
      listingsPool.query('SELECT 1').catch(() => ({ rows: [] })),
      analyticsPool.query('SELECT 1').catch(() => ({ rows: [] }))
    ])
    dbHealthCache = { records: true, listings: true, analytics: true, lastCheck: Date.now() }
  } catch {
    dbHealthCache = { records: false, listings: false, analytics: false, lastCheck: Date.now() }
  }
}, DB_HEALTH_CACHE_TTL)

app.get('/healthz', async (_req, res) => {
  try {
    // Use cached health status for fast response (<10ms instead of 1s+)
    const age = Date.now() - dbHealthCache.lastCheck
    if (age > DB_HEALTH_CACHE_TTL * 2) {
      // Cache too old, do quick check (but don't wait for both)
      Promise.all([
        recordsPool.query('SELECT 1').catch(() => null),
        listingsPool.query('SELECT 1').catch(() => null),
        analyticsPool.query('SELECT 1').catch(() => null)
      ]).then(() => {
        dbHealthCache = { records: true, listings: true, analytics: true, lastCheck: Date.now() }
      })
    }
    
    res.json({ 
      ok: dbHealthCache.records && dbHealthCache.listings && dbHealthCache.analytics, 
      db: dbHealthCache.records && dbHealthCache.listings && dbHealthCache.analytics ? 'connected' : 'checking',
      records: dbHealthCache.records ? 'ok' : 'checking',
      listings: dbHealthCache.listings ? 'ok' : 'checking',
      analytics: dbHealthCache.analytics ? 'ok' : 'checking',
      cacheAge: age
    })
  } catch (err) {
    res.status(503).json({ ok: false, db: 'disconnected', error: String(err) })
  }
})

// Kubelet readiness (infra/contracts: readyPath /readyz) — DB + local mTLS gRPC.
app.get('/readyz', async (_req, res) => {
  const { rpCheckLocalGrpcMtlsHealth, rpGrpcHealthOptions } = await import('@common/utils')
  const url =
    process.env.POSTGRES_URL_ANALYTICS || process.env.DATABASE_URL || ''
  if (!url) {
    return res.status(503).json({ ok: false, ready: false, error: 'POSTGRES_URL_ANALYTICS unset' })
  }
  const { Client } = await import('pg')
  const client = new Client({ connectionString: url })
  let dbOk = false
  try {
    await client.connect()
    await client.query('SELECT 1')
    dbOk = true
  } catch (err) {
    await client.end().catch(() => {})
    return res.status(503).json({ ok: false, ready: false, error: String(err) })
  } finally {
    await client.end().catch(() => {})
  }
  const grpcOpts = rpGrpcHealthOptions('analytics-service', 'analytics.AnalyticsService')
  let grpcOk = true
  if (grpcOpts) {
    grpcOk = await rpCheckLocalGrpcMtlsHealth({
      port: grpcOpts.port,
      grpcService: grpcOpts.grpcService,
      serverName: grpcOpts.serverName ?? 'analytics-service',
    })
  }
  const ready = dbOk && grpcOk
  res.status(ready ? 200 : 503).json({
    ok: ready,
    ready,
    grpc: grpcOk ? 'SERVING' : grpcOpts ? 'fail' : 'skip',
  })
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

  if (!recordsPool) {
    console.error('[analytics] log-search: records pool not available')
    return res.status(503).json({
      ok: false,
      logged: false,
      error: 'service_unavailable',
      error_code: 'records_pool_unavailable',
      message: 'Records DB pool not available',
      hint: 'Check POSTGRES_URL_RECORDS and that analytics-service can reach records DB (port 5433).',
    })
  }

  const uid = (userId && userId !== 'null' && String(userId).trim()) ? userId : null
  let logged = false
  const isConnectionError = (e: any) => {
    const code = e?.code ?? ''
    const msg = (e?.message ?? String(e)).toLowerCase()
    return code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' ||
      /connection refused|timeout|connect econnrefused|getaddrinfo/.test(msg)
  }
  let err: any = null
  try {
    await logSearch(uid, source, query, results ?? null)
    logged = true
  } catch (e: any) {
    err = e
    // One retry on connection errors (pod→DB transient)
    if (isConnectionError(e)) {
      await new Promise((r) => setTimeout(r, 500))
      try {
        await logSearch(uid, source, query, results ?? null)
        logged = true
      } catch (retryErr: any) {
        err = retryErr
      }
    }
  }
  if (!logged && err) {
    const errCode = err?.code ?? 'DB_ERROR'
    // FK violation: user_id references auth.users(id) on records DB; test user may exist only in auth DB (5437)
    if (errCode === '23503' && uid) {
      try {
        await logSearch(null, source, query, results ?? null)
        logged = true
      } catch (retryErr: any) {
        const rMsg = retryErr?.message ?? String(retryErr)
        console.error('[analytics] log search retry (without user_id) failed:', rMsg)
        const rCode = retryErr?.code ?? 'DB_ERROR'
        const rHint =
          rCode === '42P01' || /relation .* does not exist/i.test(rMsg)
            ? 'listings.search_history missing: run 03-database.sql against records DB (port 5433).'
            : /ECONNREFUSED|timeout|connection/i.test(rMsg)
              ? 'Cannot reach records DB: check POSTGRES_URL_RECORDS and pod→host.docker.internal:5433.'
              : 'Check POSTGRES_URL_RECORDS and that listings.search_history exists on records DB (port 5433).'
        return res.status(200).json({
          ok: true,
          logged: false,
          error: 'db_write_failed',
          error_code: rCode,
          message: rMsg,
          hint: rHint,
        })
      }
    } else {
      const msg = err?.message ?? String(err)
      console.error('[analytics] log search DB error:', errCode, msg)
      const hint =
        errCode === '42P01' || /relation .* does not exist/i.test(msg)
          ? 'listings.search_history missing: run 03-database.sql against records DB (port 5433).'
          : /ECONNREFUSED|timeout|connection/i.test(msg)
            ? 'Cannot reach records DB: check POSTGRES_URL_RECORDS and pod→host.docker.internal:5433.'
            : 'Check POSTGRES_URL_RECORDS and that listings.search_history exists on records DB (port 5433).'
      return res.status(200).json({
        ok: true,
        logged: false,
        error: 'db_write_failed',
        error_code: errCode,
        message: msg,
        hint,
      })
    }
  }

  try {
    await publishAnalyticsEvent('analytics-searches', {
      event_type: 'search_logged',
      user_id: userId || null,
      source,
      query,
      results_count: Array.isArray(results) ? results.length : (typeof results === 'number' ? results : 0),
    })
  } catch (_) {
    // publishAnalyticsEvent already catches; ignore any unexpected throw
  }

  res.json({ ok: true, logged: true })
})

// Fuzzy search across multiple data sources (data science core)
// This endpoint combs through search history, price snapshots, and listings
// Each source is queried independently so missing tables/extensions in one DB don't cause 500
app.get('/analytics/fuzzy-search', async (req, res) => {
  const query = req.query.q as string
  const userId = req.query.userId as string | undefined
  const limit = parseInt(req.query.limit as string) || 20

  if (!query || query.length < 2) {
    return res.status(400).json({ error: 'query parameter required (min 2 chars)' })
  }

  const similarSearches: Awaited<ReturnType<typeof getSimilarSearches>> = []
  let priceMatches: { rows: Array<{ artist: string; name: string; format: string | null; median_price: number | null; sample_count: number; snap_date: Date }> } = { rows: [] }
  let searchHistory: { rows: Array<{ q: string; source: string; count: number; last_searched: Date }> } = { rows: [] }

  try {
    const [similarRes, priceRes, historyRes] = await Promise.allSettled([
      getSimilarSearches(query, userId, limit),
      analyticsPool.query(
        `SELECT artist, name, format, median_price, sample_count, snap_date
         FROM analytics.price_snapshots
         WHERE artist % $1 OR name % $1
         ORDER BY similarity(artist, $1) + similarity(name, $1) DESC
         LIMIT $2`,
        [query, limit]
      ),
      recordsPool.query(
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

    if (similarRes.status === 'fulfilled' && Array.isArray(similarRes.value)) similarSearches.push(...similarRes.value)
    else if (similarRes.status === 'rejected') console.warn('[analytics] fuzzy-search getSimilarSearches failed:', similarRes.reason?.message)
    if (priceRes.status === 'fulfilled' && priceRes.value?.rows) priceMatches = priceRes.value
    else if (priceRes.status === 'rejected') console.warn('[analytics] fuzzy-search price_snapshots failed:', priceRes.reason?.message)
    if (historyRes.status === 'fulfilled' && historyRes.value?.rows) searchHistory = historyRes.value
    else if (historyRes.status === 'rejected') console.warn('[analytics] fuzzy-search search_history failed:', historyRes.reason?.message)
  } catch (err: any) {
    console.error('[analytics] fuzzy search error:', err)
    return res.status(500).json({
      error: 'Internal server error',
      error_code: 'FUZZY_SEARCH_ERROR',
      message: err?.message ?? String(err),
      hint: 'Check POSTGRES_URL_RECORDS and POSTGRES_URL_ANALYTICS; ensure listings.search_history and analytics.price_snapshots exist; pg_trgm extension on records DB.',
    })
  }

  const count = similarSearches.length + priceMatches.rows.length + searchHistory.rows.length
  res.json({
    query,
    results: {
      similarSearches,
      priceMatches: priceMatches.rows,
      searchHistory: searchHistory.rows,
    },
    count,
  })
})

// T15.4A — owner-scoped AI feature projections
app.get('/analytics/ai/features/:userId', async (req, res) => {
  try {
    const callerId = (req.headers['x-user-id'] as string | undefined)?.trim()
    const { userId } = req.params
    if (callerId && callerId !== userId) {
      return res.status(403).json({ error: 'forbidden', error_code: 'OWNER_SCOPE' })
    }
    const {
      computeUserAiFeatures,
      upsertUserAiFeatures,
      getUserAiFeatures,
    } = await import('./lib/ai-feature-pipeline.js')
    const { insertAiInsightOutbox, publishAnalyticsOutboxTick } = await import('./lib/analytics-ai-outbox.js')
    const computed = await computeUserAiFeatures(userId, {
      listings: listingsPool,
      records: recordsPool,
      analytics: analyticsPool,
    })
    await upsertUserAiFeatures(analyticsPool, userId, computed)
    const features = await getUserAiFeatures(analyticsPool, userId)
    const allRefs = features.flatMap((f) => f.source_refs || [])
    if (allRefs.length > 0) {
      const client = await analyticsPool.connect()
      try {
        await client.query('BEGIN')
        await insertAiInsightOutbox(client, {
          userId,
          contractId: 'buyer_collection_summary',
          sourceRefs: allRefs,
          metrics: { feature_groups: features.map((f) => f.feature_group) },
        })
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined)
        console.warn('[analytics] ai insight outbox insert failed:', (e as Error).message)
      } finally {
        client.release()
      }
      await publishAnalyticsOutboxTick(analyticsPool).catch(() => 0)
    }
    return res.json({
      user_id: userId,
      feature_count: features.length,
      features,
      source_refs: allRefs,
      source_status: allRefs.length > 0 ? 'live' : 'degraded',
    })
  } catch (err: any) {
    console.error('[analytics] ai features error:', err)
    return res.status(500).json({ error: 'ai_features_failed', message: err?.message ?? String(err) })
  }
})

let server: ReturnType<typeof app.listen> | null = null
let grpcServer: any = null

async function main() {
  await waitForAnalyticsPools()

  const PORT = process.env.ANALYTICS_PORT || process.env.HTTP_PORT || 4004
  if (process.env.ENABLE_GRPC === 'true') {
    const { startGrpcServer } = require('./grpc-server')
    const grpcPort = parseInt(process.env.GRPC_PORT || '50067', 10)
    grpcServer = startGrpcServer(grpcPort)
  }
  server = app.listen(PORT, () => {
    console.log(`[analytics] service listening on port ${PORT}`)
  })
}

main().catch((err) => {
  console.error('[analytics] startup failed:', err)
  process.exit(1)
})

process.on('SIGTERM', async () => {
  console.log('[analytics] SIGTERM received, shutting down gracefully')
  if (!server) {
    process.exit(0)
    return
  }
  server.close(async () => {
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
        Promise.all([recordsPool.end(), listingsPool.end(), analyticsPool.end()]).then(() => {
          console.log('[analytics] DB pools closed')
          process.exit(0)
        })
      })
    } else {
      Promise.all([recordsPool.end(), listingsPool.end(), analyticsPool.end()]).then(() => {
        console.log('[analytics] DB pools closed')
        process.exit(0)
      })
    }
  })
})
