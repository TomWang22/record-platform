"""
Data Pipeline for Python AI Service
Ingests data from analytics service and processes it for AI recommendations
"""
import os
import asyncio
import httpx
import json
import ssl
from typing import Optional, Dict, List, Any
from datetime import datetime, timedelta
from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
import logging

# Use centralized Redis cache module with singleflight
from app.redis_cache import get_with_singleflight, set_cache, get_cache, get_redis_client

logger = logging.getLogger(__name__)

ANALYTICS_URL = os.getenv("ANALYTICS_URL", "http://analytics-service.record-platform.svc.cluster.local:4004")
# Default to SSL port 9093 for strict TLS (can override with KAFKA_BROKER env var)
KAFKA_BROKER = os.getenv("KAFKA_BROKER", "kafka.record-platform.svc.cluster.local:9093")
ENABLE_KAFKA = os.getenv("ENABLE_KAFKA", "true").lower() == "true"
# Kafka SSL configuration
KAFKA_SSL_CA_CERT = os.getenv("KAFKA_SSL_CA_CERT", "/etc/kafka/secrets/ca-cert.pem")
KAFKA_USE_SSL = os.getenv("KAFKA_USE_SSL", "true").lower() == "true"

# Kafka connections
kafka_producer: Optional[AIOKafkaProducer] = None
kafka_consumer: Optional[AIOKafkaConsumer] = None


async def get_redis():
    """Get Redis client (delegates to redis_cache module)"""
    return await get_redis_client()


def _get_kafka_ssl_context() -> Optional[ssl.SSLContext]:
    """Create SSL context for Kafka connection with strict TLS"""
    if not KAFKA_USE_SSL:
        return None
    
    try:
        ssl_context = ssl.create_default_context()
        
        # Load CA certificate if it exists (for server certificate verification)
        if os.path.exists(KAFKA_SSL_CA_CERT):
            ssl_context.load_verify_locations(KAFKA_SSL_CA_CERT)
            logger.info(f"[data-pipeline] Loaded Kafka CA certificate from {KAFKA_SSL_CA_CERT}")
            # Verify hostname (strict TLS)
            ssl_context.check_hostname = True
            ssl_context.verify_mode = ssl.CERT_REQUIRED
        else:
            # Strict TLS: no cleartext fallback. Refuse to connect without valid CA.
            logger.error(f"[data-pipeline] Kafka CA certificate not found at {KAFKA_SSL_CA_CERT}")
            raise FileNotFoundError(
                f"KAFKA_USE_SSL=true but CA cert missing at {KAFKA_SSL_CA_CERT}. "
                "Mount kafka-ssl-secret and set KAFKA_SSL_CA_CERT. No plaintext fallback."
            )

        return ssl_context
    except FileNotFoundError:
        raise
    except Exception as e:
        logger.error(f"[data-pipeline] Failed to create Kafka SSL context: {e}")
        raise RuntimeError(
            "Strict TLS: cannot create Kafka SSL context. Fix CA cert or disable KAFKA_USE_SSL. No unverified fallback."
        ) from e


async def get_kafka_producer() -> Optional[AIOKafkaProducer]:
    """Get or create Kafka producer with SSL support for strict TLS"""
    global kafka_producer
    if not ENABLE_KAFKA:
        return None
    if kafka_producer:
        return kafka_producer
    try:
        # Configure SSL if enabled
        ssl_context = _get_kafka_ssl_context() if KAFKA_USE_SSL else None
        security_protocol = "SSL" if KAFKA_USE_SSL else "PLAINTEXT"
        
        kafka_producer = AIOKafkaProducer(
            bootstrap_servers=KAFKA_BROKER,
            value_serializer=lambda v: json.dumps(v).encode('utf-8'),
            key_serializer=lambda k: k.encode('utf-8') if k else None,
            security_protocol=security_protocol,
            ssl_context=ssl_context,
        )
        await kafka_producer.start()
        logger.info(f"[data-pipeline] Kafka producer connected to {KAFKA_BROKER} with {security_protocol}")
        return kafka_producer
    except Exception as e:
        logger.warning(f"[data-pipeline] Kafka producer connection failed: {e}")
        kafka_producer = None
        return None


async def fetch_analytics_data(endpoint: str, params: Optional[Dict] = None, timeout: float = 12.0, max_retries: int = 3) -> Optional[Dict]:
    """
    Fetch data from analytics service with retry logic and fault tolerance
    Uses exponential backoff for retries (0.5s, 1s, 2s)
    
    Note: httpx uses HTTP/1.1 by default. Analytics service (Express) doesn't support HTTP/2.
    Connection pooling helps but HTTP/1.1 has no multiplexing (one request per connection).
    """
    url = f"{ANALYTICS_URL.rstrip('/')}/{endpoint.lstrip('/')}"
    
    # Use a shared HTTP client for connection reuse (better than creating new client each time)
    # Note: httpx.AsyncClient doesn't support HTTP/2 without h2 library, and analytics service
    # (Express) doesn't support HTTP/2 anyway, so we stick with HTTP/1.1 with connection pooling
    for attempt in range(max_retries):
        try:
            # Use connection pooling balanced for baseline (1 replica)
            # Baseline: 50 VUs with 1 replica = need balanced connections
            # Formula: max_connections = (VUs * concurrent_per_vu) + headroom
            # For 50 VUs with 1-2 concurrent requests: 50-100 + 100 headroom = 150-200
            # Set to 150 for baseline (balanced - not too aggressive)
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(timeout, connect=3.0, read=timeout),  # Reduced connect timeout (fail faster)
                limits=httpx.Limits(
                    max_connections=150,  # Balanced (not too small, not too large)
                    max_keepalive_connections=75,  # Balanced
                    keepalive_expiry=90.0  # Balanced (not too short)
                ),
                http2=False,  # Explicitly disable HTTP/2 (analytics service doesn't support it)
            ) as client:
                response = await client.get(url, params=params or {})
                response.raise_for_status()
                return response.json()
        except (httpx.TimeoutException, httpx.ConnectError, httpx.NetworkError) as e:
            if attempt < max_retries - 1:
                # Exponential backoff: 0.5s, 1s, 2s
                wait_time = 0.5 * (2 ** attempt)
                logger.warning(f"[data-pipeline] Attempt {attempt + 1}/{max_retries} failed for {endpoint}: {e}, retrying in {wait_time}s...")
                await asyncio.sleep(wait_time)
            else:
                logger.warning(f"[data-pipeline] All {max_retries} attempts failed for {endpoint}: {e}")
                return None
        except httpx.HTTPStatusError as e:
            # Don't retry on HTTP errors (4xx, 5xx) - these are not transient
            logger.warning(f"[data-pipeline] HTTP error fetching {endpoint}: {e.response.status_code}")
            return None
        except Exception as e:
            if attempt < max_retries - 1:
                wait_time = 0.5 * (2 ** attempt)
                logger.warning(f"[data-pipeline] Attempt {attempt + 1}/{max_retries} failed for {endpoint}: {e}, retrying in {wait_time}s...")
                await asyncio.sleep(wait_time)
            else:
                logger.error(f"[data-pipeline] Failed to fetch {endpoint}: {e}")
                return None
    
    return None


async def fetch_price_trend(query: str, days: int = 30) -> Optional[Dict]:
    """
    Fetch price trend data from analytics service
    Note: Analytics service expects 'artist' and 'name' parameters, not 'q'
    For now, we'll skip this endpoint or parse the query to extract artist/name
    """
    # Analytics service requires artist and name, not a single query string
    # Try to parse query (format: "Artist Album Name" or "Artist - Album")
    # For now, return None to avoid 400 errors - this endpoint needs proper query parsing
    # TODO: Implement query parsing to extract artist and name from query string
    logger.debug(f"[data-pipeline] Price trend endpoint requires artist/name, skipping for query: {query}")
    return None


async def fetch_similar_searches(query: str, user_id: Optional[str] = None, limit: int = 10) -> Optional[Dict]:
    """
    Fetch similar searches from analytics service
    Handles database errors gracefully (returns None if service unavailable)
    """
    params = {"q": query, "limit": limit}
    if user_id:
        params["userId"] = user_id
    result = await fetch_analytics_data("/analytics/recommendations/similar", params, timeout=3.0, max_retries=3)
    # If we get an error response, return None gracefully
    if result and "error" in result:
        logger.warning(f"[data-pipeline] Analytics similar searches returned error: {result.get('error')}")
        return None
    return result


async def fetch_trending_searches(days: int = 7, limit: int = 20) -> Optional[Dict]:
    """Fetch trending searches from analytics service"""
    return await fetch_analytics_data("/analytics/trending", {"days": days, "limit": limit})


async def fetch_user_history(user_id: str, limit: int = 50) -> Optional[Dict]:
    """
    Fetch user search history from analytics service
    Handles database errors gracefully (returns None if service unavailable)
    """
    result = await fetch_analytics_data(f"/analytics/user/{user_id}/history", {"limit": limit}, timeout=3.0, max_retries=3)
    # If we get an error response, return None gracefully
    if result and "error" in result:
        logger.warning(f"[data-pipeline] Analytics user history returned error: {result.get('error')}")
        return None
    return result


async def predict_price_from_analytics(items: List[Dict], timeout: float = 8.0, max_retries: int = 3) -> Optional[Dict]:
    """
    Get price prediction from analytics service with retry logic and fault tolerance
    Uses exponential backoff for retries
    
    Note: Analytics predict-price endpoint uses worker threads which can be slow.
    Increased timeout to 8s with 3 retries to handle slow responses under load (50+ VUs).
    """
    url = f"{ANALYTICS_URL.rstrip('/')}/analytics/predict-price"
    
    for attempt in range(max_retries):
        try:
            # Use connection pooling balanced for baseline (1 replica)
            # Note: HTTP/1.1 limitation - no multiplexing, but connection reuse helps
            # Balanced limits for baseline performance
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(timeout, connect=3.0, read=timeout),  # Reduced connect timeout
                limits=httpx.Limits(
                    max_connections=150,  # Balanced (not too small, not too large)
                    max_keepalive_connections=75,  # Balanced
                    keepalive_expiry=90.0  # Balanced (not too short)
                ),
                http2=False,  # Analytics service (Express) doesn't support HTTP/2
            ) as client:
                response = await client.post(url, json={"items": items})
                response.raise_for_status()
                return response.json()
        except (httpx.TimeoutException, httpx.ConnectError, httpx.NetworkError) as e:
            if attempt < max_retries - 1:
                wait_time = 0.5 * (2 ** attempt)
                logger.warning(f"[data-pipeline] Attempt {attempt + 1}/{max_retries} failed for price prediction: {e}, retrying in {wait_time}s...")
                await asyncio.sleep(wait_time)
            else:
                logger.warning(f"[data-pipeline] All {max_retries} attempts failed for price prediction: {e}")
                return None
        except httpx.HTTPStatusError as e:
            logger.warning(f"[data-pipeline] HTTP error predicting price: {e.response.status_code}")
            return None
        except Exception as e:
            if attempt < max_retries - 1:
                wait_time = 0.5 * (2 ** attempt)
                logger.warning(f"[data-pipeline] Attempt {attempt + 1}/{max_retries} failed for price prediction: {e}, retrying in {wait_time}s...")
                await asyncio.sleep(wait_time)
            else:
                logger.error(f"[data-pipeline] Failed to predict price: {e}")
                return None
    
    return None


async def cache_data(key: str, data: Any, ttl: int = 300) -> bool:
    """Cache data in Redis (with database fallback)"""
    # Use centralized Redis cache module
    success = await set_cache(key, data, ttl)
    if success:
        return True
    
    # Fallback to database cache if Redis unavailable
    try:
        from app.db import store_analytics_cache
        parts = key.split(":")
        if len(parts) >= 3:
            cache_type = parts[1]  # e.g., "trend", "ingest", "similar"
            query = ":".join(parts[2:])  # Rest is query/user_id
            user_id = None
            if ":" in query:
                query, user_id = query.rsplit(":", 1)
            
            ttl_minutes = ttl // 60
            await store_analytics_cache(query, cache_type, user_id, data, ttl_minutes)
            return True
    except Exception as e:
        logger.debug(f"[data-pipeline] Database cache write failed: {e}")
    
    return False


async def get_cached_data(key: str) -> Optional[Any]:
    """Get cached data from Redis (with database fallback)"""
    # Use centralized Redis cache module
    cached = await get_cache(key)
    if cached is not None:
        return cached
    
    # Fallback to database cache if Redis unavailable
    # Extract query and cache type from key (format: ai:{type}:{query}:{user_id})
    try:
        from app.db import get_cached_analytics
        parts = key.split(":")
        if len(parts) >= 3:
            cache_type = parts[1]  # e.g., "trend", "ingest", "similar"
            query = ":".join(parts[2:])  # Rest is query/user_id
            user_id = None
            if ":" in query:
                query, user_id = query.rsplit(":", 1)
            
            db_cached = await get_cached_analytics(query, cache_type, user_id)
            if db_cached:
                return db_cached.get("cached_data")
    except Exception as e:
        logger.debug(f"[data-pipeline] Database cache read failed: {e}")
    
    return None


async def publish_ai_event(event_type: str, data: Dict) -> bool:
    """Publish AI event to Kafka"""
    producer = await get_kafka_producer()
    if not producer:
        return False
    try:
        await producer.send(
            "ai-events",
            key=event_type,
            value={
                "event_type": event_type,
                "timestamp": datetime.utcnow().isoformat(),
                **data,
            }
        )
        return True
    except Exception as e:
        logger.warning(f"[data-pipeline] Kafka publish failed: {e}")
        return False


async def ingest_analytics_data(query: str, user_id: Optional[str] = None) -> Dict:
    """
    Ingest comprehensive data from analytics service for a query
    Returns enriched data for AI processing
    Uses singleflight to prevent thundering herd
    """
    cache_key = f"ai:ingest:{query}:{user_id or 'anonymous'}"
    
    # Use singleflight to prevent thundering herd
    async def fetch_data():
        """Fetch data from analytics service in parallel with fault tolerance"""
        # Fetch data from analytics service in parallel with optimized timeouts
        # Reduced timeouts for baseline (fail faster, use cached data on timeout)
        # Analytics service can be slow under load, but we want to fail fast and use cache
        # Use asyncio.wait_for to enforce strict timeouts and prevent hanging
        price_trend_task = asyncio.create_task(asyncio.wait_for(fetch_price_trend(query, days=30), timeout=2.0))  # Reduced from 3s
        similar_searches_task = asyncio.create_task(asyncio.wait_for(fetch_similar_searches(query, user_id, limit=10), timeout=2.0))  # Reduced from 3s
        user_history_task = asyncio.create_task(asyncio.wait_for(fetch_user_history(user_id, limit=20), timeout=2.0)) if user_id else asyncio.create_task(asyncio.sleep(0))  # Reduced from 3s
        
        price_trend, similar_searches, user_history = await asyncio.gather(
            price_trend_task,
            similar_searches_task,
            user_history_task,
            return_exceptions=True
        )
        
        # Build enriched data structure
        # Handle both Exception objects and None values gracefully
        enriched_data = {
            "query": query,
            "user_id": user_id,
            "timestamp": datetime.utcnow().isoformat(),
            "price_trend": price_trend if not isinstance(price_trend, Exception) and price_trend is not None else None,
            "similar_searches": similar_searches if not isinstance(similar_searches, Exception) and similar_searches is not None else None,
            "user_history": user_history if not isinstance(user_history, Exception) and user_history is not None else None,
        }
        
        # Log what we successfully fetched
        if enriched_data.get("similar_searches"):
            logger.debug(f"[data-pipeline] Successfully fetched similar searches for {query}")
        if enriched_data.get("user_history"):
            logger.debug(f"[data-pipeline] Successfully fetched user history for {user_id}")
        
        # Publish ingestion event (non-blocking)
        asyncio.create_task(publish_ai_event("data_ingestion", {
            "query": query,
            "user_id": user_id,
            "has_price_trend": price_trend is not None,
            "has_similar_searches": similar_searches is not None,
            "has_user_history": user_history is not None,
        }))
        
        return enriched_data
    
    # Use singleflight: only one request fetches, others wait for result
    # Reduced lock_ttl from 30s to 5s to prevent long waits during high load
    result = await get_with_singleflight(
        key=cache_key,
        fetch_fn=fetch_data,
        ttl=600,  # 10 minutes cache
        lock_ttl=5,  # Wait up to 5s for lock holder (reduced from 30s for better latency)
        use_singleflight=True
    )
    
    if result:
        return result
    
    # Fallback: return empty structure if fetch failed
    logger.warning(f"[data-pipeline] Failed to ingest analytics data for {query}")
    return {
        "query": query,
        "user_id": user_id,
        "timestamp": datetime.utcnow().isoformat(),
        "price_trend": None,
        "similar_searches": None,
        "user_history": None,
    }


async def start_kafka_consumer():
    """Start Kafka consumer for real-time analytics events with SSL support for strict TLS.
    Non-blocking: if Kafka is unreachable (e.g. external broker not reachable from pod), logs once and exits
    so the service stays healthy; gRPC and HTTP (selling-advice, etc.) work without Kafka.
    """
    if not ENABLE_KAFKA:
        return
    
    global kafka_consumer
    consumer = None
    try:
        # Configure SSL if enabled
        ssl_context = _get_kafka_ssl_context() if KAFKA_USE_SSL else None
        security_protocol = "SSL" if KAFKA_USE_SSL else "PLAINTEXT"
        
        consumer = AIOKafkaConsumer(
            "analytics-predictions",
            "analytics-searches",
            bootstrap_servers=KAFKA_BROKER,
            value_deserializer=lambda m: json.loads(m.decode('utf-8')),
            group_id="python-ai-service",
            auto_offset_reset="latest",
            max_poll_interval_ms=300000,  # 5 minutes (default is 5min, but increase for slow processing)
            max_poll_records=10,  # Process fewer records per poll to avoid timeout
            session_timeout_ms=30000,  # 30 seconds
            heartbeat_interval_ms=10000,  # 10 seconds
            security_protocol=security_protocol,
            ssl_context=ssl_context,
        )
        await consumer.start()
        kafka_consumer = consumer
        logger.info(f"[data-pipeline] Kafka consumer started, connected to {KAFKA_BROKER} with {security_protocol}")
        
        async for message in kafka_consumer:
            try:
                event = message.value
                event_type = event.get("event_type")
                
                # Process analytics events
                if event_type == "price_prediction":
                    # Invalidate cache for related queries
                    query = event.get("items", [{}])[0].get("query")
                    if query:
                        cache_key = f"ai:ingest:{query}:*"
                        # Note: Redis pattern deletion would require SCAN, simplified here
                        logger.debug(f"[data-pipeline] Received price prediction event for {query}")
                
                elif event_type == "search_logged":
                    # Update trending cache
                    query = event.get("query")
                    if query:
                        cache_key = f"ai:trending:*"
                        logger.debug(f"[data-pipeline] Received search event for {query}")
                
            except Exception as e:
                logger.error(f"[data-pipeline] Error processing Kafka message: {e}")
    
    except Exception as e:
        logger.warning(
            "[data-pipeline] Kafka consumer unavailable (service continues without it): %s. "
            "Set ENABLE_KAFKA=false or ensure Kafka is reachable from pods (e.g. kafka-external Endpoints -> host:29093).",
            e,
        )
        if consumer is not None:
            try:
                await consumer.stop()
            except Exception as stop_err:
                logger.debug("[data-pipeline] Error stopping failed Kafka consumer: %s", stop_err)
        kafka_consumer = None


async def shutdown():
    """Shutdown data pipeline connections"""
    global kafka_producer, kafka_consumer
    
    if kafka_consumer:
        try:
            await kafka_consumer.stop()
            logger.info("[data-pipeline] Kafka consumer stopped")
        except Exception as e:
            logger.error(f"[data-pipeline] Error stopping Kafka consumer: {e}")
    
    if kafka_producer:
        try:
            await kafka_producer.stop()
            logger.info("[data-pipeline] Kafka producer stopped")
        except Exception as e:
            logger.error(f"[data-pipeline] Error stopping Kafka producer: {e}")
    
    # Redis cleanup handled by redis_cache module
    from app.redis_cache import close_redis
    await close_redis()

