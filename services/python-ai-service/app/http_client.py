"""
Shared HTTP Client for External API Calls
Provides connection pooling and reuse for better performance
"""
import httpx
import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Shared HTTP client instances for external APIs
_ebay_client: Optional[httpx.AsyncClient] = None
_discogs_client: Optional[httpx.AsyncClient] = None

# Connection pool limits for external APIs (balanced for baseline - 1 replica)
# Formula: max_connections = (concurrent_requests * avg_duration) + headroom
# For 50 VUs with 1-2 concurrent external API calls: 50-100 + 50 headroom = 100-150
# Set to 125 for baseline (balanced - not too aggressive)
EXTERNAL_API_MAX_CONNECTIONS = int(os.getenv("EXTERNAL_API_MAX_CONNECTIONS", "125"))  # Balanced
EXTERNAL_API_MAX_KEEPALIVE = int(os.getenv("EXTERNAL_API_MAX_KEEPALIVE", "75"))  # Balanced
EXTERNAL_API_KEEPALIVE_EXPIRY = float(os.getenv("EXTERNAL_API_KEEPALIVE_EXPIRY", "90.0"))  # Balanced


async def get_ebay_client() -> httpx.AsyncClient:
    """Get or create shared eBay HTTP client with connection pooling"""
    global _ebay_client
    
    if _ebay_client is None:
        _ebay_client = httpx.AsyncClient(
            timeout=httpx.Timeout(8.0, connect=3.0, read=8.0),  # Phase 1: Reduced from 15s to 8s (fail faster)
            limits=httpx.Limits(
                max_connections=EXTERNAL_API_MAX_CONNECTIONS,
                max_keepalive_connections=EXTERNAL_API_MAX_KEEPALIVE,
                keepalive_expiry=EXTERNAL_API_KEEPALIVE_EXPIRY,
            ),
            http2=False,  # eBay APIs don't support HTTP/2
            follow_redirects=True,
        )
        logger.info(f"[http-client] eBay client created (max_connections={EXTERNAL_API_MAX_CONNECTIONS})")
    
    return _ebay_client


async def get_discogs_client() -> httpx.AsyncClient:
    """Get or create shared Discogs HTTP client with connection pooling"""
    global _discogs_client
    
    if _discogs_client is None:
        _discogs_client = httpx.AsyncClient(
            timeout=httpx.Timeout(8.0, connect=3.0, read=8.0),  # Phase 1: Reduced from 15s to 8s (fail faster)
            limits=httpx.Limits(
                max_connections=EXTERNAL_API_MAX_CONNECTIONS,
                max_keepalive_connections=EXTERNAL_API_MAX_KEEPALIVE,
                keepalive_expiry=EXTERNAL_API_KEEPALIVE_EXPIRY,
            ),
            http2=False,  # Discogs API doesn't support HTTP/2
            follow_redirects=True,
        )
        logger.info(f"[http-client] Discogs client created (max_connections={EXTERNAL_API_MAX_CONNECTIONS})")
    
    return _discogs_client


async def close_clients():
    """Close all HTTP clients (called on shutdown)"""
    global _ebay_client, _discogs_client
    
    if _ebay_client:
        try:
            await _ebay_client.aclose()
            logger.info("[http-client] eBay client closed")
        except Exception as e:
            logger.warning(f"[http-client] Error closing eBay client: {e}")
        _ebay_client = None
    
    if _discogs_client:
        try:
            await _discogs_client.aclose()
            logger.info("[http-client] Discogs client closed")
        except Exception as e:
            logger.warning(f"[http-client] Error closing Discogs client: {e}")
        _discogs_client = None

