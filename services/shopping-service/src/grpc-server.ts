/* cspell:ignore grpc */
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import * as path from 'path'
import * as fs from 'fs'
import os from 'os'
import { pool, withRetry } from './lib/db.js'
import { makeRedis, CacheManager } from './lib/cache.js'
import { kafka } from '@common/utils/kafka'
import { registerHealthService } from '@common/utils'

// Load proto file (try both relative paths for dev vs production, and K8s mount)
function findProtoPath(): string {
  const paths = [
    '/app/proto/shopping.proto',  // K8s ConfigMap mount
    path.join(__dirname, '../../proto/shopping.proto'),
    path.join(__dirname, '../../../proto/shopping.proto'),
    path.join(process.cwd(), 'proto/shopping.proto'),
  ]
  
  for (const protoPath of paths) {
    if (fs.existsSync(protoPath)) {
      console.log(`[shopping-grpc] Found proto file at: ${protoPath}`)
      return protoPath
    }
  }
  
  throw new Error(`shopping.proto not found in any of: ${paths.join(', ')}`)
}

const PROTO_PATH = findProtoPath()
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
})

const shoppingProto = grpc.loadPackageDefinition(packageDefinition) as any

// Redis for caching
const redis = makeRedis()
const cacheManager = new CacheManager(redis)

// CPU cores for parallel processing
const CPU_CORES = os.cpus().length
console.log(`[shopping-grpc] Using ${CPU_CORES} CPU cores for parallel processing`)

// Kafka producer for real-time events
let kafkaProducer: any = null
async function getKafkaProducer() {
  if (!kafkaProducer) {
    kafkaProducer = kafka.producer()
    await kafkaProducer.connect()
  }
  return kafkaProducer
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
        message: err.message || 'internal error',
      })
    }
  }
}

// Implement ShoppingService
const shoppingService = {
  // Shopping Cart methods
  async AddToCart(call: any, callback: any) {
    const { user_id, item_type, item_id, quantity = 1, listing_id, price, metadata } = call.request
    try {
      const existing = await withRetry(
        () => pool.query(
          `SELECT id, quantity FROM shopping.shopping_cart
           WHERE user_id = $1 AND item_type = $2 AND item_id = $3`,
          [user_id, item_type, item_id]
        ),
        3,
        'gRPC AddToCart: check existing'
      )

      let cartItemId: string
      if (existing.rows.length > 0) {
        const newQuantity = existing.rows[0].quantity + quantity
        await withRetry(
          () => pool.query(
            `UPDATE shopping.shopping_cart SET quantity = $1, updated_at = now() WHERE id = $2`,
            [newQuantity, existing.rows[0].id]
          ),
          3,
          'gRPC AddToCart: update quantity'
        )
        cartItemId = existing.rows[0].id
      } else {
        const result = await withRetry(
          () => pool.query(
            `INSERT INTO shopping.shopping_cart (user_id, item_type, item_id, listing_id, quantity, price, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`,
            [user_id, item_type, item_id, listing_id || null, quantity, price || null, metadata || null]
          ),
          3,
          'gRPC AddToCart: insert new'
        )
        cartItemId = result.rows[0].id
      }

      await cacheManager.incrementLFU(`cart:${item_type}:${item_id}`, user_id)

      // Publish to Kafka
      const producer = await getKafkaProducer()
      await producer.send({
        topic: 'shopping-cart',
        messages: [{ key: user_id, value: JSON.stringify({ action: 'add', user_id, item_id, cart_item_id: cartItemId }) }],
      })

      callback(null, { success: true, cart_item_id: cartItemId, message: 'Item added to cart' })
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err.message })
    }
  },

  async GetCart(call: any, callback: any) {
    const { user_id } = call.request
    try {
      const result = await withRetry(
        () => pool.query(
          `SELECT id, listing_id, item_type, item_id, quantity, price, metadata, created_at, updated_at
           FROM shopping.shopping_cart WHERE user_id = $1 ORDER BY created_at DESC`,
          [user_id]
        ),
        3,
        'gRPC GetCart'
      )

      const totalPrice = result.rows.reduce((sum: number, item: any) => sum + (Number(item.price || 0) * item.quantity), 0)

      callback(null, {
        items: result.rows.map((row: any) => ({
          id: row.id,
          item_type: row.item_type,
          item_id: row.item_id,
          listing_id: row.listing_id,
          quantity: row.quantity,
          price: Number(row.price || 0),
          metadata: row.metadata ? JSON.stringify(row.metadata) : '',
          created_at: row.created_at.toISOString(),
          updated_at: row.updated_at.toISOString(),
        })),
        total_items: result.rows.reduce((sum: number, item: any) => sum + item.quantity, 0),
        total_price: totalPrice,
      })
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err.message })
    }
  },

  async RemoveFromCart(call: any, callback: any) {
    const { user_id, cart_item_id } = call.request
    try {
      const result = await withRetry(
        () => pool.query(
          `DELETE FROM shopping.shopping_cart WHERE id = $1 AND user_id = $2 RETURNING id`,
          [cart_item_id, user_id]
        ),
        3,
        'gRPC RemoveFromCart'
      )

      if (result.rows.length === 0) {
        return callback({ code: grpc.status.NOT_FOUND, message: 'Item not found in cart' })
      }

      callback(null, { success: true, message: 'Item removed from cart' })
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err.message })
    }
  },

  async ClearCart(call: any, callback: any) {
    const { user_id } = call.request
    try {
      const result = await withRetry(
        () => pool.query(
          `DELETE FROM shopping.shopping_cart WHERE user_id = $1 RETURNING id`,
          [user_id]
        ),
        3,
        'gRPC ClearCart'
      )

      callback(null, { success: true, items_removed: result.rows.length })
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err.message })
    }
  },

  // Watchlist methods
  async AddToWatchlist(call: any, callback: any) {
    const { user_id, item_type, item_id, listing_id, notify_on = [], metadata } = call.request
    try {
      const result = await withRetry(
        () => pool.query(
          `INSERT INTO shopping.watchlist (user_id, item_type, item_id, listing_id, notify_on, metadata)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)
           ON CONFLICT (user_id, item_type, item_id)
           DO UPDATE SET notify_on = $5, metadata = $6::jsonb, updated_at = now()
           RETURNING id`,
          [user_id, item_type, item_id, listing_id || null, notify_on, metadata || null]
        ),
        3,
        'gRPC AddToWatchlist'
      )

      await cacheManager.incrementLFU(`watchlist:${item_type}:${item_id}`, user_id)

      callback(null, { success: true, watchlist_id: result.rows[0].id, message: 'Item added to watchlist' })
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err.message })
    }
  },

  async GetWatchlist(call: any, callback: any) {
    const { user_id, limit = 50, offset = 0 } = call.request
    try {
      const result = await withRetry(
        () => pool.query(
          `SELECT id, listing_id, item_type, item_id, notify_on, metadata, created_at
           FROM shopping.watchlist WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
          [user_id, limit, offset]
        ),
        3,
        'gRPC GetWatchlist'
      )

      const countResult = await withRetry(
        () => pool.query(
          `SELECT COUNT(*) as total FROM shopping.watchlist WHERE user_id = $1`,
          [user_id]
        ),
        3,
        'gRPC GetWatchlist: count'
      )

      callback(null, {
        items: result.rows.map((row: any) => ({
          id: row.id,
          item_type: row.item_type,
          item_id: row.item_id,
          listing_id: row.listing_id,
          notify_on: row.notify_on || [],
          metadata: row.metadata ? JSON.stringify(row.metadata) : '',
          created_at: row.created_at.toISOString(),
        })),
        total: parseInt(countResult.rows[0].total),
      })
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err.message })
    }
  },

  // Recently Viewed methods
  async AddRecentlyViewed(call: any, callback: any) {
    const { user_id, item_type, item_id, metadata } = call.request
    try {
      await withRetry(
        () => pool.query(
          `INSERT INTO shopping.recently_viewed (user_id, item_type, item_id, metadata)
           VALUES ($1, $2, $3, $4::jsonb)
           ON CONFLICT (user_id, item_type, item_id)
           DO UPDATE SET viewed_at = now(), metadata = $4::jsonb`,
          [user_id, item_type, item_id, metadata || null]
        ),
        3,
        'gRPC AddRecentlyViewed'
      )

      await cacheManager.addRecentlyViewed(user_id, item_type, item_id, metadata)

      callback(null, { success: true })
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err.message })
    }
  },

  async GetRecentlyViewed(call: any, callback: any) {
    const { user_id, item_type, limit = 50 } = call.request
    try {
      let query = `SELECT item_type, item_id, viewed_at, metadata FROM shopping.recently_viewed WHERE user_id = $1`
      const params: any[] = [user_id]
      if (item_type) {
        query += ` AND item_type = $2`
        params.push(item_type)
      }
      query += ` ORDER BY viewed_at DESC LIMIT $${params.length + 1}`
      params.push(limit)

      const result = await withRetry(
        () => pool.query(query, params),
        3,
        'gRPC GetRecentlyViewed'
      )

      callback(null, {
        items: result.rows.map((row: any) => ({
          item_type: row.item_type,
          item_id: row.item_id,
          viewed_at: row.viewed_at.toISOString(),
          metadata: row.metadata ? JSON.stringify(row.metadata) : '',
        })),
      })
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err.message })
    }
  },

  // Wishlist methods
  async AddToWishlist(call: any, callback: any) {
    const { user_id, item_type, item_id, listing_id, priority = 0, notes, metadata } = call.request
    try {
      const result = await withRetry(
        () => pool.query(
          `INSERT INTO shopping.wishlist (user_id, item_type, item_id, listing_id, priority, notes, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
           ON CONFLICT (user_id, item_type, item_id)
           DO UPDATE SET priority = $5, notes = $6, metadata = $7::jsonb, updated_at = now()
           RETURNING id`,
          [user_id, item_type, item_id, listing_id || null, priority, notes || null, metadata || null]
        ),
        3,
        'gRPC AddToWishlist'
      )

      await cacheManager.incrementLFU(`wishlist:${item_type}:${item_id}`, user_id)

      callback(null, { success: true, wishlist_id: result.rows[0].id })
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err.message })
    }
  },

  async GetWishlist(call: any, callback: any) {
    const { user_id, limit = 50, offset = 0 } = call.request
    try {
      const result = await withRetry(
        () => pool.query(
          `SELECT id, listing_id, item_type, item_id, priority, notes, metadata, created_at
           FROM shopping.wishlist WHERE user_id = $1 ORDER BY priority DESC, created_at DESC LIMIT $2 OFFSET $3`,
          [user_id, limit, offset]
        ),
        3,
        'gRPC GetWishlist'
      )

      const countResult = await withRetry(
        () => pool.query(
          `SELECT COUNT(*) as total FROM shopping.wishlist WHERE user_id = $1`,
          [user_id]
        ),
        3,
        'gRPC GetWishlist: count'
      )

      callback(null, {
        items: result.rows.map((row: any) => ({
          id: row.id,
          item_type: row.item_type,
          item_id: row.item_id,
          listing_id: row.listing_id,
          priority: row.priority,
          notes: row.notes || '',
          metadata: row.metadata ? JSON.stringify(row.metadata) : '',
          created_at: row.created_at.toISOString(),
        })),
        total: parseInt(countResult.rows[0].total),
      })
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err.message })
    }
  },

  // Purchase History methods
  async AddPurchase(call: any, callback: any) {
    const {
      user_id,
      order_id,
      item_type,
      item_id,
      listing_id,
      quantity = 1,
      price_paid,
      currency = 'USD',
      purchase_type,
      status = 'completed',
      metadata,
    } = call.request

    try {
      const result = await withRetry(
        () => pool.query(
          `INSERT INTO shopping.purchase_history 
           (user_id, order_id, item_type, item_id, listing_id, quantity, price_paid, currency, purchase_type, status, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb) RETURNING id`,
          [user_id, order_id, item_type, item_id, listing_id || null, quantity, price_paid, currency, purchase_type, status, metadata || null]
        ),
        3,
        'gRPC AddPurchase'
      )

      // Publish to Kafka
      const producer = await getKafkaProducer()
      await producer.send({
        topic: 'purchases',
        messages: [{ key: user_id, value: JSON.stringify({ user_id, order_id, item_id, purchase_id: result.rows[0].id }) }],
      })

      callback(null, { success: true, purchase_id: result.rows[0].id })
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err.message })
    }
  },

  async GetPurchaseHistory(call: any, callback: any) {
    const { user_id, limit = 50, offset = 0 } = call.request
    try {
      const result = await withRetry(
        () => pool.query(
          `SELECT id, order_id, listing_id, item_type, item_id, quantity, price_paid, currency,
                  purchase_type, status, purchased_at, metadata
           FROM shopping.purchase_history WHERE user_id = $1 ORDER BY purchased_at DESC LIMIT $2 OFFSET $3`,
          [user_id, limit, offset]
        ),
        3,
        'gRPC GetPurchaseHistory'
      )

      const countResult = await withRetry(
        () => pool.query(
          `SELECT COUNT(*) as total FROM shopping.purchase_history WHERE user_id = $1`,
          [user_id]
        ),
        3,
        'gRPC GetPurchaseHistory: count'
      )

      callback(null, {
        items: result.rows.map((row: any) => ({
          id: row.id,
          order_id: row.order_id,
          item_type: row.item_type,
          item_id: row.item_id,
          listing_id: row.listing_id,
          quantity: row.quantity,
          price_paid: Number(row.price_paid),
          currency: row.currency,
          purchase_type: row.purchase_type,
          status: row.status,
          purchased_at: row.purchased_at.toISOString(),
          metadata: row.metadata ? JSON.stringify(row.metadata) : '',
        })),
        total: parseInt(countResult.rows[0].total),
      })
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err.message })
    }
  },

  // Search History methods
  async AddSearch(call: any, callback: any) {
    const { user_id, query, query_type, filters, result_count, clicked_item } = call.request
    try {
      await withRetry(
        () => pool.query(
          `INSERT INTO shopping.search_history (user_id, query, query_type, filters, result_count, clicked_item)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
          [user_id, query, query_type, filters || null, result_count || null, clicked_item || null]
        ),
        3,
        'gRPC AddSearch'
      )

      await cacheManager.incrementLFU(`search:${query_type}:${query}`, user_id)

      callback(null, { success: true })
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err.message })
    }
  },

  async GetSearchHistory(call: any, callback: any) {
    const { user_id, query_type, limit = 50 } = call.request
    try {
      let query = `SELECT id, query, query_type, filters, result_count, clicked_item, searched_at
                   FROM shopping.search_history WHERE user_id = $1`
      const params: any[] = [user_id]
      if (query_type) {
        query += ` AND query_type = $2`
        params.push(query_type)
      }
      query += ` ORDER BY searched_at DESC LIMIT $${params.length + 1}`
      params.push(limit)

      const result = await withRetry(
        () => pool.query(query, params),
        3,
        'gRPC GetSearchHistory'
      )

      callback(null, {
        items: result.rows.map((row: any) => ({
          id: row.id,
          query: row.query,
          query_type: row.query_type,
          filters: row.filters ? JSON.stringify(row.filters) : '',
          result_count: row.result_count || 0,
          clicked_item: row.clicked_item || '',
          searched_at: row.searched_at.toISOString(),
        })),
      })
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err.message })
    }
  },

  async GetTrendingSearches(call: any, callback: any) {
    const { query_type, limit = 20, time_range = '24h' } = call.request
    try {
      let timeFilter = "searched_at >= now() - interval '24 hours'"
      if (time_range === '1h') timeFilter = "searched_at >= now() - interval '1 hour'"
      else if (time_range === '7d') timeFilter = "searched_at >= now() - interval '7 days'"
      else if (time_range === '30d') timeFilter = "searched_at >= now() - interval '30 days'"

      let query = `SELECT query, query_type, COUNT(*) as count FROM shopping.search_history WHERE ${timeFilter}`
      const params: any[] = []
      if (query_type) {
        query += ` AND query_type = $1`
        params.push(query_type)
      }
      query += ` GROUP BY query, query_type ORDER BY count DESC LIMIT $${params.length + 1}`
      params.push(limit)

      const result = await withRetry(
        () => pool.query(query, params),
        3,
        'gRPC GetTrendingSearches'
      )

      callback(null, {
        items: result.rows.map((row: any) => ({
          query: row.query,
          query_type: row.query_type,
          count: parseInt(row.count),
        })),
      })
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err.message })
    }
  },

  // Cache operations
  async GetCacheStats(call: any, callback: any) {
    const { user_id, cache_type } = call.request
    try {
      // Get LFU/LRU stats from Redis
      const lfuItems = await cacheManager.getLFUCount('*', user_id) // This would need a pattern search
      const lruItems = 0 // Would need to count LRU items

      callback(null, {
        lfu_items: lfuItems,
        lru_items: lruItems,
        total_access_count: 0, // Would need to aggregate
      })
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err.message })
    }
  },

  async EvictCache(call: any, callback: any) {
    const { user_id, cache_type, max_items = 100 } = call.request
    try {
      let itemsEvicted = 0
      if (cache_type === 'lfu') {
        itemsEvicted = await cacheManager.evictLFU(user_id, max_items)
      } else if (cache_type === 'lru') {
        itemsEvicted = await cacheManager.evictLRU(user_id, max_items)
      }

      callback(null, { success: true, items_evicted: itemsEvicted })
    } catch (err: any) {
      callback({ code: grpc.status.INTERNAL, message: err.message })
    }
  },

  // Legacy health check (kept for backward compatibility)
  // Note: Standard health check is now handled by grpc.health.v1.Health service
  async HealthCheck(_call: any, callback: any) {
    try {
      await withRetry(
        () => pool.query('SELECT 1'),
        3,
        'gRPC HealthCheck: database'
      )
      if (redis && redis.status !== 'ready') {
        await redis.ping()
      }
      callback(null, { healthy: true, message: 'OK' })
    } catch (err: any) {
      callback({ code: grpc.status.UNAVAILABLE, message: 'Database or Redis unavailable' })
    }
  },
}

// Wrap all methods with logging
const wrappedService: any = {}
for (const [method, handler] of Object.entries(shoppingService)) {
  wrappedService[method] = withLogging(handler, method)
}

export function startGrpcServer(port: number) {
  const server = new grpc.Server({
    'grpc.keepalive_time_ms': 30000,
    'grpc.keepalive_timeout_ms': 5000,
    'grpc.keepalive_permit_without_calls': 1,
    'grpc.http2.max_pings_without_data': 0,
    'grpc.http2.min_time_between_pings_ms': 10000,
    'grpc.http2.min_ping_interval_without_data_ms': 300000,
  })

  server.addService(shoppingProto.shopping.ShoppingService.service, wrappedService)

  // Register standard gRPC Health Service (grpc.health.v1.Health/Check)
  // This enables Kubernetes health probes and Caddy health checks
  registerHealthService(server, 'shopping.ShoppingService', async () => {
    try {
      // Check database connectivity
      await withRetry(
        () => pool.query('SELECT 1'),
        3,
        'gRPC health service: database'
      )
      
      // Check Redis connectivity (if Redis is available)
      if (redis && redis.status !== 'ready') {
        await redis.ping()
      }
      
      return true
    } catch (err: any) {
      console.error('[shopping] Health check failed:', err.message)
      return false
    }
  })

  // Enable gRPC reflection for tooling (grpcurl, etc.)
  if (process.env.ENABLE_GRPC_REFLECTION !== "false") {
    try {
      const { enableReflection } = require("@common/utils/grpc-reflection");
      enableReflection(server, [PROTO_PATH], ["shopping.ShoppingService"]);
    } catch (err) {
      console.warn("[shopping gRPC] Failed to enable reflection:", err);
    }
  }

  // Try to load TLS certs (for production with ALPN = h2)
  let credentials: grpc.ServerCredentials;
  const keyPath = process.env.TLS_KEY_PATH || "/etc/certs/tls.key";
  const certPath = process.env.TLS_CERT_PATH || "/etc/certs/tls.crt";
  const caPath = process.env.TLS_CA_PATH || process.env.GRPC_CA_CERT || "/etc/certs/ca.crt";
  
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const key = fs.readFileSync(keyPath);
    const cert = fs.readFileSync(certPath);
    
    // For strict TLS: verify client certificates if CA cert exists
    let rootCerts: Buffer | null = null;
    let checkClientCert = false;
    if (fs.existsSync(caPath)) {
      rootCerts = fs.readFileSync(caPath);
      checkClientCert = true;
      console.log("[gRPC] Starting secure HTTP/2-only server with strict TLS (client cert verification)");
    } else {
      console.log("[gRPC] Starting secure HTTP/2-only server with ALPN = h2 (no client cert verification)");
    }
    
    // For dev: Don't require client cert verification (use false)
    // For production: Enable client cert verification (use checkClientCert)
    const requireClientCert = process.env.GRPC_REQUIRE_CLIENT_CERT === 'true' ? checkClientCert : false;
    
    credentials = grpc.ServerCredentials.createSsl(
      rootCerts,
      [{ private_key: key, cert_chain: cert }],
      requireClientCert as any
    );
    if (requireClientCert) {
      console.log("[gRPC] Client certificate verification is ENABLED.");
    } else {
      console.log("[gRPC] Client certificate verification is DISABLED (dev mode).");
    }
  } else {
    console.warn("[gRPC] TLS certs not found, starting insecure server (dev only)");
    credentials = grpc.ServerCredentials.createInsecure();
  }

  server.bindAsync(`0.0.0.0:${port}`, credentials, (err, actualPort) => {
    if (err) {
      console.error(`[shopping-grpc] Failed to start gRPC server:`, err)
      return
    }
    server.start()
    console.log(`[shopping-grpc] gRPC server listening on port ${actualPort} (HTTP/2 only)`)
  })

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[shopping-grpc] Shutting down gRPC server')
    server.tryShutdown((err) => {
      if (err) {
        console.error('[shopping-grpc] Error shutting down gRPC server:', err)
      } else {
        console.log('[shopping-grpc] gRPC server shut down gracefully')
      }
    })
  })
}

