/**
 * Redis Cache with Lua Scripts for Listings Service
 * 
 * Implements efficient caching for write-heavy, cache-heavy workloads.
 * Uses Lua scripts for atomic operations and reduced network round-trips.
 */

import { createClient, type RedisClientType } from 'redis';

// Redis client (shared instance)
let redisClient: RedisClientType | null = null;

// Cache statistics (in-memory counters)
let cacheHits = 0;
let cacheMisses = 0;

// Initialize Redis client
export function getRedisClient(): RedisClientType | null {
  if (redisClient) {
    return redisClient;
  }

  try {
    let REDIS_URL = process.env.REDIS_URL || "redis://redis:6379/0";
    const rawPassword = process.env.REDIS_PASSWORD;
    const REDIS_PASSWORD = rawPassword && String(rawPassword).trim() ? rawPassword : undefined;
    
    // Only add password to URL if it exists and URL doesn't already have auth
    if (REDIS_PASSWORD && !REDIS_URL.includes('@') && !REDIS_URL.includes('://:')) {
      REDIS_URL = REDIS_URL.replace('redis://', `redis://:${REDIS_PASSWORD}@`);
    }

    // Create client with explicit socket configuration to prevent auto-auth
    // If no password (or empty string when Redis is externalized without auth), don't send AUTH
    const clientConfig: any = {
      url: REDIS_URL,
      socket: { connectTimeout: 10_000 },
    };
    if (!REDIS_PASSWORD) {
      // Explicitly disable password authentication if no password is set
      // This prevents the redis client from sending AUTH with empty password
      clientConfig.password = undefined;
    }

    redisClient = createClient(clientConfig) as RedisClientType;
    
    redisClient.on('error', (err: Error) => {
      console.warn('[listings-redis] Redis error (non-fatal):', err.message);
    });

    // Connect asynchronously (don't block startup)
    (async () => {
      try {
        await redisClient!.connect();
        console.log('[listings-redis] Redis connected for caching');
      } catch (err) {
        console.warn('[listings-redis] Redis connection failed (continuing without cache):', err);
        redisClient = null;
      }
    })();

    return redisClient;
  } catch (err) {
    console.warn('[listings-redis] Redis initialization failed (continuing without cache):', err);
    return null;
  }
}

// Cache TTLs
const LISTING_CACHE_TTL = 300; // 5 minutes for individual listings
const SEARCH_CACHE_TTL = 60; // 1 minute for search results (shorter, more dynamic)
const WATCHLIST_CACHE_TTL = 180; // 3 minutes for watchlist

// Lua script for atomic listing cache update with TTL refresh
const LISTING_CACHE_UPDATE_SCRIPT = `
  local cacheKey = KEYS[1]
  local listingData = ARGV[1]
  local ttl = ARGV[2]
  
  -- Set cache with TTL
  redis.call('SETEX', cacheKey, ttl, listingData)
  return 'OK'
`;

// Lua script for atomic cache invalidation (pattern-based)
const CACHE_INVALIDATE_PATTERN_SCRIPT = `
  local pattern = KEYS[1]
  local keys = redis.call('KEYS', pattern)
  local deleted = 0
  
  if #keys > 0 then
    deleted = redis.call('DEL', unpack(keys))
  end
  
  return deleted
`;

// Lua script for atomic search result caching with size limit
const SEARCH_CACHE_UPDATE_SCRIPT = `
  local cacheKey = KEYS[1]
  local searchData = ARGV[1]
  local ttl = ARGV[2]
  local maxSize = tonumber(ARGV[3]) or 1048576  -- 1MB default
  
  -- Check size before caching (prevent memory bloat)
  if string.len(searchData) > maxSize then
    return 'TOO_LARGE'
  end
  
  -- Set cache with TTL
  redis.call('SETEX', cacheKey, ttl, searchData)
  return 'OK'
`;

// Lua script for atomic watchlist cache update
const WATCHLIST_CACHE_UPDATE_SCRIPT = `
  local cacheKey = KEYS[1]
  local watchlistData = ARGV[1]
  local ttl = ARGV[2]
  
  -- Set cache with TTL
  redis.call('SETEX', cacheKey, ttl, watchlistData)
  return 'OK'
`;

/**
 * Cache a listing by ID
 */
export async function cacheListing(listingId: string, listingData: any): Promise<void> {
  const client = getRedisClient();
  if (!client || !client.isOpen) {
    return;
  }

  try {
    const cacheKey = `listing:${listingId}`;
    const data = JSON.stringify(listingData);

    await client.eval(LISTING_CACHE_UPDATE_SCRIPT, {
      keys: [cacheKey],
      arguments: [data, LISTING_CACHE_TTL.toString()],
    });
  } catch (err) {
    console.warn('[listings-redis] Failed to cache listing:', err);
  }
}

/**
 * Get listing from cache
 * Returns cached data or null if cache miss
 */
export async function getListingFromCache(listingId: string): Promise<any | null> {
  const client = getRedisClient();
  if (!client || !client.isOpen) {
    cacheMisses++;
    return null;
  }

  try {
    const cacheKey = `listing:${listingId}`;
    const result = await client.get(cacheKey);
    
    if (!result) {
      cacheMisses++;
      return null;
    }

    cacheHits++;
    return JSON.parse(result);
  } catch (err) {
    cacheMisses++;
    return null;
  }
}

/**
 * Get cache hit/miss statistics
 */
export function getCacheHitMissStats(): {
  hits: number;
  misses: number;
  hitRate: number;
  total: number;
} {
  const total = cacheHits + cacheMisses;
  const hitRate = total > 0 ? (cacheHits / total) * 100 : 0;
  
  return {
    hits: cacheHits,
    misses: cacheMisses,
    hitRate: Math.round(hitRate * 100) / 100, // Round to 2 decimal places
    total,
  };
}

/**
 * Reset cache statistics (for testing)
 */
export function resetCacheStats(): void {
  cacheHits = 0;
  cacheMisses = 0;
}

/**
 * Invalidate listing cache
 */
export async function invalidateListingCache(listingId: string): Promise<void> {
  const client = getRedisClient();
  if (!client || !client.isOpen) {
    return;
  }

  try {
    const cacheKey = `listing:${listingId}`;
    await client.del(cacheKey);
  } catch (err) {
    console.warn('[listings-redis] Failed to invalidate listing cache:', err);
  }
}

/**
 * Cache search results
 */
export async function cacheSearchResults(query: string, source: string, results: any[]): Promise<void> {
  const client = getRedisClient();
  if (!client || !client.isOpen) {
    return;
  }

  try {
    const cacheKey = `search:${source}:${query.toLowerCase()}`;
    const data = JSON.stringify(results);

    const result = await client.eval(SEARCH_CACHE_UPDATE_SCRIPT, {
      keys: [cacheKey],
      arguments: [data, SEARCH_CACHE_TTL.toString(), '1048576'], // 1MB max
    });

    if (result === 'TOO_LARGE') {
      console.warn('[listings-redis] Search results too large to cache');
    }
  } catch (err) {
    console.warn('[listings-redis] Failed to cache search results:', err);
  }
}

/**
 * Get search results from cache
 */
export async function getSearchResultsFromCache(query: string, source: string): Promise<any[] | null> {
  const client = getRedisClient();
  if (!client || !client.isOpen) {
    return null;
  }

  try {
    const cacheKey = `search:${source}:${query.toLowerCase()}`;
    const result = await client.get(cacheKey);
    
    if (!result) {
      return null;
    }

    return JSON.parse(result);
  } catch (err) {
    return null;
  }
}

/**
 * Cache watchlist for user
 */
export async function cacheWatchlist(userId: string, watchlist: any[]): Promise<void> {
  const client = getRedisClient();
  if (!client || !client.isOpen) {
    return;
  }

  try {
    const cacheKey = `watchlist:${userId}`;
    const data = JSON.stringify(watchlist);

    await client.eval(WATCHLIST_CACHE_UPDATE_SCRIPT, {
      keys: [cacheKey],
      arguments: [data, WATCHLIST_CACHE_TTL.toString()],
    });
  } catch (err) {
    console.warn('[listings-redis] Failed to cache watchlist:', err);
  }
}

/**
 * Get watchlist from cache
 */
export async function getWatchlistFromCache(userId: string): Promise<any[] | null> {
  const client = getRedisClient();
  if (!client || !client.isOpen) {
    return null;
  }

  try {
    const cacheKey = `watchlist:${userId}`;
    const result = await client.get(cacheKey);
    
    if (!result) {
      return null;
    }

    return JSON.parse(result);
  } catch (err) {
    return null;
  }
}

/**
 * Invalidate watchlist cache for user
 */
export async function invalidateWatchlistCache(userId: string): Promise<void> {
  const client = getRedisClient();
  if (!client || !client.isOpen) {
    return;
  }

  try {
    const cacheKey = `watchlist:${userId}`;
    await client.del(cacheKey);
  } catch (err) {
    console.warn('[listings-redis] Failed to invalidate watchlist cache:', err);
  }
}

/**
 * Invalidate all listing-related caches (for bulk updates)
 */
export async function invalidateAllListingCaches(): Promise<void> {
  const client = getRedisClient();
  if (!client || !client.isOpen) {
    return;
  }

  try {
    // Use pattern-based deletion (be careful with large datasets)
    const deleted = await client.eval(CACHE_INVALIDATE_PATTERN_SCRIPT, {
      keys: ['listing:*'],
      arguments: [],
    });
    console.log(`[listings-redis] Invalidated ${deleted} listing caches`);
  } catch (err) {
    console.warn('[listings-redis] Failed to invalidate all listing caches:', err);
  }
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<{
  connected: boolean;
  listingCacheKeys: number;
  searchCacheKeys: number;
  watchlistCacheKeys: number;
}> {
  const client = getRedisClient();
  if (!client || !client.isOpen) {
    return { connected: false, listingCacheKeys: 0, searchCacheKeys: 0, watchlistCacheKeys: 0 };
  }

  try {
    const listingKeys = await client.keys('listing:*');
    const searchKeys = await client.keys('search:*');
    const watchlistKeys = await client.keys('watchlist:*');
    
    return {
      connected: true,
      listingCacheKeys: listingKeys.length,
      searchCacheKeys: searchKeys.length,
      watchlistCacheKeys: watchlistKeys.length,
    };
  } catch (err) {
    return { connected: false, listingCacheKeys: 0, searchCacheKeys: 0, watchlistCacheKeys: 0 };
  }
}

