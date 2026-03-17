"""
L1 In-Memory Cache (Phase 2 Optimization)
Fast, small cache for frequently accessed data
Complements L2 (Redis) and L3 (Database) caches
"""
import asyncio
import os
import time
from typing import Optional, Dict, Any, Tuple
import logging
from collections import OrderedDict

logger = logging.getLogger(__name__)

# L1 cache configuration
L1_MAX_SIZE = int(os.getenv("L1_CACHE_MAX_SIZE", "1000"))  # Max 1000 entries
L1_TTL_SECONDS = int(os.getenv("L1_CACHE_TTL", "300"))  # 5 minutes default TTL


class LRUCache:
    """Thread-safe LRU cache with TTL"""
    
    def __init__(self, max_size: int = 1000, default_ttl: int = 300):
        self.max_size = max_size
        self.default_ttl = default_ttl
        self._cache: OrderedDict = OrderedDict()
        self._timestamps: Dict[str, float] = {}
        self._lock = asyncio.Lock()
    
    async def get(self, key: str) -> Optional[Any]:
        """Get value from cache if not expired"""
        async with self._lock:
            # Check if key exists and not expired
            if key in self._cache:
                timestamp = self._timestamps.get(key, 0)
                if time.time() - timestamp < self.default_ttl:
                    # Move to end (most recently used)
                    self._cache.move_to_end(key)
                    return self._cache[key]
                else:
                    # Expired, remove
                    del self._cache[key]
                    del self._timestamps[key]
            return None
    
    async def set(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        """Set value in cache with TTL"""
        async with self._lock:
            # Remove if exists
            if key in self._cache:
                del self._cache[key]
                del self._timestamps[key]
            
            # Add new entry
            self._cache[key] = value
            self._timestamps[key] = time.time()
            
            # Evict oldest if over limit
            if len(self._cache) > self.max_size:
                oldest_key = next(iter(self._cache))
                del self._cache[oldest_key]
                del self._timestamps[oldest_key]
    
    async def clear(self) -> None:
        """Clear all cache entries"""
        async with self._lock:
            self._cache.clear()
            self._timestamps.clear()
    
    def size(self) -> int:
        """Get current cache size"""
        return len(self._cache)


# Global L1 cache instances
_l1_ebay_cache: Optional[LRUCache] = None
_l1_discogs_cache: Optional[LRUCache] = None
_l1_advice_cache: Optional[LRUCache] = None


def get_l1_ebay_cache() -> LRUCache:
    """Get or create L1 cache for eBay prices"""
    global _l1_ebay_cache
    if _l1_ebay_cache is None:
        _l1_ebay_cache = LRUCache(max_size=L1_MAX_SIZE, default_ttl=L1_TTL_SECONDS)
    return _l1_ebay_cache


def get_l1_discogs_cache() -> LRUCache:
    """Get or create L1 cache for Discogs titles"""
    global _l1_discogs_cache
    if _l1_discogs_cache is None:
        _l1_discogs_cache = LRUCache(max_size=L1_MAX_SIZE, default_ttl=L1_TTL_SECONDS)
    return _l1_discogs_cache


def get_l1_advice_cache() -> LRUCache:
    """Get or create L1 cache for AI advice"""
    global _l1_advice_cache
    if _l1_advice_cache is None:
        _l1_advice_cache = LRUCache(max_size=L1_MAX_SIZE, default_ttl=L1_TTL_SECONDS)
    return _l1_advice_cache

