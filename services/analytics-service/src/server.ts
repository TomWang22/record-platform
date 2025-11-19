import express from 'express'
import os from 'os'
import { Worker } from 'worker_threads'
import path from 'path'
import { register, httpCounter } from '@common/utils/metrics'
import {
  pool,
  getUserSearchHistory,
  getSimilarSearches,
  getTrendingSearches,
  getPriceTrend,
  getHistoricalAveragePrice,
  logSearch,
} from './db'

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

app.get('/healthz', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ ok: true, db: 'connected' })
  } catch (err) {
    res.status(503).json({ ok: false, db: 'disconnected', error: String(err) })
  }
})

// Enhanced predict-price: uses historical data + worker threads
app.post('/analytics/predict-price', async (req, res) => {
  const items = (req.body?.items as any[]) ?? []
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items required' })
  }

  try {
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
    res.json({ suggested: Math.round(avg * 100) / 100, samples: flat.length })
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
    res.json({ ok: true, logged: true })
  } catch (err) {
    console.error('[analytics] log search error:', err)
    res.status(500).json({ error: 'Internal server error', details: String(err) })
  }
})

const PORT = process.env.ANALYTICS_PORT || 4004
const server = app.listen(PORT, () => {
  console.log(`[analytics] service listening on port ${PORT}`)
})

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[analytics] SIGTERM received, shutting down gracefully')
  server.close(() => {
    pool.end(() => {
      console.log('[analytics] DB pool closed')
      process.exit(0)
    })
  })
})
