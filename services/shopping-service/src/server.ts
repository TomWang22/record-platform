import './otel-bootstrap.js'
import express, { type Request, type Response, type NextFunction } from 'express'
import os from 'os'
import { register, httpCounter, mountRpHttpHealth, rpGrpcHealthOptions, installShutdownSignalHandlers } from '@common/utils'
import { tracingMiddleware } from '@common/utils/otel'

installShutdownSignalHandlers({ service: 'shopping-service' })
import { requireUser, type AuthedRequest } from './lib/auth.js'
import { pool, syncOrderNumberSequence } from './lib/db.js'
import {
  disconnectShoppingOutboxProducer,
  startShoppingOutboxPublisher,
} from './outbox/publishOutbox.js'
import { makeRedis, CacheManager, getCacheStats } from './lib/cache.js'
import cartRouter from './routes/cart.js'
import watchlistRouter from './routes/watchlist.js'
import recentlyViewedRouter from './routes/recently-viewed.js'
import wishlistRouter from './routes/wishlist.js'
import historyRouter from './routes/history.js'
import recommendationsRouter from './routes/recommendations.js'
import resellRouter from './routes/resell.js'
import ordersRouter from './routes/orders.js'
import returnsRouter from './routes/returns.js'
import internalCartRouter from './routes/internal-cart.js'

const app = express()
app.use(express.json())
app.use(tracingMiddleware)

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

mountRpHttpHealth(app, {
  service: 'shopping-service',
  readiness: async () => {
    try {
      await Promise.race([
        pool.query('SELECT 1'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('DB timeout')), 2000)),
      ])
      if (redis) {
        await Promise.race([
          redis.ping(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Redis timeout')), 1000)),
        ])
      }
      return true
    } catch {
      return false
    }
  },
  grpc: rpGrpcHealthOptions('shopping-service', 'shopping.ShoppingService'),
})

// Metrics endpoint
app.get('/metrics', async (_req: Request, res: Response) => {
  res.setHeader('Content-Type', register.contentType)
  res.end(await register.metrics())
})

// Cache statistics endpoint
app.get('/cache/stats', async (_req: Request, res: Response) => {
  try {
    const stats = getCacheStats()
    res.json({
      cache: stats,
      redis: redis ? { connected: redis.status === 'ready' || redis.status === 'connect' } : { connected: false },
    })
  } catch (err: any) {
    res.status(500).json({ error: 'failed to get cache stats', message: err.message })
  }
})

// Internal service-to-service routes (no JWT)
app.use('/internal', internalCartRouter())

// Routes (require auth) - pass redis and cacheManager
app.use('/cart', requireUser, cartRouter(redis, cacheManager))
app.use('/watchlist', requireUser, watchlistRouter(redis, cacheManager))
app.use('/recently-viewed', requireUser, recentlyViewedRouter(redis, cacheManager))
app.use('/wishlist', requireUser, wishlistRouter(redis, cacheManager))
app.use('/history', requireUser, historyRouter(redis, cacheManager))
app.use('/recommendations', requireUser, recommendationsRouter(redis, cacheManager))
app.use('/resell', requireUser, resellRouter(redis, cacheManager))
app.use('/orders', requireUser, ordersRouter(redis, cacheManager))
app.use('/returns', requireUser, returnsRouter(redis, cacheManager))

// Error handler
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error('[shopping] service error:', msg)
  if (!res.headersSent) {
    res.status(500).json({ error: 'internal server error' })
  }
})

// Start HTTP server (sync order_number sequence first so checkout never hits duplicate key after restore)
const PORT = process.env.SHOPPING_PORT || 4007
async function start() {
  await syncOrderNumberSequence()
  // Default OFF: SHOPPING_OUTBOX_PUBLISHER must be exactly "1". Reuse the
  // existing shopping pool — do not open a second pool for the drain.
  startShoppingOutboxPublisher(pool)
  const server = app.listen(PORT, () => {
    console.log(`[shopping] HTTP server listening on port ${PORT}`)
  })
  // Phase 34: publish + normalize SaleCompleted outbox → Kafka + intelligence.*
  import('./lib/sale-completed-outbox-drain.js')
    .then(({ startSaleCompletedOutboxDrain }) => startSaleCompletedOutboxDrain())
    .catch((e) => console.warn('[shopping] SaleCompleted outbox drain not started:', e?.message || e))
  return server
}
let server: ReturnType<typeof app.listen> | undefined
start().then((s) => { server = s }).catch((e) => {
  console.error('[shopping] startup failed:', e)
  process.exit(1)
})

// Start gRPC server
if (process.env.ENABLE_GRPC !== 'false') {
  import('./grpc-server.js').then(({ startGrpcServer }) => {
    const grpcPort = parseInt(process.env.GRPC_PORT || '50058', 10)
    startGrpcServer(grpcPort)
  }).catch((e) => {
    console.error('[shopping] Failed to start gRPC server:', e)
  })
}

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`[shopping] received ${signal}, shutting down gracefully`)
  const close = (typeof server !== 'undefined' && server)
    ? server.close.bind(server)
    : (cb: () => void) => setImmediate(cb)
  close(async () => {
    try {
      await disconnectShoppingOutboxProducer()
    } catch {
      /* ignore */
    }
    try {
      const { stopSaleCompletedOutboxDrain } = await import('./lib/sale-completed-outbox-drain.js')
      await stopSaleCompletedOutboxDrain()
    } catch {
      /* ignore */
    }
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

