import Redis from 'ioredis'
import * as fs from 'fs'
import * as path from 'path'

/** Singleton Redis client. HTTP and gRPC servers share this to avoid duplicate connections and startup flakiness. */
let redisInstance: Redis | null = null

// Redis client factory - returns singleton so server.ts and grpc-server.ts share one connection
export function makeRedis(): Redis | null {
  if (redisInstance !== null) return redisInstance

  const url = process.env.REDIS_URL
  const rawPassword = process.env.REDIS_PASSWORD
  const password = rawPassword && String(rawPassword).trim() ? rawPassword : undefined

  if (!url) {
    console.warn('[shopping] REDIS_URL not set, Redis caching disabled')
    return null
  }

  // Support both REDIS_URL (with password) and REDIS_PASSWORD env var. Empty = no auth (externalized Redis).
  let redisUrl = url
  if (password && !redisUrl.includes('@') && !redisUrl.includes('://:')) {
    redisUrl = redisUrl.replace('redis://', `redis://:${password}@`)
  }

  try {
    const redis = new Redis(redisUrl, {
      password: password,
      lazyConnect: true,
      connectTimeout: 10_000, // Colima/host.docker.internal may need a moment on first packet
      maxRetriesPerRequest: 5,
      retryStrategy: (times) => {
        if (times > 5) return null
        return Math.min(times * 200, 3000) // 200, 400, 600, 800, 1000ms - gives external Redis time
      },
      enableOfflineQueue: false,
    })

    redis.connect().catch((err) => {
      console.warn('[shopping] Redis connection failed (non-fatal):', err.message)
    })

    redis.on('error', (err) => {
      console.error('[shopping] Redis error:', err)
    })

    redis.on('connect', () => {
      console.log('[shopping] Redis connected')
    })

    redisInstance = redis
    return redis
  } catch (err) {
    console.error('[shopping] Failed to create Redis client:', err)
    return null
  }
}

// Load Lua script
function loadLuaScript(scriptName: string): string {
  const scriptPath = path.join(__dirname, `${scriptName}.lua`)
  try {
    return fs.readFileSync(scriptPath, 'utf-8')
  } catch (err) {
    console.error(`[shopping] Failed to load Lua script ${scriptName}:`, err)
    throw err
  }
}

// Cache statistics (in-memory counters)
let cacheHits = 0
let cacheMisses = 0

// Cache manager with LFU/LRU support
export class CacheManager {
  private redis: Redis | null
  private lfuScript: string = ''
  private lruScript: string = ''

  constructor(redis: Redis | null) {
    this.redis = redis
    if (redis) {
      this.lfuScript = loadLuaScript('lfu_lru_cache')
      this.lruScript = loadLuaScript('lfu_lru_cache') // Same script handles both
    }
  }

  // LFU (Least Frequently Used) operations
  async incrementLFU(key: string, userId: string, ttl: number = 86400): Promise<number> {
    if (!this.redis) return 0
    try {
      const result = await this.redis.eval(
        this.lfuScript,
        0,
        'increment_lfu',
        userId,
        key,
        'lfu',
        ttl.toString(),
        '100'
      )
      return Number(result) || 0
    } catch (err) {
      console.error('[shopping] LFU increment error:', err)
      return 0
    }
  }

  async getLFUCount(key: string, userId: string): Promise<number> {
    if (!this.redis) return 0
    try {
      const result = await this.redis.eval(
        this.lfuScript,
        0,
        'get_lfu_count',
        userId,
        key,
        'lfu',
        '86400',
        '100'
      )
      return Number(result) || 0
    } catch (err) {
      console.error('[shopping] LFU get count error:', err)
      return 0
    }
  }

  async evictLFU(userId: string, maxItems: number = 100): Promise<number> {
    if (!this.redis) return 0
    try {
      const pattern = `cache:lfu:${userId}:`
      const result = await this.redis.eval(
        this.lfuScript,
        0,
        'evict_lfu',
        userId,
        pattern,
        'lfu',
        '86400',
        maxItems.toString()
      )
      return Number(result) || 0
    } catch (err) {
      console.error('[shopping] LFU evict error:', err)
      return 0
    }
  }

  // LRU (Least Recently Used) operations
  async updateLRU(key: string, userId: string, ttl: number = 86400): Promise<number> {
    if (!this.redis) return Date.now()
    try {
      const result = await this.redis.eval(
        this.lruScript,
        0,
        'update_lru',
        userId,
        key,
        'lru',
        ttl.toString(),
        '100'
      )
      return Number(result) * 1000 || Date.now() // Convert to milliseconds
    } catch (err) {
      console.error('[shopping] LRU update error:', err)
      return Date.now()
    }
  }

  async getLRUTime(key: string, userId: string): Promise<number> {
    if (!this.redis) return 0
    try {
      const result = await this.redis.eval(
        this.lruScript,
        0,
        'get_lru_time',
        userId,
        key,
        'lru',
        '86400',
        '100'
      )
      return Number(result) * 1000 || 0 // Convert to milliseconds
    } catch (err) {
      console.error('[shopping] LRU get time error:', err)
      return 0
    }
  }

  async evictLRU(userId: string, maxItems: number = 100): Promise<number> {
    if (!this.redis) return 0
    try {
      const sortedSetKey = `cache:lru:${userId}`
      const result = await this.redis.eval(
        this.lruScript,
        1,
        sortedSetKey,
        'evict_lru',
        userId,
        '',
        'lru',
        '86400',
        maxItems.toString()
      )
      return Number(result) || 0
    } catch (err) {
      console.error('[shopping] LRU evict error:', err)
      return 0
    }
  }

  // Generic cache operations
  async get<T>(key: string): Promise<T | null> {
    if (!this.redis) {
      cacheMisses++
      return null
    }
    try {
      const value = await this.redis.get(key)
      if (value) {
        cacheHits++
        return JSON.parse(value)
      } else {
        cacheMisses++
        return null
      }
    } catch (err) {
      cacheMisses++
      console.error('[shopping] Cache get error:', err)
      return null
    }
  }

  async set(key: string, value: any, ttl: number = 3600): Promise<void> {
    if (!this.redis) return
    try {
      await this.redis.setex(key, ttl, JSON.stringify(value))
    } catch (err) {
      console.error('[shopping] Cache set error:', err)
    }
  }

  async del(key: string): Promise<void> {
    if (!this.redis) return
    try {
      await this.redis.del(key)
    } catch (err) {
      console.error('[shopping] Cache del error:', err)
    }
  }

  // Recently viewed (LRU-based)
  async addRecentlyViewed(userId: string, itemType: string, itemId: string, metadata?: any): Promise<void> {
    const key = `recently_viewed:${userId}:${itemType}:${itemId}`
    await this.updateLRU(key, userId)
    if (metadata) {
      await this.set(`recently_viewed:meta:${userId}:${itemType}:${itemId}`, metadata, 86400)
    }
  }

  async getRecentlyViewed(userId: string, itemType: string, limit: number = 50): Promise<string[]> {
    if (!this.redis) return []
    try {
      const sortedSetKey = `cache:lru:${userId}`
      const pattern = `recently_viewed:${userId}:${itemType}:*`
      // Get most recent items
      const items = await this.redis.zrevrange(sortedSetKey, 0, limit - 1)
      return items.filter((item) => item.startsWith(`recently_viewed:${userId}:${itemType}:`))
    } catch (err) {
      console.error('[shopping] Get recently viewed error:', err)
      return []
    }
  }
}

/**
 * Get cache statistics
 */
export function getCacheStats(): {
  hits: number
  misses: number
  hitRate: number
  total: number
} {
  const total = cacheHits + cacheMisses
  const hitRate = total > 0 ? (cacheHits / total) * 100 : 0
  
  return {
    hits: cacheHits,
    misses: cacheMisses,
    hitRate: Math.round(hitRate * 100) / 100, // Round to 2 decimal places
    total,
  }
}

/**
 * Reset cache statistics (for testing)
 */
export function resetCacheStats(): void {
  cacheHits = 0
  cacheMisses = 0
}

