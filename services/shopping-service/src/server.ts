import express, { type Request, type Response, type NextFunction } from 'express'
import os from 'os'
import { register, httpCounter } from '@common/utils/metrics'
import { requireUser, type AuthedRequest } from './lib/auth'
import { pool } from './lib/db'
import { makeRedis, CacheManager } from './lib/cache'
import cartRouter from './routes/cart'
import watchlistRouter from './routes/watchlist'
import recentlyViewedRouter from './routes/recently-viewed'
import wishlistRouter from './routes/wishlist'
import historyRouter from './routes/history'

const app = express()
app.use(express.json())

// --- Redis (for cache) ---
const redis = makeRedis()
const cacheManager = new CacheManager(redis)

// CPU cores for worker threads
const CPU_CORES = os.cpus().length
console.log(`[shopping] Using ${CPU_CORES} CPU cores for parallel processing`)

// Metrics middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  res.on('finish', () =>
    httpCounter.inc({
      service: 'shopping',
      route: req.path,
      method: req.method,
      code: res.statusCode,
    })
  )
  next()
})

// Health check
app.get('/healthz', async (_req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1')
    let r = 'skipped'
    try {
      r = redis ? await redis.ping() : 'disabled'
    } catch {
      r = 'error'
    }
    res.json({ ok: true, db: 'connected', redis: r, cpu_cores: CPU_CORES })
  } catch (err) {
    res.status(503).json({ ok: false, db: 'disconnected', error: String(err) })
  }
})

// Metrics endpoint
app.get('/metrics', async (_req: Request, res: Response) => {
  res.setHeader('Content-Type', register.contentType)
  res.end(await register.metrics())
})

// Routes (require auth) - pass redis and cacheManager
app.use('/cart', requireUser, cartRouter(redis, cacheManager))
app.use('/watchlist', requireUser, watchlistRouter(redis, cacheManager))
app.use('/recently-viewed', requireUser, recentlyViewedRouter(redis, cacheManager))
app.use('/wishlist', requireUser, wishlistRouter(redis, cacheManager))
app.use('/history', requireUser, historyRouter(redis, cacheManager))

// Error handler
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error('[shopping] service error:', msg)
  if (!res.headersSent) {
    res.status(500).json({ error: 'internal server error' })
  }
})

// Start HTTP server
const PORT = process.env.SHOPPING_PORT || 4007
const server = app.listen(PORT, () => {
  console.log(`[shopping] HTTP server listening on port ${PORT}`)
})

// Start gRPC server
if (process.env.ENABLE_GRPC !== 'false') {
  import('./grpc-server').then(({ startGrpcServer }) => {
    const grpcPort = parseInt(process.env.GRPC_PORT || '50058', 10)
    startGrpcServer(grpcPort)
  }).catch((e) => {
    console.error('[shopping] Failed to start gRPC server:', e)
  })
}

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`[shopping] received ${signal}, shutting down gracefully`)
  server.close(async () => {
    pool.end(() => {
      console.log('[shopping] DB pool closed')
    })
    if (redis) {
      await redis.quit()
      console.log('[shopping] Redis closed')
    }
    process.exit(0)
  })
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

