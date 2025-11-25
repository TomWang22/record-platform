/* cspell:ignore grpc */
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import * as path from 'path'
import * as fs from 'fs'
import { Pool } from 'pg'

// Dual-DB setup
const POSTGRES_URL_LISTINGS = process.env.POSTGRES_URL_LISTINGS || process.env.POSTGRES_URL!;
const POSTGRES_URL_AUCTION_MONITOR = process.env.POSTGRES_URL_AUCTION_MONITOR || process.env.POSTGRES_URL!;

const listingsPool = new Pool({ connectionString: POSTGRES_URL_LISTINGS });
const auctionPool = new Pool({ connectionString: POSTGRES_URL_AUCTION_MONITOR });

// Load proto file (try both relative paths for dev vs production, and K8s mount)
function findProtoPath(): string {
  const paths = [
    '/app/proto/auction-monitor.proto',  // K8s ConfigMap mount
    path.join(__dirname, '../../proto/auction-monitor.proto'),
    path.join(__dirname, '../../../proto/auction-monitor.proto'),
    path.join(process.cwd(), 'proto/auction-monitor.proto'),
    '/app/services/auction-monitor/proto/auction-monitor.proto',
  ]
  
  for (const protoPath of paths) {
    if (fs.existsSync(protoPath)) {
      console.log(`[auction-monitor-grpc] Found proto file at: ${protoPath}`)
      return protoPath
    }
  }
  
  // Don't throw - just log and return a fallback path
  console.warn(`[auction-monitor-grpc] auction-monitor.proto not found in any of: ${paths.join(', ')}`)
  console.warn(`[auction-monitor-grpc] gRPC server will not start without proto file`)
  return paths[0] // Return first path as fallback (will fail gracefully)
}

let auctionMonitorProto: any = null
let packageDefinition: any = null

function loadProto() {
  if (packageDefinition && auctionMonitorProto) {
    return { packageDefinition, auctionMonitorProto }
  }
  
  const PROTO_PATH = findProtoPath()
  packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  })
  
  auctionMonitorProto = grpc.loadPackageDefinition(packageDefinition) as any
  return { packageDefinition, auctionMonitorProto }
}

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

export function startGrpcServer(port: number) {
  let auctionMonitorProto: any
  try {
    const loaded = loadProto()
    auctionMonitorProto = loaded.auctionMonitorProto
    if (!auctionMonitorProto || !auctionMonitorProto.auction_monitor) {
      console.error('[auction-monitor-grpc] Failed to load proto definition')
      return null
    }
  } catch (err: any) {
    console.error('[auction-monitor-grpc] Failed to load proto:', err.message)
    return null
  }
  
  const server = new grpc.Server()

  // HealthCheck
  server.addService(auctionMonitorProto.auction_monitor.AuctionMonitorService.service, {
    HealthCheck: withLogging(async (_call: any, callback: any) => {
      try {
        // Check both databases
        await listingsPool.query('SELECT 1')
        await auctionPool.query('SELECT 1')
        callback(null, {
          healthy: true,
          version: '0.2.0',
          dbReady: true,
          kafkaReady: false, // Worker handles Kafka
        })
      } catch (err: any) {
        callback(null, {
          healthy: false,
          version: '0.2.0',
          dbReady: false,
          kafkaReady: false,
        })
      }
    }, 'HealthCheck'),

    // GetMonitoredAuctions
    GetMonitoredAuctions: withLogging(async (call: any, callback: any) => {
      const { user_id, limit = 50, offset = 0 } = call.request
      
      let query = `
        SELECT 
          w.id,
          w.user_id,
          w.source,
          w.query,
          w.created_at,
          COUNT(ar.id)::int as result_count,
          MAX(ar.sold_at) as last_updated
        FROM listings.watchlist w
        LEFT JOIN auction_monitor.auction_results ar ON ar.external_id = w.query
      `
      
      const params: any[] = []
      if (user_id) {
        query += ' WHERE w.user_id = $1'
        params.push(user_id)
      }
      
      query += ' GROUP BY w.id, w.user_id, w.source, w.query, w.created_at ORDER BY w.created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2)
      params.push(limit, offset)
      
      const { rows } = await listingsPool.query(query, params)
      
      callback(null, {
        auctions: rows.map((r: any) => ({
          id: r.id,
          user_id: r.user_id,
          source: r.source,
          query: r.query,
          created_at: r.created_at?.toISOString() || '',
          result_count: r.result_count || 0,
          last_updated: r.last_updated?.toISOString() || '',
        })),
        count: rows.length,
      })
    }, 'GetMonitoredAuctions'),

    // GetAuctionResults
    GetAuctionResults: withLogging(async (call: any, callback: any) => {
      const { watchlist_id, user_id, limit = 100, offset = 0 } = call.request
      
      // Verify watchlist belongs to user
      const watchlistCheck = await listingsPool.query(
        'SELECT user_id, query FROM listings.watchlist WHERE id = $1',
        [watchlist_id]
      )
      
      if (watchlistCheck.rows.length === 0) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: 'Watchlist item not found',
        })
      }
      
      if (user_id && watchlistCheck.rows[0].user_id !== user_id) {
        return callback({
          code: grpc.status.PERMISSION_DENIED,
          message: 'Forbidden',
        })
      }
      
      const watchlistItem = watchlistCheck.rows[0]
      
      // Get auction results
      const { rows } = await auctionPool.query(
        `SELECT 
          id,
          source,
          external_id,
          title,
          price,
          total_cost,
          currency,
          shipping_cost,
          sold_at,
          auction_url,
          image_url,
          created_at
        FROM auction_monitor.auction_results
        WHERE external_id = $1 OR title ILIKE $2
        ORDER BY sold_at DESC
        LIMIT $3 OFFSET $4`,
        [watchlistItem.query || '', `%${watchlistItem.query || ''}%`, limit, offset]
      )
      
      callback(null, {
        watchlist_id,
        results: rows.map((r: any) => ({
          id: r.id,
          source: r.source,
          external_id: r.external_id,
          title: r.title,
          price: r.price || 0,
          total_cost: r.total_cost || 0,
          currency: r.currency || 'USD',
          shipping_cost: r.shipping_cost || 0,
          sold_at: r.sold_at?.toISOString() || '',
          auction_url: r.auction_url || '',
          image_url: r.image_url || '',
          created_at: r.created_at?.toISOString() || '',
        })),
        count: rows.length,
      })
    }, 'GetAuctionResults'),

    // StartMonitoring
    StartMonitoring: withLogging(async (call: any, callback: any) => {
      const { user_id, query, source = 'ebay' } = call.request
      
      if (!user_id || !query) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'user_id and query are required',
        })
      }
      
      // Add to watchlist
      const { rows } = await listingsPool.query(
        `INSERT INTO listings.watchlist (user_id, source, query)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, source, query) DO NOTHING
         RETURNING id, user_id, source, query, created_at`,
        [user_id, source, query]
      )
      
      if (rows.length === 0) {
        // Already exists
        const existing = await listingsPool.query(
          'SELECT id, user_id, source, query, created_at FROM listings.watchlist WHERE user_id = $1 AND source = $2 AND query = $3',
          [user_id, source, query]
        )
        return callback(null, {
          ok: true,
          message: 'Already monitoring',
          watchlist: {
            id: existing.rows[0].id,
            user_id: existing.rows[0].user_id,
            source: existing.rows[0].source,
            query: existing.rows[0].query,
            created_at: existing.rows[0].created_at?.toISOString() || '',
            result_count: 0,
            last_updated: '',
          },
        })
      }
      
      callback(null, {
        ok: true,
        message: 'Monitoring started',
        watchlist: {
          id: rows[0].id,
          user_id: rows[0].user_id,
          source: rows[0].source,
          query: rows[0].query,
          created_at: rows[0].created_at?.toISOString() || '',
          result_count: 0,
          last_updated: '',
        },
      })
    }, 'StartMonitoring'),

    // StopMonitoring
    StopMonitoring: withLogging(async (call: any, callback: any) => {
      const { user_id, watchlist_id } = call.request
      
      if (!user_id || !watchlist_id) {
        return callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'user_id and watchlist_id are required',
        })
      }
      
      // Verify ownership and delete
      const { rowCount } = await listingsPool.query(
        'DELETE FROM listings.watchlist WHERE id = $1 AND user_id = $2',
        [watchlist_id, user_id]
      )
      
      if (rowCount === 0) {
        return callback({
          code: grpc.status.NOT_FOUND,
          message: 'Watchlist item not found or access denied',
        })
      }
      
      callback(null, {
        ok: true,
        message: 'Monitoring stopped',
      })
    }, 'StopMonitoring'),
  })

  server.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) {
      console.error(`[auction-monitor-grpc] Failed to bind gRPC server:`, err)
      return
    }
    server.start()
    console.log(`[auction-monitor-grpc] server listening on ${port}`)
  })

  return server
}

