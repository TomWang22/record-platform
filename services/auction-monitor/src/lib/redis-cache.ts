// Redis caching with Lua singleflight pattern
// Prevents thundering herd and cache stampede by ensuring only one request
// fetches data while others wait for the result

import { getRedis } from '@common/utils/redis'

export interface CacheOptions {
  ttl?: number  // Time to live in seconds
  staleWhileRevalidate?: number  // Serve stale data while revalidating
}

export class RedisCache {
  private redis = getRedis()
  
  // Lua script for singleflight pattern
  // Ensures only one request fetches data, others wait for the result
  private singleflightScript = `
    local key = KEYS[1]
    local lockKey = key .. ':lock'
    local waitKey = key .. ':wait'
    local ttl = tonumber(ARGV[1])
    local lockTimeout = tonumber(ARGV[2]) or 30  -- Lock timeout in seconds
    
    -- Check if data exists
    local data = redis.call('GET', key)
    if data then
      return {1, data}  -- Cache hit
    end
    
    -- Try to acquire lock
    local lockAcquired = redis.call('SET', lockKey, '1', 'EX', lockTimeout, 'NX')
    
    if lockAcquired then
      -- We acquired the lock, return signal to fetch data
      return {2, 'LOCK_ACQUIRED'}  -- Lock acquired, fetch data
    else
      -- Lock exists, check if data was set (polling will be done client-side)
      -- Return signal to wait and retry
      return {3, 'LOCK_EXISTS'}  -- Lock exists, wait client-side
    end
  `
  
  // Lua script to release lock and set data
  private releaseLockScript = `
    local key = KEYS[1]
    local lockKey = key .. ':lock'
    local data = ARGV[1]
    local ttl = tonumber(ARGV[2])
    
    -- Set the data
    redis.call('SETEX', key, ttl, data)
    
    -- Release the lock
    redis.call('DEL', lockKey)
    
    return 1
  `
  
  /**
   * Get data from cache or fetch it using the provided function
   * Implements singleflight pattern to prevent thundering herd
   */
  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    const cacheKey = `cache:${key}`
    const ttl = options.ttl || 3600  // Default 1 hour
    const lockTimeout = 30  // Lock timeout in seconds
    
    try {
      // Try singleflight pattern
      const result = await this.redis.eval(
        this.singleflightScript,
        1,
        cacheKey,
        ttl,
        lockTimeout
      ) as [number, string]
      
      const [status, value] = result
      
      if (status === 1) {
        // Cache hit
        return JSON.parse(value) as T
      } else if (status === 2) {
        // Lock acquired, fetch data
        try {
          const data = await fetchFn()
          const serialized = JSON.stringify(data)
          
          // Release lock and set data
          await this.redis.eval(
            this.releaseLockScript,
            1,
            cacheKey,
            serialized,
            ttl
          )
          
          return data
        } catch (error) {
          // Release lock on error
          await this.redis.del(`${cacheKey}:lock`)
          throw error
        }
      } else {
        // Lock exists, wait for data to be set (polling)
        const maxWait = 10000  // Max 10 seconds
        const pollInterval = 100  // Poll every 100ms
        const start = Date.now()
        
        while (Date.now() - start < maxWait) {
          await new Promise(resolve => setTimeout(resolve, pollInterval))
          
          // Check if data is now available
          const data = await this.redis.get(cacheKey)
          if (data) {
            return JSON.parse(data) as T
          }
          
          // Check if lock was released (another request failed)
          const lockExists = await this.redis.exists(`${cacheKey}:lock`)
          if (!lockExists) {
            // Lock released, fetch data ourselves
            break
          }
        }
        
        // Timeout or lock released, fetch data
        const data = await fetchFn()
        const serialized = JSON.stringify(data)
        
        await this.redis.setex(cacheKey, ttl, serialized)
        return data
      }
    } catch (error) {
      // Redis error, fetch directly (fail open)
      console.error(`[RedisCache] Error for key ${key}:`, error)
      return await fetchFn()
    }
  }
  
  /**
   * Get data from cache (no fetch function)
   */
  async get<T>(key: string): Promise<T | null> {
    const cacheKey = `cache:${key}`
    
    try {
      const data = await this.redis.get(cacheKey)
      if (!data) {
        return null
      }
      return JSON.parse(data) as T
    } catch (error) {
      console.error(`[RedisCache] Get error for key ${key}:`, error)
      return null
    }
  }
  
  /**
   * Set data in cache
   */
  async set<T>(key: string, value: T, options: CacheOptions = {}): Promise<void> {
    const cacheKey = `cache:${key}`
    const ttl = options.ttl || 3600
    
    try {
      const serialized = JSON.stringify(value)
      await this.redis.setex(cacheKey, ttl, serialized)
    } catch (error) {
      console.error(`[RedisCache] Set error for key ${key}:`, error)
    }
  }
  
  /**
   * Delete data from cache
   */
  async delete(key: string): Promise<void> {
    const cacheKey = `cache:${key}`
    
    try {
      await this.redis.del(cacheKey, `${cacheKey}:lock`)
    } catch (error) {
      console.error(`[RedisCache] Delete error for key ${key}:`, error)
    }
  }
  
  /**
   * Invalidate cache pattern (use with caution)
   */
  async invalidatePattern(pattern: string): Promise<void> {
    try {
      const keys = await this.redis.keys(`cache:${pattern}`)
      if (keys.length > 0) {
        await this.redis.del(...keys)
      }
    } catch (error) {
      console.error(`[RedisCache] Invalidate pattern error for ${pattern}:`, error)
    }
  }
}

// Singleton instance
let cacheInstance: RedisCache | null = null

export function getCache(): RedisCache {
  if (!cacheInstance) {
    cacheInstance = new RedisCache()
  }
  return cacheInstance
}

