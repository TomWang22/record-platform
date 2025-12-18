"""
Rate Limiter for External APIs
Prevents hitting rate limits on Discogs and eBay APIs
Uses Redis to track request counts per time window
"""
import os
import asyncio
import time
from typing import Optional
import redis.asyncio as redis
from redis.asyncio.connection import ConnectionPool
import logging

logger = logging.getLogger(__name__)

# Rate limits (requests per minute)
# Discogs: 60 requests/minute (1 req/sec)
# eBay: Varies by API, typically 5,000/day or ~3.5 req/min for Finding API
DISCOGS_RATE_LIMIT = int(os.getenv("DISCOGS_RATE_LIMIT", "50"))  # Conservative: 50/min
EBAY_RATE_LIMIT = int(os.getenv("EBAY_RATE_LIMIT", "50"))  # Conservative: 50/min

# Redis connection (reuse from redis_cache)
_redis_pool: Optional[ConnectionPool] = None
_redis_client: Optional[redis.Redis] = None


async def get_redis_for_rate_limiter() -> Optional[redis.Redis]:
    """Get Redis client for rate limiting (reuse pool from redis_cache if available)"""
    global _redis_client, _redis_pool
    
    if _redis_client:
        try:
            await _redis_client.ping()
            return _redis_client
        except:
            _redis_client = None
    
    # Try to import from redis_cache to reuse pool
    try:
        from app.redis_cache import get_redis_client
        client = await get_redis_client()
        if client:
            _redis_client = client
            return client
    except:
        pass
    
    # Fallback: create own connection
    try:
        REDIS_URL = os.getenv("REDIS_URL", "redis://redis.record-platform.svc.cluster.local:6379/0")
        if not _redis_pool:
            _redis_pool = ConnectionPool.from_url(
                REDIS_URL,
                max_connections=10,
                decode_responses=True,
            )
        _redis_client = redis.Redis(connection_pool=_redis_pool)
        await _redis_client.ping()
        return _redis_client
    except Exception as e:
        logger.warning(f"[rate-limiter] Redis unavailable: {e}")
        return None


async def check_rate_limit(api_name: str, limit: int, window_seconds: int = 60) -> bool:
    """
    Check if request is within rate limit
    
    Args:
        api_name: Name of API (e.g., 'discogs', 'ebay')
        limit: Max requests per window
        window_seconds: Time window in seconds (default: 60 = 1 minute)
    
    Returns:
        True if within limit, False if rate limited
    """
    client = await get_redis_for_rate_limiter()
    if not client:
        # If Redis unavailable, allow request (graceful degradation)
        return True
    
    try:
        key = f"rate_limit:{api_name}:{int(time.time() / window_seconds)}"
        current = await client.incr(key)
        
        if current == 1:
            # First request in this window, set expiration
            await client.expire(key, window_seconds)
        
        if current > limit:
            logger.warning(f"[rate-limiter] Rate limit exceeded for {api_name}: {current}/{limit} requests in {window_seconds}s")
            return False
        
        return True
    except Exception as e:
        logger.warning(f"[rate-limiter] Error checking rate limit for {api_name}: {e}")
        # On error, allow request (fail open)
        return True


async def wait_for_rate_limit(api_name: str, limit: int, window_seconds: int = 60, max_wait: float = 5.0) -> bool:
    """
    Wait until rate limit allows request (with timeout)
    
    Returns:
        True if rate limit allows, False if timeout
    """
    start_time = time.time()
    poll_interval = 0.1  # 100ms
    
    while time.time() - start_time < max_wait:
        if await check_rate_limit(api_name, limit, window_seconds):
            return True
        await asyncio.sleep(poll_interval)
    
    logger.warning(f"[rate-limiter] Timeout waiting for rate limit for {api_name}")
    return False

