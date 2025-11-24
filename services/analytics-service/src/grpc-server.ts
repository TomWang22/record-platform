/* cspell:ignore grpc */
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import * as path from 'path'
import * as fs from 'fs'
import os from 'os'
import { Worker } from 'worker_threads'
import {
  pool,
  getUserSearchHistory,
  getSimilarSearches,
  getTrendingSearches,
  getPriceTrend,
  getHistoricalAveragePrice,
  logSearch,
} from './db.js''

// Load proto file (try both relative paths for dev vs production, and K8s mount)
function findProtoPath(): string {
  const paths = [
    '/app/proto/analytics.proto',
    path.join(__dirname, '../../proto/analytics.proto'),
    path.join(__dirname, '../../../proto/analytics.proto'),
    path.join(process.cwd(), 'proto/analytics.proto'),
  ]
  
  for (const protoPath of paths) {
    if (fs.existsSync(protoPath)) {
      console.log(`[analytics-grpc] Found proto file at: ${protoPath}`)
      return protoPath
    }
  }
  
  throw new Error(`analytics.proto not found in any of: ${paths.join(', ')}`)
}

let analyticsProto: any = null
let packageDefinition: any = null

function loadProto() {
  if (packageDefinition && analyticsProto) {
    return { packageDefinition, analyticsProto }
  }
  
  const PROTO_PATH = findProtoPath()
  packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  })
  
  analyticsProto = grpc.loadPackageDefinition(packageDefinition) as any
  return { packageDefinition, analyticsProto }
}

// CPU cores for parallel processing
const CPU_CORES = os.cpus().length
console.log(`[analytics-grpc] Using ${CPU_CORES} CPU cores for parallel processing`)

// gRPC logging middleware
function withLogging(handler: any, methodName: string) {
  return async (call: any, callback: any) => {
    const start = Date.now()
    console.log(`[gRPC] ${methodName} called`)
    try {
      await handler(call, callback)
      const duration = Date.now() - start
      console.log(`[gRPC] ${methodName} completed in ${duration}ms`)
    } catch (err: any) {
      const duration = Date.now() - start
      console.error(`[gRPC] ${methodName} failed after ${duration}ms:`, err)
      callback({
        code: grpc.status.INTERNAL,
        message: err.message || 'Internal server error',
      })
    }
  }
}

// Implementations
const implementations = {
  // Price prediction with worker threads
  PredictPrice: withLogging(
    async (call: any, callback: any) => {
      const { items } = call.request
      if (!items || items.length === 0) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'items required',
        })
      }

      try {
        // Enrich with historical prices
        const enriched = await Promise.all(
          items.map(async (item: any) => {
            if (item.query) {
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

        // Worker thread processing
        const chunkSize = Math.ceil(enriched.length / CPU_CORES)
        const chunks = Array.from({ length: CPU_CORES }, (_, i) =>
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
        callback(null, { suggested: Math.round(avg * 100) / 100, samples: flat.length })
      } catch (err: any) {
        callback({
          code: grpc.status.INTERNAL,
          message: err.message || 'Internal server error',
        })
      }
    },
    'PredictPrice'
  ),

  // User search history
  GetUserSearchHistory: withLogging(
    async (call: any, callback: any) => {
      const { user_id, limit } = call.request
      if (!user_id) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'user_id required',
        })
      }

      try {
        const history = await getUserSearchHistory(user_id, limit || 50)
        callback(null, {
          user_id,
          history: history.map((h) => ({
            id: h.id,
            user_id: h.user_id || '',
            source: h.source,
            query: h.q,
            results: h.results || 0,
            created_at: h.created_at.toISOString(),
          })),
          count: history.length,
        })
      } catch (err: any) {
        callback({
          code: grpc.status.INTERNAL,
          message: err.message || 'Internal server error',
        })
      }
    },
    'GetUserSearchHistory'
  ),

  // Similar searches
  GetSimilarSearches: withLogging(
    async (call: any, callback: any) => {
      const { query, user_id, limit } = call.request
      if (!query || query.length < 2) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'query parameter required (min 2 chars)',
        })
      }

      try {
        const similar = await getSimilarSearches(query, user_id, limit || 10)
        callback(null, {
          query,
          recommendations: similar.map((s) => ({
            query: s.query,
            count: s.count,
            similarity: s.similarity,
          })),
          count: similar.length,
        })
      } catch (err: any) {
        callback({
          code: grpc.status.INTERNAL,
          message: err.message || 'Internal server error',
        })
      }
    },
    'GetSimilarSearches'
  ),

  // Trending searches
  GetTrendingSearches: withLogging(
    async (call: any, callback: any) => {
      const { days, limit } = call.request

      try {
        const trending = await getTrendingSearches(days || 7, limit || 20)
        callback(null, {
          days: days || 7,
          trending: trending.map((t) => ({
            query: t.query,
            count: t.count,
          })),
          count: trending.length,
        })
      } catch (err: any) {
        callback({
          code: grpc.status.INTERNAL,
          message: err.message || 'Internal server error',
        })
      }
    },
    'GetTrendingSearches'
  ),

  // Price trend
  GetPriceTrend: withLogging(
    async (call: any, callback: any) => {
      const { artist, name, format, days } = call.request
      if (!artist || !name) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'artist and name parameters required',
        })
      }

      try {
        const trends = await getPriceTrend(artist, name, format, days || 90)
        callback(null, {
          artist,
          name,
          format: format || '',
          days: days || 90,
          trends: trends.map((t) => ({
            id: t.id,
            snap_date: t.snap_date.toISOString(),
            artist: t.artist,
            name: t.name,
            format: t.format || '',
            median_price: t.median_price || 0,
            sample_count: t.sample_count,
          })),
          count: trends.length,
        })
      } catch (err: any) {
        callback({
          code: grpc.status.INTERNAL,
          message: err.message || 'Internal server error',
        })
      }
    },
    'GetPriceTrend'
  ),

  // Log search
  LogSearch: withLogging(
    async (call: any, callback: any) => {
      const { user_id, source, query, results } = call.request
      if (!source || !query) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'source and query required',
        })
      }

      try {
        await logSearch(user_id || null, source, query, results || null)
        callback(null, { ok: true, logged: true })
      } catch (err: any) {
        callback({
          code: grpc.status.INTERNAL,
          message: err.message || 'Internal server error',
        })
      }
    },
    'LogSearch'
  ),

  // Health check
  HealthCheck: withLogging(
    async (call: any, callback: any) => {
      try {
        await pool.query('SELECT 1')
        callback(null, { healthy: true, version: '1.0.0' })
      } catch (err: any) {
        callback(null, { healthy: false, version: '1.0.0' })
      }
    },
    'HealthCheck'
  ),
}

export function startGrpcServer(port: number = 50054) {
  const server = new grpc.Server()

  // Load proto file lazily (only when server starts)
  const protoPath = findProtoPath()
  const { analyticsProto: loadedProto } = loadProto()
  
  // Register service
  server.addService(loadedProto.analytics.AnalyticsService.service, implementations)

  // Enable gRPC reflection for tooling (grpcurl, etc.)
  if (process.env.ENABLE_GRPC_REFLECTION !== "false") {
    try {
      const { enableReflection } = require("@common/utils/grpc-reflection");
      enableReflection(server, [protoPath], ["analytics.AnalyticsService"]);
    } catch (err) {
      console.warn("[analytics gRPC] Failed to enable reflection:", err);
    }
  }

  // Start server
  server.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) {
      console.error(`[analytics gRPC] Failed to start server:`, err)
      process.exit(1)
    }
    server.start()
    console.log(`[analytics gRPC] server listening on ${port}`)
  })

  return server
}

