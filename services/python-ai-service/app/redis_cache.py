"""
Redis Cache Module with Lua Singleflight
Prevents thundering herd and cache stampede using Redis Lua scripts
"""
import os
import asyncio
import json
import hashlib
from typing import Optional, Dict, Any, Callable, Awaitable
import redis.asyncio as redis
from redis.asyncio.connection import ConnectionPool
import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://redis.record-platform.svc.cluster.local:6379/0")
# Increased Redis connection pool for better concurrency
# With 50+ VUs and singleflight, we need more connections for lock polling
# Formula: max_connections = (VUs * concurrent_per_vu) + headroom
# For 50 VUs with 2-3 concurrent requests: 100-150 + 50 headroom = 150-200
# Increased to 150 to handle peak load and prevent connection exhaustion
REDIS_MAX_CONNECTIONS = int(os.getenv("REDIS_MAX_CONNECTIONS", "150"))  # Increased from 100
REDIS_POOL_SIZE = int(os.getenv("REDIS_POOL_SIZE", "75"))  # Increased from 50

# Global Redis connection pool
_redis_pool: Optional[ConnectionPool] = None
_redis_client: Optional[redis.Redis] = None

# Lua script for singleflight (prevents thundering herd)
# This ensures only one request fetches data while others wait
# Note: Redis Lua doesn't support SLEEP, so we return immediately and let Python poll
SINGLEFLIGHT_SCRIPT = """
local key = KEYS[1]
local lock_key = key .. ':lock'
local lock_ttl = tonumber(ARGV[1])
local cache_ttl = tonumber(ARGV[2])
local lock_value = ARGV[3]

-- Try to get cached value
local cached = redis.call('GET', key)
if cached then
    return {1, cached}  -- Cache hit
end

-- Try to acquire lock
local lock_acquired = redis.call('SET', lock_key, lock_value, 'NX', 'EX', lock_ttl)
if lock_acquired then
    return {2, lock_value}  -- Lock acquired, caller should fetch data
else
    -- Lock held by another request, return status to let Python poll
    -- Use empty string instead of nil (Redis doesn't handle nil in arrays well)
    return {3, ''}  -- Lock held, caller should poll
end
"""

# Lua script to release lock and set cache
RELEASE_LOCK_SCRIPT = """
local key = KEYS[1]
local lock_key = key .. ':lock'
local lock_value = ARGV[1]
local cache_value = ARGV[2]
local cache_ttl = tonumber(ARGV[3])

-- Verify we hold the lock
local current_lock = redis.call('GET', lock_key)
if current_lock == lock_value then
    -- Set cache and release lock
    redis.call('SET', key, cache_value, 'EX', cache_ttl)
    redis.call('DEL', lock_key)
    return 1
else
    return 0  -- Lock expired or held by someone else
end
"""


async def get_redis_pool() -> Optional[ConnectionPool]:
    """Get or create Redis connection pool"""
    global _redis_pool
    if _redis_pool:
        return _redis_pool
    
    try:
        # Parse Redis URL
        redis_url = REDIS_URL
        if not redis_url.startswith("redis://"):
            redis_url = f"redis://{redis_url}"
        
        # Create connection pool for better performance
        _redis_pool = ConnectionPool.from_url(
            redis_url,
            max_connections=REDIS_MAX_CONNECTIONS,
            decode_responses=True,
        )
        logger.info(f"[redis-cache] Redis connection pool created (max_connections={REDIS_MAX_CONNECTIONS})")
        return _redis_pool
    except Exception as e:
        logger.error(f"[redis-cache] Failed to create Redis pool: {e}")
        _redis_pool = None
        return None


async def get_redis_client() -> Optional[redis.Redis]:
    """Get Redis client from pool"""
    global _redis_client
    if _redis_client:
        return _redis_client
    
    pool = await get_redis_pool()
    if not pool:
        return None
    
    try:
        _redis_client = redis.Redis(connection_pool=pool)
        # Test connection
        await _redis_client.ping()
        logger.info("[redis-cache] Redis client connected")
        return _redis_client
    except Exception as e:
        logger.warning(f"[redis-cache] Redis client connection failed: {e}")
        _redis_client = None
        return None


async def get_with_singleflight(
    key: str,
    fetch_fn: Callable[[], Awaitable[Any]],
    ttl: int = 300,
    lock_ttl: int = 30,
    use_singleflight: bool = True
) -> Optional[Any]:
    """
    Get value from cache with singleflight protection
    
    Args:
        key: Cache key
        fetch_fn: Async function to fetch data if cache miss
        ttl: Cache TTL in seconds
        lock_ttl: Lock TTL in seconds (how long to wait for lock holder)
        use_singleflight: Enable singleflight (prevents thundering herd)
    
    Returns:
        Cached or freshly fetched value
    """
    client = await get_redis_client()
    if not client:
        # Fallback: fetch directly if Redis unavailable
        logger.warning(f"[redis-cache] Redis unavailable, fetching directly for {key}")
        try:
            return await fetch_fn()
        except Exception as e:
            logger.error(f"[redis-cache] Fetch function failed: {e}")
            return None
    
    try:
        if not use_singleflight:
            # Simple cache get/set without singleflight
            cached = await client.get(key)
            if cached:
                return json.loads(cached)
            
            # Cache miss, fetch and set
            value = await fetch_fn()
            if value is not None:
                await client.setex(key, ttl, json.dumps(value))
            return value
        
        # Use singleflight Lua script
        lock_value = f"{os.getpid()}:{asyncio.current_task().get_name()}:{datetime.utcnow().timestamp()}"
        
        # Load Lua script (cached by Redis)
        script = client.register_script(SINGLEFLIGHT_SCRIPT)
        result = await script(keys=[key], args=[lock_ttl, ttl, lock_value])
        
        if not result:
            # Script failed, fallback to direct fetch
            logger.warning(f"[redis-cache] Singleflight script failed for {key}, falling back")
            return await fetch_fn()
        
        # Handle Redis Lua script return value (can be list or tuple)
        # Redis returns Lua tables as Python lists
        if isinstance(result, (list, tuple)):
            if len(result) >= 2:
                status, data = result[0], result[1]
            elif len(result) == 1:
                # Single value - might be status 3 (lock held) with empty data
                status = result[0]
                data = '' if status == 3 else None
            else:
                logger.warning(f"[redis-cache] Empty result from script: {result}")
                return await fetch_fn()
        else:
            # Unexpected format
            logger.warning(f"[redis-cache] Unexpected result format: {type(result)}, {result}")
            return await fetch_fn()
        
        if status == 1:
            # Cache hit
            return json.loads(data)
        elif status == 2:
            # Lock acquired, fetch data
            try:
                value = await fetch_fn()
                if value is not None:
                    # Release lock and set cache
                    release_script = client.register_script(RELEASE_LOCK_SCRIPT)
                    await release_script(
                        keys=[key],
                        args=[lock_value, json.dumps(value), ttl]
                    )
                return value
            except Exception as e:
                # Fetch failed, release lock
                try:
                    await client.delete(f"{key}:lock")
                except:
                    pass
                logger.error(f"[redis-cache] Fetch failed for {key}: {e}")
                return None
        elif status == 3:
            # Lock held by another request, poll for cache
            max_polls = 30  # Poll up to 30 times (3 seconds total)
            poll_interval = 0.1  # 100ms between polls
            for _ in range(max_polls):
                await asyncio.sleep(poll_interval)
                cached = await client.get(key)
                if cached:
                    # Cache populated by lock holder
                    return json.loads(cached)
            
            # Timeout waiting for lock holder, fallback to direct fetch
            logger.warning(f"[redis-cache] Timeout waiting for lock holder for {key}, fetching directly")
            return await fetch_fn()
        else:
            # Unknown status, fallback to direct fetch
            logger.warning(f"[redis-cache] Unknown status {status} for {key}, fetching directly")
            return await fetch_fn()
    
    except Exception as e:
        logger.error(f"[redis-cache] Error in get_with_singleflight for {key}: {e}")
        # Fallback to direct fetch
        try:
            return await fetch_fn()
        except Exception as fetch_error:
            logger.error(f"[redis-cache] Fallback fetch also failed: {fetch_error}")
            return None


async def set_cache(key: str, value: Any, ttl: int = 300) -> bool:
    """Set cache value"""
    client = await get_redis_client()
    if not client:
        return False
    
    try:
        await client.setex(key, ttl, json.dumps(value))
        return True
    except Exception as e:
        logger.warning(f"[redis-cache] Failed to set cache for {key}: {e}")
        return False


async def get_cache(key: str) -> Optional[Any]:
    """Get cache value (simple, no singleflight)"""
    client = await get_redis_client()
    if not client:
        return None
    
    try:
        cached = await client.get(key)
        if cached:
            return json.loads(cached)
        return None
    except Exception as e:
        logger.warning(f"[redis-cache] Failed to get cache for {key}: {e}")
        return None


async def delete_cache(key: str) -> bool:
    """Delete cache value"""
    client = await get_redis_client()
    if not client:
        return False
    
    try:
        await client.delete(key)
        return True
    except Exception as e:
        logger.warning(f"[redis-cache] Failed to delete cache for {key}: {e}")
        return False


async def close_redis():
    """Close Redis connections"""
    global _redis_client, _redis_pool
    
    if _redis_client:
        try:
            await _redis_client.close()
            logger.info("[redis-cache] Redis client closed")
        except Exception as e:
            logger.error(f"[redis-cache] Error closing Redis client: {e}")
        finally:
            _redis_client = None
    
    if _redis_pool:
        try:
            await _redis_pool.disconnect()
            logger.info("[redis-cache] Redis pool disconnected")
        except Exception as e:
            logger.error(f"[redis-cache] Error disconnecting Redis pool: {e}")
        finally:
            _redis_pool = None

