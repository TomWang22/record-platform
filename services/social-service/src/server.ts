import express, { type Request, type Response, type NextFunction } from 'express'
import os from 'os'
import { register, httpCounter } from '@common/utils/metrics'
import { requireUser, type AuthedRequest } from './lib/auth'
import { pool } from './lib/db'
import { makeRedis } from './lib/cache'
import forumRouter from './routes/forum'
import messagesRouter from './routes/messages'

const app = express()
app.use(express.json())

// --- Redis (for cache) ---
const redis = makeRedis()

// CPU cores for worker threads
const CPU_CORES = os.cpus().length
console.log(`[social] Using ${CPU_CORES} CPU cores for parallel processing`)

// Metrics middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  res.on('finish', () =>
    httpCounter.inc({
      service: 'social',
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

// Forum routes (require auth) - pass redis for caching
app.use('/forum', requireUser, forumRouter(redis, CPU_CORES))

// Messages routes (require auth) - pass redis for caching
app.use('/messages', requireUser, messagesRouter(redis, CPU_CORES))

// Error handler
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error('[social] service error:', msg)
  if (!res.headersSent) {
    res.status(500).json({ error: 'internal server error' })
  }
})

// Start HTTP server
const PORT = process.env.SOCIAL_PORT || 4006
const server = app.listen(PORT, () => {
  console.log(`[social] HTTP server listening on port ${PORT}`)
})

// Start gRPC server
if (process.env.ENABLE_GRPC !== 'false') {
  import('./grpc-server').then(({ startGrpcServer }) => {
    const grpcPort = parseInt(process.env.GRPC_PORT || '50056', 10)
    startGrpcServer(grpcPort)
  }).catch((e) => {
    console.error('[social] Failed to start gRPC server:', e)
  })
}

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`[social] received ${signal}, shutting down gracefully`)
  server.close(async () => {
    pool.end(() => {
      console.log('[social] DB pool closed')
    })
    if (redis) {
      await redis.quit()
      console.log('[social] Redis closed')
    }
    process.exit(0)
  })
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

