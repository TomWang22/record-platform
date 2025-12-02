// Redis-based rate limiter with Lua scripts for atomic operations
// Prevents thundering herd and ensures distributed rate limiting

import { getRedis } from '@common/utils/redis'

export interface RateLimitConfig {
  requests: number
  window: string  // '1s', '1m', '1h', '24h'
  strategy?: 'token-bucket' | 'sliding-window' | 'fixed-window'
}

export class RedisRateLimiter {
  private redis = getRedis()
  private luaScripts: Map<string, string> = new Map()
  
  constructor() {
    this.loadLuaScripts()
  }
  
  private loadLuaScripts(): void {
    // Token bucket rate limiter (Lua script for atomic operations)
    const tokenBucketScript = `
      local key = KEYS[1]
      local capacity = tonumber(ARGV[1])
      local refillRate = tonumber(ARGV[2])
      local requested = tonumber(ARGV[3])
      local now = tonumber(ARGV[4])
      
      local bucket = redis.call('HMGET', key, 'tokens', 'lastRefill')
      local tokens = tonumber(bucket[1]) or capacity
      local lastRefill = tonumber(bucket[2]) or now
      
      -- Refill tokens based on time passed
      local timePassed = now - lastRefill
      local tokensToAdd = math.floor(timePassed * refillRate / 1000)
      tokens = math.min(capacity, tokens + tokensToAdd)
      
      -- Check if we can fulfill the request
      if tokens >= requested then
        tokens = tokens - requested
        redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', now)
        redis.call('EXPIRE', key, 3600)  -- Expire after 1 hour if no activity
        return {1, tokens}  -- Allowed, remaining tokens
      else
        redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', now)
        redis.call('EXPIRE', key, 3600)
        return {0, tokens}  -- Denied, remaining tokens
      end
    `
    
    // Sliding window rate limiter
    const slidingWindowScript = `
      local key = KEYS[1]
      local window = tonumber(ARGV[1])
      local limit = tonumber(ARGV[2])
      local now = tonumber(ARGV[3])
      local identifier = ARGV[4]
      
      -- Remove old entries outside the window
      local cutoff = now - window
      redis.call('ZREMRANGEBYSCORE', key, 0, cutoff)
      
      -- Count current requests in window
      local count = redis.call('ZCARD', key)
      
      if count < limit then
        -- Add this request
        redis.call('ZADD', key, now, identifier)
        redis.call('EXPIRE', key, math.ceil(window / 1000))
        return {1, limit - count - 1}  -- Allowed, remaining
      else
        return {0, 0}  -- Denied, no remaining
      end
    `
    
    // Fixed window rate limiter
    const fixedWindowScript = `
      local key = KEYS[1]
      local window = tonumber(ARGV[1])
      local limit = tonumber(ARGV[2])
      local now = tonumber(ARGV[3])
      
      -- Get current count
      local count = tonumber(redis.call('GET', key) or '0')
      
      if count < limit then
        -- Increment and set expiry
        redis.call('INCR', key)
        redis.call('EXPIRE', key, math.ceil(window / 1000))
        return {1, limit - count - 1}  -- Allowed, remaining
      else
        return {0, 0}  -- Denied, no remaining
      end
    `
    
    this.luaScripts.set('token-bucket', tokenBucketScript)
    this.luaScripts.set('sliding-window', slidingWindowScript)
    this.luaScripts.set('fixed-window', fixedWindowScript)
  }
  
  async acquire(platform: string, config: RateLimitConfig): Promise<{ allowed: boolean; remaining: number; resetAt?: number }> {
    const key = `rate_limit:${platform}`
    const strategy = config.strategy || 'fixed-window'
    const windowMs = this.parseWindow(config.window)
    
    try {
      let result: [number, number] | null = null
      
      if (strategy === 'token-bucket') {
        const capacity = config.requests
        const refillRate = config.requests / windowMs  // tokens per millisecond
        const now = Date.now()
        
        const script = this.luaScripts.get('token-bucket')!
        result = await this.redis.eval(script, 1, key, capacity, refillRate, 1, now) as [number, number]
      } else if (strategy === 'sliding-window') {
        const identifier = `${Date.now()}-${Math.random()}`
        const now = Date.now()
        
        const script = this.luaScripts.get('sliding-window')!
        result = await this.redis.eval(script, 1, key, windowMs, config.requests, now, identifier) as [number, number]
      } else {
        // Fixed window
        const now = Date.now()
        const windowStart = Math.floor(now / windowMs) * windowMs
        const windowKey = `${key}:${windowStart}`
        
        const script = this.luaScripts.get('fixed-window')!
        result = await this.redis.eval(script, 1, windowKey, windowMs, config.requests, now) as [number, number]
      }
      
      const [allowed, remaining] = result
      const resetAt = Date.now() + windowMs
      
      return {
        allowed: allowed === 1,
        remaining,
        resetAt,
      }
    } catch (error) {
      console.error(`[RateLimiter] Error for ${platform}:`, error)
      // Fail open: allow request if Redis is down
      return { allowed: true, remaining: config.requests }
    }
  }
  
  private parseWindow(window: string): number {
    const match = window.match(/^(\d+)([smhd])$/)
    if (!match) {
      throw new Error(`Invalid window format: ${window}`)
    }
    
    const value = parseInt(match[1], 10)
    const unit = match[2]
    
    const multipliers: Record<string, number> = {
      's': 1000,
      'm': 60 * 1000,
      'h': 60 * 60 * 1000,
      'd': 24 * 60 * 60 * 1000,
    }
    
    return value * multipliers[unit]
  }
  
  async waitForAvailability(platform: string, config: RateLimitConfig): Promise<void> {
    const maxWait = 60000  // Max 60 seconds
    const start = Date.now()
    
    while (Date.now() - start < maxWait) {
      const result = await this.acquire(platform, config)
      if (result.allowed) {
        return
      }
      
      // Wait until reset time or 1 second, whichever is shorter
      const waitTime = result.resetAt 
        ? Math.min(result.resetAt - Date.now(), 1000)
        : 1000
      
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }
    }
    
    throw new Error(`Rate limit wait timeout for ${platform}`)
  }
}

// Singleton instance
let rateLimiterInstance: RedisRateLimiter | null = null

export function getRateLimiter(): RedisRateLimiter {
  if (!rateLimiterInstance) {
    rateLimiterInstance = new RedisRateLimiter()
  }
  return rateLimiterInstance
}

