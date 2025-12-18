import express, { type Request, type Response, type NextFunction } from 'express'
import os from 'os'
import { register, httpCounter } from '@common/utils'
import { requireUser, type AuthedRequest } from './lib/auth.js'
import { pool } from './lib/db.js'
import { makeRedis } from './lib/cache.js'
import forumRouter from './routes/forum.js'
import messagesRouter from './routes/messages.js'

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

// Health check with timeout protection
app.get('/healthz', async (_req: Request, res: Response) => {
  const status = {
    ok: true,
    db: 'unknown',
    redis: 'unknown',
    cpu_cores: CPU_CORES,
    timestamp: new Date().toISOString()
  };
  
  // Set timeout for entire health check (max 3 seconds)
  const healthCheckTimeout = setTimeout(() => {
    if (!res.headersSent) {
      status.db = 'timeout';
      status.ok = false;
      res.status(503).json(status);
    }
  }, 3000);
  
  try {
    // Check database (critical) with timeout wrapper
    const dbCheckPromise = pool.query('SELECT 1');
    const dbTimeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('DB query timeout')), 2000)
    );
    
    await Promise.race([dbCheckPromise, dbTimeoutPromise]);
    status.db = 'connected';
  } catch (err) {
    status.db = 'disconnected';
    status.ok = false;
    console.error('[social] DB check failed:', err);
  }
  
  // Check Redis (non-critical) with timeout
  try {
    if (redis) {
      const redisCheckPromise = redis.ping();
      const redisTimeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Redis ping timeout')), 1000)
      );
      status.redis = await Promise.race([redisCheckPromise, redisTimeoutPromise]) as string;
    } else {
      status.redis = 'disabled';
    }
  } catch (err) {
    status.redis = 'error';
    // Don't fail health check if Redis is down (non-critical)
    console.warn('[social] Redis check failed:', err);
  }
  
  clearTimeout(healthCheckTimeout);
  if (!res.headersSent) {
    const httpStatus = status.ok ? 200 : 503;
    res.status(httpStatus).json(status);
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
  import('./grpc-server.js').then(({ startGrpcServer }) => {
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
      try {
        // Use disconnect instead of quit to avoid writeable stream errors
        await redis.disconnect()
        console.log('[social] Redis closed')
      } catch (err) {
        console.warn('[social] Redis disconnect error (non-fatal):', err)
      }
    }
    process.exit(0)
  })
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

