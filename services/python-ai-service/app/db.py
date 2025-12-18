"""
Database module for Python AI Service
Handles database connections and operations for AI predictions, cache, and logging
"""
import os
import asyncio
import json
import hashlib
from typing import Optional, Dict, List, Any
from datetime import datetime, timedelta
import asyncpg
import logging

logger = logging.getLogger(__name__)

# Database connection pool
_pool: Optional[asyncpg.Pool] = None

POSTGRES_URL_PYTHON_AI = os.getenv(
    "POSTGRES_URL_PYTHON_AI",
    "postgresql://postgres:postgres@host.docker.internal:5440/python_ai"
)

# Remove connect_timeout parameter if present (asyncpg doesn't support it)
if "connect_timeout" in POSTGRES_URL_PYTHON_AI:
    import re
    POSTGRES_URL_PYTHON_AI = re.sub(r'[&?]connect_timeout=[^&]*', '', POSTGRES_URL_PYTHON_AI)


async def get_pool() -> Optional[asyncpg.Pool]:
    """Get or create database connection pool"""
    global _pool
    if _pool:
        return _pool
    
    try:
        # Parse connection string and create pool
        # Increased pool size for production load (handles 50+ VUs with headroom)
        # Formula: max_size = (VUs * concurrent_per_vu) + headroom
        # For 50 VUs with 2-3 concurrent requests each: 100-150 + 50 headroom = 150-200
        # Increased to 150 to handle peak load and prevent connection exhaustion
        # Optimization: Add connection timeout to prevent hanging
        _pool = await asyncio.wait_for(
            asyncpg.create_pool(
                POSTGRES_URL_PYTHON_AI,
                min_size=15,  # Increased from 10 for better warm pool (3 replicas * 5 = 15)
                max_size=150,  # Increased from 100 (handles 50+ VUs with 2-3 concurrent requests + headroom)
                command_timeout=60,
                max_queries=50000,  # Max queries per connection before recycling
                max_inactive_connection_lifetime=300,  # Recycle idle connections after 5min
                timeout=10,  # Connection timeout (seconds) - prevents hanging
                server_settings={
                    # Optimize connection settings
                    'application_name': 'python-ai-service',
                    'tcp_keepalives_idle': '600',  # 10 minutes
                    'tcp_keepalives_interval': '30',  # 30 seconds
                    'tcp_keepalives_count': '3',
                }
            ),
            timeout=15.0  # Overall pool creation timeout
        )
        logger.info("[db] Database connection pool created")
        return _pool
    except asyncio.TimeoutError:
        logger.error("[db] Database connection pool creation timed out after 15s")
        _pool = None
        return None
    except Exception as e:
        logger.warning(f"[db] Database connection failed: {e}")
        _pool = None
        return None


async def close_pool():
    """Close database connection pool"""
    global _pool
    if _pool:
        try:
            await _pool.close()
            logger.info("[db] Database connection pool closed")
        except Exception as e:
            logger.error(f"[db] Error closing pool: {e}")
        finally:
            _pool = None


def _hash_query(query: str) -> str:
    """Generate hash for query (for cache lookups)"""
    return hashlib.sha256(query.encode('utf-8')).hexdigest()


async def get_cached_prediction(
    query: str,
    prediction_type: str,
    user_id: Optional[str] = None,
    ttl_minutes: int = 60
) -> Optional[Dict]:
    """Get cached prediction from database"""
    pool = await get_pool()
    if not pool:
        return None
    
    try:
        query_hash = _hash_query(query)
        result = await pool.fetchrow(
            """
            SELECT prediction_result, confidence_score, created_at
            FROM ai.get_prediction($1, $2, $3::uuid, $4)
            """,
            query, prediction_type, user_id, ttl_minutes
        )
        
        if result:
            return {
                "prediction_result": result["prediction_result"],
                "confidence_score": float(result["confidence_score"]) if result["confidence_score"] else None,
                "created_at": result["created_at"].isoformat(),
            }
    except Exception as e:
        logger.warning(f"[db] Failed to get cached prediction: {e}")
    
    return None


async def store_prediction(
    query: str,
    prediction_type: str,
    user_id: Optional[str],
    input_data: Dict,
    prediction_result: Dict,
    confidence_score: Optional[float] = None,
    ttl_minutes: int = 60
) -> Optional[str]:
    """Store prediction in database cache"""
    pool = await get_pool()
    if not pool:
        return None
    
    try:
        prediction_id = await pool.fetchval(
            """
            SELECT ai.store_prediction(
                $1, $2, $3::uuid, $4::jsonb, $5::jsonb, $6, $7
            )
            """,
            query,
            prediction_type,
            user_id,
            json.dumps(input_data),
            json.dumps(prediction_result),
            confidence_score,
            ttl_minutes
        )
        return str(prediction_id)
    except Exception as e:
        logger.warning(f"[db] Failed to store prediction: {e}")
    
    return None


async def log_inference(
    user_id: Optional[str],
    query: str,
    inference_type: str,
    input_data: Dict,
    output_data: Dict,
    processing_time_ms: int,
    analytics_data_used: bool = False,
    cache_hit: bool = False
) -> Optional[str]:
    """Log AI inference for analytics"""
    pool = await get_pool()
    if not pool:
        return None
    
    try:
        inference_id = await pool.fetchval(
            """
            INSERT INTO ai.inference_log (
                user_id, query, inference_type, input_data, output_data,
                processing_time_ms, analytics_data_used, cache_hit
            ) VALUES ($1::uuid, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8)
            RETURNING id
            """,
            user_id,
            query,
            inference_type,
            json.dumps(input_data),
            json.dumps(output_data),
            processing_time_ms,
            analytics_data_used,
            cache_hit
        )
        return str(inference_id)
    except Exception as e:
        logger.warning(f"[db] Failed to log inference: {e}")
    
    return None


async def get_cached_analytics(
    query: str,
    cache_type: str,
    user_id: Optional[str] = None,
    ttl_minutes: int = 10
) -> Optional[Dict]:
    """Get cached analytics data from database"""
    pool = await get_pool()
    if not pool:
        return None
    
    try:
        query_hash = _hash_query(query)
        result = await pool.fetchrow(
            """
            SELECT cached_data, created_at, expires_at
            FROM ai.analytics_cache
            WHERE query_hash = $1
              AND cache_type = $2
              AND (user_id = $3::uuid OR (user_id IS NULL AND $3::uuid IS NULL))
              AND expires_at > now()
            ORDER BY created_at DESC
            LIMIT 1
            """,
            query_hash, cache_type, user_id
        )
        
        if result:
            return {
                "cached_data": result["cached_data"],
                "created_at": result["created_at"].isoformat(),
                "expires_at": result["expires_at"].isoformat(),
            }
    except Exception as e:
        logger.warning(f"[db] Failed to get cached analytics: {e}")
    
    return None


async def store_analytics_cache(
    query: str,
    cache_type: str,
    user_id: Optional[str],
    cached_data: Dict,
    ttl_minutes: int = 10
) -> Optional[str]:
    """Store analytics data in database cache"""
    pool = await get_pool()
    if not pool:
        return None
    
    try:
        query_hash = _hash_query(query)
        expires_at = datetime.utcnow() + timedelta(minutes=ttl_minutes)
        
        cache_id = await pool.fetchval(
            """
            INSERT INTO ai.analytics_cache (
                query, query_hash, user_id, cache_type, cached_data, expires_at
            ) VALUES ($1, $2, $3::uuid, $4, $5::jsonb, $6)
            ON CONFLICT (query_hash, cache_type, user_id)
            DO UPDATE SET
                cached_data = EXCLUDED.cached_data,
                expires_at = EXCLUDED.expires_at,
                created_at = now()
            RETURNING id
            """,
            query, query_hash, user_id, cache_type, json.dumps(cached_data), expires_at
        )
        return str(cache_id)
    except Exception as e:
        logger.warning(f"[db] Failed to store analytics cache: {e}")
    
    return None


async def log_event(
    event_type: str,
    user_id: Optional[str],
    query: Optional[str],
    event_data: Dict,
    kafka_published: bool = False,
    kafka_topic: Optional[str] = None
) -> Optional[str]:
    """Log AI event to database"""
    pool = await get_pool()
    if not pool:
        return None
    
    try:
        event_id = await pool.fetchval(
            """
            INSERT INTO ai.events (
                event_type, user_id, query, event_data, kafka_published, kafka_topic
            ) VALUES ($1, $2::uuid, $3, $4::jsonb, $5, $6)
            RETURNING id
            """,
            event_type, user_id, query, json.dumps(event_data), kafka_published, kafka_topic
        )
        return str(event_id)
    except Exception as e:
        logger.warning(f"[db] Failed to log event: {e}")
    
    return None


async def cleanup_expired_cache():
    """Clean up expired cache entries"""
    pool = await get_pool()
    if not pool:
        return
    
    try:
        await pool.execute("SELECT ai.cleanup_expired_cache()")
        logger.debug("[db] Expired cache cleaned up")
    except Exception as e:
        logger.warning(f"[db] Failed to cleanup expired cache: {e}")

