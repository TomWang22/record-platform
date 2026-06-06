from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field
from typing import Optional, List
import os, asyncio, time, statistics, json
import httpx
from prometheus_client import Counter, generate_latest, CONTENT_TYPE_LATEST
import redis.asyncio as redis
from datetime import datetime
import logging

# Import new modules
from app.data_pipeline import ingest_analytics_data, start_kafka_consumer, shutdown as pipeline_shutdown
from app.ai_advisor import SellingAdvisor, BuyingAdvisor, NegotiationAdvisor, BiddingAdvisor
from app.db import close_pool as close_db_pool, get_last_pool_error, get_pool, log_inference
from app.redis_cache import close_redis
from app.http_client import get_ebay_client, get_discogs_client, close_clients as close_http_clients

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="python-ai-service", version="0.4.0")
REQS = Counter("ai_http_requests_total","AI HTTP",[ "route","code" ])

GRADES = { "M":0.35, "NM":0.25, "EX":0.18, "VG+":0.10, "VG":0.0, "G+":-0.15, "G":-0.25, "P":-0.5 }
USER_AGENT = "record-platform/0.4 (+https://example)"
DISCOGS_TOKEN = os.getenv("DISCOGS_TOKEN")
EBAY_OAUTH_TOKEN = os.getenv("EBAY_OAUTH_TOKEN")
# eBay App ID (Client ID) for Finding API - more reliable than Browse API
EBAY_APP_ID = os.getenv("EBAY_APP_ID") or os.getenv("EBAY_CLIENT_ID")
# Rate limits for external APIs (requests per minute)
DISCOGS_RATE_LIMIT = int(os.getenv("DISCOGS_RATE_LIMIT", "50"))  # Conservative: 50/min (Discogs allows 60/min)
EBAY_RATE_LIMIT = int(os.getenv("EBAY_RATE_LIMIT", "50"))  # Conservative: 50/min
REDIS_URL = os.getenv("REDIS_URL","redis://redis:6379/0")
ANALYTICS_URL = os.getenv("ANALYTICS_URL","http://analytics-service.record-platform.svc.cluster.local:4004")

rconn: Optional[redis.Redis] = None
async def get_redis():
    global rconn
    if rconn:
        return rconn
    try:
        # NOTE: this is NOT awaitable
        rconn = redis.from_url(REDIS_URL, decode_responses=True)
    except Exception:
        rconn = None
    return rconn

class PredictItem(BaseModel):
    query: Optional[str] = Field(None)
    base_price: Optional[float] = Field(None, ge=0)
    record_grade: Optional[str] = None
    sleeve_grade: Optional[str] = None
    promo: bool = False
    anniversary_boost: float = 0.0

class PredictReq(BaseModel):
    items: List[PredictItem]

@app.get("/healthz")
async def healthz():
    """Liveness: process up only."""
    return {"ok": True, "status": "healthy", "service": "python-ai-service"}

@app.get("/readyz")
async def readyz():
    """Readiness: local mTLS gRPC health SERVING."""
    import subprocess
    grpc_port = os.getenv("GRPC_PORT", "50060")
    grpc_svc = "python_ai.PythonAIService"
    cmd = [
        "/usr/local/bin/grpc-health-probe",
        f"-addr=127.0.0.1:{grpc_port}",
        f"-service={grpc_svc}",
        "-tls",
        "-tls-no-verify=false",
        "-tls-ca-cert=/etc/certs/ca.crt",
        "-tls-client-cert=/etc/certs/tls.crt",
        "-tls-client-key=/etc/certs/tls.key",
        "-tls-server-name=python-ai-service",
        "-connect-timeout=3s",
        "-rpc-timeout=5s",
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=8, check=False)
        if r.returncode != 0:
            return JSONResponse(
                {"ok": False, "ready": False, "grpc": "fail", "stderr": (r.stderr or b"").decode()[:200]},
                status_code=503,
            )
        return {"ok": True, "ready": True, "grpc": "SERVING", "service": "python-ai-service"}
    except Exception as e:
        return JSONResponse({"ok": False, "ready": False, "grpc": "error", "error": str(e)}, status_code=503)

@app.get("/metrics")
def metrics():
    return PlainTextResponse(generate_latest(), media_type=CONTENT_TYPE_LATEST)

async def ebay_prices(query: str) -> List[float]:
    """
    Fetch eBay prices using Finding API (preferred) or Browse API (fallback)
    Finding API works with App ID, Browse API needs OAuth 2.0 token
    Uses Redis caching with singleflight to prevent thundering herd
    Includes rate limiting to prevent hitting eBay API limits
    """
    from app.redis_cache import get_with_singleflight, set_cache
    from app.rate_limiter import check_rate_limit, wait_for_rate_limit
    
    # Use singleflight with Redis caching (1 hour TTL for external API results)
    cache_key = f"ebay:prices:{query}"
    
    async def fetch_ebay_data():
        """Fetch eBay prices - only called if cache miss, with singleflight protection"""
        # Phase 1 optimization: Circuit breaker - skip if circuit is open
        from app.circuit_breaker import get_ebay_circuit_breaker
        circuit = get_ebay_circuit_breaker()
        
        # Check circuit breaker state
        if circuit.get_state().value == "open":
            logger.debug("[ebay] Circuit breaker OPEN, skipping request (using cached data if available)")
            return []  # Return empty, will use cached data if available
        
        # Check rate limit before making request
        if not await check_rate_limit("ebay", EBAY_RATE_LIMIT, window_seconds=60):
            # Wait up to 2s for rate limit to allow request
            if not await wait_for_rate_limit("ebay", EBAY_RATE_LIMIT, window_seconds=60, max_wait=2.0):
                logger.warning("[ebay] Rate limit exceeded, skipping request")
                return []  # Return empty to avoid hitting rate limit
        
        # Try Finding API first (more reliable, works with App ID)
        if EBAY_APP_ID:
            # Phase 1 optimization: Reduced retries from 3 to 2 (fail faster)
            max_retries = 2
            for attempt in range(max_retries):
                try:
                    # Use shared HTTP client with connection pooling for better performance
                    client = await get_ebay_client()
                    r = await client.get(
                        "https://svcs.ebay.com/services/search/FindingService/v1",
                        params={
                            "OPERATION-NAME": "findItemsAdvanced",
                            "SERVICE-VERSION": "1.0.0",
                            "SECURITY-APPNAME": EBAY_APP_ID,
                            "RESPONSE-DATA-FORMAT": "JSON",
                            "keywords": query,
                            "paginationInput.entriesPerPage": 20,
                            "itemFilter(0).name": "ListingType",
                            "itemFilter(0).value": "FixedPrice",
                        }
                    )
                    if r.status_code == 200:
                            data = r.json()
                            # Parse Finding API response
                            items = data.get("findItemsAdvancedResponse", [{}])[0].get("searchResult", [{}])[0].get("item", [])
                            vals = []
                            for item in items:
                                try:
                                    price_str = item.get("sellingStatus", [{}])[0].get("currentPrice", [{}])[0].get("__value__", [""])[0]
                                    if price_str:
                                        vals.append(float(price_str))
                                except:
                                    pass
                            if vals:
                                return vals
                except (httpx.TimeoutException, httpx.ConnectError, httpx.NetworkError) as e:
                    # Network error - retry if attempts remaining
                    if attempt < max_retries - 1:
                        wait_time = 0.5 * (2 ** attempt)  # Exponential backoff: 0.5s, 1s, 2s
                        logger.warning(f"[ebay] Attempt {attempt + 1}/{max_retries} failed (Finding API): {e}, retrying in {wait_time}s...")
                        await asyncio.sleep(wait_time)
                        continue
                    else:
                        logger.warning(f"[ebay] All {max_retries} attempts failed (Finding API): {e}")
                        # Fall through to Browse API fallback
                        break
                except Exception as e:
                    # Other errors - try Browse API fallback
                    logger.debug(f"[ebay] Finding API error: {e}")
                    break
        
            # Fallback to Browse API (requires OAuth 2.0 token)
            if not EBAY_OAUTH_TOKEN:
                return []
            
            # eBay Browse API requires OAuth 2.0 Bearer token
            # Auth'n'Auth tokens (v^1.1# format) don't work with Browse API
            headers = {
                "Authorization": f"Bearer {EBAY_OAUTH_TOKEN}",
                "User-Agent": USER_AGENT,
                "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
                "Content-Type": "application/json"
            }
            
            # Retry logic for Browse API (3 attempts)
            for attempt in range(max_retries):
                try:
                    # Use shared HTTP client with connection pooling for better performance
                    client = await get_ebay_client()
                    r = await client.get(
                        "https://api.ebay.com/buy/browse/v1/item_summary/search",
                        params={"q": query, "limit": 20},
                        headers=headers
                    )
                    # Handle rate limiting and auth errors gracefully
                    if r.status_code == 429:
                        # Rate limited - log and return empty
                        logger.warning("[ebay] Rate limited (429), returning empty results")
                        return []
                    if r.status_code == 403:
                        # Token is Auth'n'Auth format, not OAuth 2.0 - Browse API won't work
                        logger.debug("[ebay] 403 Forbidden (likely Auth'n'Auth token)")
                        return []
                    if r.status_code == 401:
                        # Unauthorized - token might be expired or invalid
                        logger.warning("[ebay] 401 Unauthorized (token may be expired)")
                        return []
                    r.raise_for_status()
                    vals = []
                    for i in r.json().get("itemSummaries", []):
                        price = (i.get("price") or {}).get("value")
                        if price is not None:
                            try:
                                vals.append(float(price))
                            except:
                                pass
                    return vals
                except (httpx.TimeoutException, httpx.ConnectError, httpx.NetworkError) as e:
                    # Network error - retry if attempts remaining
                    if attempt < max_retries - 1:
                        wait_time = 0.5 * (2 ** attempt)  # Exponential backoff: 0.5s, 1s, 2s
                        logger.warning(f"[ebay] Attempt {attempt + 1}/{max_retries} failed (Browse API): {e}, retrying in {wait_time}s...")
                        await asyncio.sleep(wait_time)
                        continue
                    else:
                        logger.warning(f"[ebay] All {max_retries} attempts failed (Browse API): {e}")
                        return []
                except (httpx.HTTPStatusError, Exception) as e:
                    # HTTP errors (429, 403, 401) or other errors - don't retry, return empty
                    logger.debug(f"[ebay] Browse API error: {e}")
                    return []
        
        # If we get here, all retries exhausted
        return []
    
    # Wrap fetch_ebay_data with circuit breaker
    async def _fetch_with_circuit_breaker():
        from app.circuit_breaker import get_ebay_circuit_breaker
        circuit = get_ebay_circuit_breaker()
        try:
            return await circuit.call(fetch_ebay_data)
        except Exception as e:
            logger.debug(f"[ebay] Circuit breaker caught exception: {e}")
            return []
    
    # Phase 2: Multi-layer caching (L1 memory → L2 Redis → L3 DB → External API)
    # Check L1 (in-memory) cache first (fastest)
    from app.memory_cache import get_l1_ebay_cache
    l1_cache = get_l1_ebay_cache()
    l1_result = await l1_cache.get(cache_key)
    if l1_result is not None:
        logger.debug(f"[ebay] L1 cache hit for {query}")
        return l1_result if isinstance(l1_result, list) else []
    
    # L1 miss, check L2 (Redis) via singleflight
    result = await get_with_singleflight(
        key=cache_key,
        fetch_fn=_fetch_with_circuit_breaker,
        ttl=604800,  # 7 day cache for external API results (stable prices rarely change)
        lock_ttl=10,  # Reduced from 15s to 10s (fail faster with shorter timeout)
        use_singleflight=True
    )
    
    # Store in L1 cache if we got a result
    if result:
        await l1_cache.set(cache_key, result, ttl=300)  # 5 min L1 TTL
    
    # Return partial results if available (even if empty, to avoid None)
    return result if result else []

async def discogs_titles(query: str) -> List[str]:
    """
    Fetch Discogs titles with Redis caching and singleflight
    Includes rate limiting to prevent hitting Discogs API limits (60 req/min)
    """
    from app.redis_cache import get_with_singleflight
    from app.rate_limiter import check_rate_limit, wait_for_rate_limit
    
    if not DISCOGS_TOKEN:
        return []
    
    # Use singleflight with Redis caching (1 hour TTL for external API results)
    cache_key = f"discogs:titles:{query}"
    
    async def fetch_discogs_data():
        """Fetch Discogs titles - only called if cache miss, with retry logic"""
        # Phase 1 optimization: Circuit breaker - skip if circuit is open
        from app.circuit_breaker import get_discogs_circuit_breaker
        circuit = get_discogs_circuit_breaker()
        
        # Check circuit breaker state
        if circuit.get_state().value == "open":
            logger.debug("[discogs] Circuit breaker OPEN, skipping request (using cached data if available)")
            return []  # Return empty, will use cached data if available
        
        # Check rate limit before making request
        if not await check_rate_limit("discogs", DISCOGS_RATE_LIMIT, window_seconds=60):
            # Wait up to 5s for rate limit to allow request (increased from 2s)
            if not await wait_for_rate_limit("discogs", DISCOGS_RATE_LIMIT, window_seconds=60, max_wait=5.0):
                logger.warning("[discogs] Rate limit exceeded, skipping request")
                return []  # Return empty to avoid hitting rate limit
        
        # Phase 1 optimization: Reduced retries from 3 to 2 (fail faster)
        max_retries = 2
        headers = {"User-Agent": USER_AGENT, "Authorization": f"Discogs token={DISCOGS_TOKEN}"}
        
        for attempt in range(max_retries):
            try:
                # Use shared HTTP client with connection pooling for better performance
                client = await get_discogs_client()
                r = await client.get("https://api.discogs.com/database/search", params={"q": query, "per_page": 10}, headers=headers)
                
                # Handle rate limiting
                if r.status_code == 429:
                    logger.warning("[discogs] Rate limited (429), returning empty results")
                    return []  # Don't retry on rate limit
                
                r.raise_for_status()
                titles = [x.get("title") for x in r.json().get("results", []) if x.get("title")]
                if titles:
                    return titles
                return []  # Empty results, don't retry
            except (httpx.TimeoutException, httpx.ConnectError, httpx.NetworkError) as e:
                # Network error - retry if attempts remaining
                if attempt < max_retries - 1:
                    wait_time = 0.5 * (2 ** attempt)  # Exponential backoff: 0.5s, 1s, 2s
                    logger.warning(f"[discogs] Attempt {attempt + 1}/{max_retries} failed: {e}, retrying in {wait_time}s...")
                    await asyncio.sleep(wait_time)
                    continue
                else:
                    logger.warning(f"[discogs] All {max_retries} attempts failed: {e}")
                    raise  # Raise to trigger circuit breaker
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 429:
                    logger.warning("[discogs] Rate limited (429)")
                    return []  # Don't retry on rate limit
                # Other HTTP errors - don't retry
                logger.warning(f"[discogs] HTTP error: {e.response.status_code}")
                return []
            except Exception as e:
                # Other errors - don't retry
                logger.warning(f"[discogs] Error: {e}")
                return []
        
        return []
    
    # Wrap fetch_discogs_data with circuit breaker
    async def _fetch_discogs_with_circuit_breaker():
        from app.circuit_breaker import get_discogs_circuit_breaker
        circuit = get_discogs_circuit_breaker()
        try:
            return await circuit.call(fetch_discogs_data)
        except Exception as e:
            logger.debug(f"[discogs] Circuit breaker caught exception: {e}")
            return []
    
    # Phase 2: Multi-layer caching (L1 memory → L2 Redis → L3 DB → External API)
    # Check L1 (in-memory) cache first (fastest)
    from app.memory_cache import get_l1_discogs_cache
    l1_cache = get_l1_discogs_cache()
    l1_result = await l1_cache.get(cache_key)
    if l1_result is not None:
        logger.debug(f"[discogs] L1 cache hit for {query}")
        return l1_result if isinstance(l1_result, list) else []
    
    # L1 miss, check L2 (Redis) via singleflight
    result = await get_with_singleflight(
        key=cache_key,
        fetch_fn=_fetch_discogs_with_circuit_breaker,
        ttl=604800,  # 7 day cache for external API results (titles rarely change)
        lock_ttl=10,  # Reduced from 15s to 10s (fail faster with shorter timeout)
        use_singleflight=True
    )
    
    # Store in L1 cache if we got a result
    if result:
        await l1_cache.set(cache_key, result, ttl=300)  # 5 min L1 TTL
    
    # Return partial results if available (even if empty, to avoid None)
    return result if result else []

def adjust(price: float, rg: Optional[str], sg: Optional[str], promo: bool, anniv: float) -> float:
    s = price
    if rg:
        s *= 1 + GRADES.get(rg.upper(), 0.0)
    if sg and sg.upper() == "NM":
        s *= 1.10
    if promo:
        s *= 1.05
    s *= 1 + (anniv or 0.0)
    return round(s, 2)

async def infer_base_price(query: Optional[str]) -> Optional[float]:
    if not query:
        return None
    prices = await ebay_prices(query)
    if prices:
        prices.sort()
        mid = prices[len(prices)//4: -len(prices)//4 or None]
        return round(statistics.median(mid if mid else prices), 2)
    return None

async def analytics_estimate(items: List[PredictItem]) -> Optional[dict]:
    if not ANALYTICS_URL or not items:
        return None
    url = ANALYTICS_URL.rstrip("/") + "/analytics/predict-price"
    payload = {"items": [it.model_dump(exclude_none=True) for it in items]}
    try:
        # Reduced timeout from 15s to 5s for better responsiveness
        async with httpx.AsyncClient(timeout=5.0, headers={"User-Agent": USER_AGENT}) as c:
            resp = await c.post(url, json=payload)
            resp.raise_for_status()
            return resp.json()
    except Exception:
        return None

@app.post("/predict-price")
async def predict(body: PredictReq):
    t0 = time.time()
    items = body.items or []
    analytics_task = asyncio.create_task(analytics_estimate(items))
    out = []
    for it in items:
        base = it.base_price or await infer_base_price(it.query) or 50.0
        out.append(adjust(base, it.record_grade, it.sleeve_grade, it.promo, it.anniversary_boost))
    suggested = round(sum(out)/len(out), 2) if out else 0.0
    analytics_result = await analytics_task
    blended = suggested
    if analytics_result and analytics_result.get("suggested") is not None:
        blended = round((suggested + float(analytics_result["suggested"])) / 2, 2)
    REQS.labels("/predict-price","200").inc()
    return JSONResponse({
        "suggested": blended,
        "local_suggested": suggested,
        "analytics_suggested": analytics_result.get("suggested") if analytics_result else None,
        "samples": len(out),
        "estimates": out,
        "t_ms": int((time.time()-t0)*1000)
    })

async def analytics_recommendations(query: str, user_id: Optional[str] = None, limit: int = 10) -> Optional[dict]:
    if not ANALYTICS_URL or not query:
        return None
    url = ANALYTICS_URL.rstrip("/") + "/analytics/recommendations/similar"
    params = {"q": query, "limit": limit}
    if user_id:
        params["userId"] = user_id
    try:
        # Reduced timeout from 15s to 2s for better responsiveness
        async with httpx.AsyncClient(timeout=2.0, headers={"User-Agent": USER_AGENT}) as c:
            resp = await c.get(url, params=params)
            resp.raise_for_status()
            return resp.json()
    except Exception:
        return None

async def analytics_trending(days: int = 7, limit: int = 20) -> Optional[dict]:
    if not ANALYTICS_URL:
        return None
    url = ANALYTICS_URL.rstrip("/") + "/analytics/trending"
    params = {"days": days, "limit": limit}
    try:
        # Reduced timeout from 15s to 2s for better responsiveness
        async with httpx.AsyncClient(timeout=2.0, headers={"User-Agent": USER_AGENT}) as c:
            resp = await c.get(url, params=params)
            resp.raise_for_status()
            return resp.json()
    except Exception:
        return None

@app.get("/recommendations")
async def recommendations(q: str = Query(..., min_length=2), user_id: Optional[str] = Query(None), limit: int = Query(10, ge=1, le=50)):
    analytics_recs = await analytics_recommendations(q, user_id, limit)
    return JSONResponse({
        "query": q,
        "recommendations": analytics_recs.get("recommendations", []) if analytics_recs else [],
        "source": "analytics" if analytics_recs else "none"
    })

@app.get("/trending")
async def trending(days: int = Query(7, ge=1, le=90), limit: int = Query(20, ge=1, le=100)):
    analytics_trend = await analytics_trending(days, limit)
    return JSONResponse({
        "days": days,
        "trending": analytics_trend.get("trending", []) if analytics_trend else [],
        "source": "analytics" if analytics_trend else "none"
    })

@app.get("/price-trends")
async def price_trends(q: str = Query(..., min_length=2)):
    key = f"ai:trend:{q}"
    rc = await get_redis()
    if rc:
        try:
            cached = await rc.get(key)
            if cached:
                return JSONResponse(content=json.loads(cached))
        except Exception:
            pass

    titles, prices = await asyncio.gather(discogs_titles(q), ebay_prices(q))
    trend = {
        "count": len(prices),
        "low": round(min(prices),2) if prices else None,
        "p50": round(statistics.median(prices),2) if prices else None,
        "high": round(max(prices),2) if prices else None,
    }
    payload = {"query": q, "discogs_titles": titles, "ebay_price_summ": trend}
    if rc:
        try:
            await rc.setex(key, 120, json.dumps(payload))
        except Exception:
            pass
    REQS.labels("/price-trends","200").inc()
    return payload

class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1)
    user_id: Optional[str] = None
    context: Optional[str] = None

@app.post("/chat")
async def chat(body: ChatRequest):
    """
    Chatbot endpoint - records-focused ChatGPT-like interface.
    Uses analytics service to gather data and provide intelligent responses.
    """
    message = body.message
    user_id = body.user_id
    
    key = f"ai:chat:{user_id}:{hash(message)}"
    rc = await get_redis()
    if rc:
        try:
            cached = await rc.get(key)
            if cached:
                return JSONResponse(content=json.loads(cached))
        except Exception:
            pass
    
    # Gather context from analytics service
    analytics_data = None
    if ANALYTICS_URL:
        try:
            # Try to extract a query from the message
            # Simple heuristic: look for artist/album mentions
            words = message.lower().split()
            potential_query = " ".join(words[:5])  # First 5 words as potential query
            
            async with httpx.AsyncClient(timeout=15.0, headers={"User-Agent": USER_AGENT}) as c:
                # Get similar searches and recommendations
                similar_resp = await c.get(
                    ANALYTICS_URL.rstrip("/") + "/analytics/recommendations/similar",
                    params={"q": potential_query, "userId": user_id, "limit": 5}
                )
                if similar_resp.status_code == 200:
                    analytics_data = similar_resp.json()
        except Exception:
            pass

    # Generate response based on message and analytics data
    # This is a simple implementation - in production, you'd use an LLM
    response_text = f"I understand you're asking about: {message}"
    
    if analytics_data and analytics_data.get("recommendations"):
        recs = analytics_data["recommendations"][:3]
        response_text += f"\n\nBased on similar searches, I found: {', '.join([r.get('query', '') for r in recs])}"
    
    # Add price trend info if available
    if "price" in message.lower() or "cost" in message.lower() or "value" in message.lower():
        response_text += "\n\nI can help you find price trends. Try asking about a specific record or use the price-trends endpoint."
    
    payload = {
        "message": message,
        "response": response_text,
        "analytics_context": analytics_data,
        "timestamp": time.time(),
    }
    
    if rc:
        try:
            await rc.setex(key, 300, json.dumps(payload))  # Cache for 5 minutes
        except Exception:
            pass
    
    REQS.labels("/chat","200").inc()
    return JSONResponse(content=payload)


# ============================================================================
# AI Advisor Endpoints - Selling, Buying, Negotiation, Bidding
# ============================================================================

class SellingAdviceRequest(BaseModel):
    query: str = Field(..., min_length=2)
    record_grade: Optional[str] = None
    sleeve_grade: Optional[str] = None
    user_id: Optional[str] = None
    current_price: Optional[float] = Field(None, ge=0)


def _coerce_user_id(user_id: Optional[str]) -> Optional[str]:
    """Coerce 'null' string (from test scripts) to None; validate UUID-ish for non-null."""
    if user_id is None or user_id in ("", "null", "None"):
        return None
    return user_id


def _fallback_selling_advice(body: SellingAdviceRequest, reason: str = "dependency_unavailable"):
    """Minimal fallback when DB/analytics are unavailable; callers should set reason for debugging."""
    return {
        "query": body.query,
        "recommended_price": body.current_price or 0.0,
        "market_analysis": {"demand_level": "unknown", "price_trend": "stable", "competition": "unknown"},
        "pricing_strategy": "market_price",
        "timing": {"best_time": "now", "reason": f"Fallback: {reason}"},
        "confidence": "low",
        "data_sources": {},
        "_fallback": True,
        "_reason": reason,
    }


@app.post("/ai/selling-advice")
async def selling_advice(body: SellingAdviceRequest):
    """
    Get AI-powered selling advice for listing records.

    Returns real advice when DB and analytics are available; on dependency failure
    returns 503 with clear error_code/message, or 200 with _fallback: true and _reason when appropriate.
    """
    try:
        user_id = _coerce_user_id(body.user_id)
        pool = await get_pool()
        if not pool:
            err_detail = get_last_pool_error() or "Pool creation failed"
            logger.warning("[selling-advice] DB pool unavailable: %s", err_detail)
            return JSONResponse(
                status_code=503,
                content={
                    "error": "Service temporarily unavailable",
                    "error_code": "db_pool_unavailable",
                    "message": "Database connection pool not available",
                    "detail": err_detail,
                    "hint": "Check POSTGRES_URL_PYTHON_AI and python_ai DB (port 5440). Run ./scripts/diagnose-502-and-analytics.sh",
                },
            )
        advice = await SellingAdvisor.get_selling_advice(
            query=body.query,
            record_grade=body.record_grade,
            sleeve_grade=body.sleeve_grade,
            user_id=user_id,
            current_price=body.current_price,
        )
        if not advice:
            return JSONResponse(content=_fallback_selling_advice(body, "no_advice_generated"))
        REQS.labels("/ai/selling-advice", "200").inc()
        return JSONResponse(content=advice)
    except asyncio.TimeoutError as e:
        logger.warning("[selling-advice] timeout: %s", e)
        REQS.labels("/ai/selling-advice", "504").inc()
        return JSONResponse(
            status_code=504,
            content={
                "error": "Upstream timeout",
                "error_code": "timeout",
                "message": str(e),
                "hint": "Analytics or external APIs may be slow; retry or check ANALYTICS_URL.",
            },
        )
    except Exception as e:
        logger.exception("[selling-advice] %s", e)
        REQS.labels("/ai/selling-advice", "500").inc()
        return JSONResponse(
            status_code=500,
            content={
                "error": "Internal server error",
                "error_code": "selling_advice_failed",
                "message": str(e),
                "hint": "Check python-ai-service logs and DB/Redis/Analytics connectivity.",
            },
        )


class BuyingAdviceRequest(BaseModel):
    query: str = Field(..., min_length=2)
    max_budget: Optional[float] = Field(None, ge=0)
    user_id: Optional[str] = None
    urgency: str = Field("normal", pattern="^(normal|high|low)$")


@app.post("/ai/buying-advice")
async def buying_advice(body: BuyingAdviceRequest):
    """
    Get AI-powered buying advice for purchasing records.
    Returns real advice when DB/analytics are available; on failure returns 503/500 with error_code, message, hint.
    """
    try:
        pool = await get_pool()
        if not pool:
            err_detail = get_last_pool_error() or "Pool creation failed"
            logger.warning("[buying-advice] DB pool unavailable: %s", err_detail)
            return JSONResponse(
                status_code=503,
                content={
                    "error": "Service temporarily unavailable",
                    "error_code": "db_pool_unavailable",
                    "message": "Database connection pool not available",
                    "detail": err_detail,
                    "hint": "Check POSTGRES_URL_PYTHON_AI and python_ai DB (port 5440). Run ./scripts/diagnose-502-and-analytics.sh",
                },
            )
        advice = await BuyingAdvisor.get_buying_advice(
            query=body.query,
            max_budget=body.max_budget,
            user_id=body.user_id,
            urgency=body.urgency,
        )
        REQS.labels("/ai/buying-advice", "200").inc()
        return JSONResponse(content=advice)
    except asyncio.TimeoutError as e:
        logger.warning("[buying-advice] timeout: %s", e)
        REQS.labels("/ai/buying-advice", "504").inc()
        return JSONResponse(
            status_code=504,
            content={
                "error": "Upstream timeout",
                "error_code": "timeout",
                "message": str(e),
                "hint": "Analytics or external APIs may be slow; retry or check ANALYTICS_URL.",
            },
        )
    except Exception as e:
        logger.exception("[buying-advice] %s", e)
        REQS.labels("/ai/buying-advice", "500").inc()
        return JSONResponse(
            status_code=500,
            content={
                "error": "Internal server error",
                "error_code": "buying_advice_failed",
                "message": str(e),
                "hint": "Check python-ai-service logs and DB/Redis/Analytics connectivity.",
            },
        )


class NegotiationAdviceRequest(BaseModel):
    query: str = Field(..., min_length=2)
    role: str = Field(..., pattern="^(buyer|seller)$")
    current_price: float = Field(..., ge=0)
    target_price: Optional[float] = Field(None, ge=0)
    user_id: Optional[str] = None


@app.post("/ai/negotiation-advice")
async def negotiation_advice(body: NegotiationAdviceRequest):
    """
    Get AI-powered negotiation advice for both buyers and sellers
    
    Returns:
    - Negotiation strategy
    - Price range recommendations
    - Talking points
    - Counter-offer suggestions
    """
    try:
        advice = await NegotiationAdvisor.get_negotiation_advice(
            query=body.query,
            role=body.role,
            current_price=body.current_price,
            target_price=body.target_price,
            user_id=body.user_id,
        )
        REQS.labels("/ai/negotiation-advice", "200").inc()
        return JSONResponse(content=advice)
    except Exception as e:
        REQS.labels("/ai/negotiation-advice", "500").inc()
        return JSONResponse(
            status_code=500,
            content={"error": "Internal server error", "details": str(e)}
        )


class BiddingAdviceRequest(BaseModel):
    query: str = Field(..., min_length=2)
    current_bid: float = Field(..., ge=0)
    auction_end_time: Optional[str] = None  # ISO format datetime
    user_id: Optional[str] = None
    max_budget: Optional[float] = Field(None, ge=0)


@app.post("/ai/bidding-advice")
async def bidding_advice(body: BiddingAdviceRequest):
    """
    Get AI-powered bidding advice for auction monitoring
    
    Returns:
    - Should you bid?
    - Maximum recommended bid
    - Bidding strategy
    - Risk assessment
    """
    try:
        auction_end = None
        if body.auction_end_time:
            try:
                auction_end = datetime.fromisoformat(body.auction_end_time.replace('Z', '+00:00'))
            except Exception:
                pass
        
        advice = await BiddingAdvisor.get_bidding_advice(
            query=body.query,
            current_bid=body.current_bid,
            auction_end_time=auction_end,
            user_id=body.user_id,
            max_budget=body.max_budget,
        )
        REQS.labels("/ai/bidding-advice", "200").inc()
        return JSONResponse(content=advice)
    except Exception as e:
        REQS.labels("/ai/bidding-advice", "500").inc()
        return JSONResponse(
            status_code=500,
            content={"error": "Internal server error", "details": str(e)}
        )

# Start gRPC server and data pipeline if enabled
grpc_server = None
@app.on_event("startup")
async def startup_event():
    """Start gRPC server and data pipeline on startup if enabled"""
    global grpc_server
    
    # Start Kafka consumer for data pipeline
    try:
        asyncio.create_task(start_kafka_consumer())
        print("[python-ai] Data pipeline Kafka consumer started")
    except Exception as e:
        print(f"[python-ai] Failed to start Kafka consumer: {e}")
    
    # Start gRPC server if enabled
    if os.getenv("ENABLE_GRPC") == "true":
        try:
            print("[python-ai] Starting gRPC server...")
            # Import grpc_server from the same directory
            import sys
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
            from grpc_server import serve
            grpc_port = int(os.getenv("GRPC_PORT", "50060"))
            print(f"[python-ai] gRPC server module imported, starting on port {grpc_port}")
            # Start gRPC server in background task
            async def start_grpc():
                try:
                    print(f"[python-ai] gRPC server startup task started")
                    server = await serve(grpc_port)
                    if server:
                        print(f"[python-ai] gRPC server started on port {grpc_port}")
                        # Keep server running
                        await server.wait_for_termination()
                    else:
                        print(f"[python-ai] gRPC server returned None (proto stubs may not be loaded)")
                except Exception as e:
                    import traceback
                    print(f"[python-ai] Error in gRPC server startup task: {e}")
                    traceback.print_exc()
            # Create background task
            asyncio.create_task(start_grpc())
            print("[python-ai] gRPC server background task created")
        except Exception as e:
            import traceback
            print(f"[python-ai] Failed to start gRPC server: {e}")
            traceback.print_exc()
    
    # Phase 2: Cache warming for popular queries (non-blocking background task)
    asyncio.create_task(warm_cache())
    print("[python-ai] Startup complete.")


async def warm_cache():
    """Phase 2: Warm cache with popular queries (non-blocking background task)"""
    try:
        # Wait a bit for service to be fully ready
        await asyncio.sleep(5)
        
        # Popular album queries to pre-populate cache
        popular_queries = [
            "The Beatles Abbey Road",
            "Pink Floyd Dark Side of the Moon",
            "Led Zeppelin IV",
            "Fleetwood Mac Rumours",
            "Michael Jackson Thriller",
            "Prince Purple Rain",
            "David Bowie Ziggy Stardust",
            "The Rolling Stones Sticky Fingers",
        ]
        
        logger.info(f"[cache-warming] Warming cache with {len(popular_queries)} popular queries...")
        
        # Warm cache in parallel (non-blocking, don't wait for completion)
        tasks = []
        for query in popular_queries:
            # Warm eBay and Discogs caches (these will populate L1 and L2 caches)
            tasks.append(ebay_prices(query))
            tasks.append(discogs_titles(query))
        
        # Execute in parallel, don't wait for completion (fire and forget)
        asyncio.gather(*tasks, return_exceptions=True)
        
        logger.info("[cache-warming] Cache warming initiated (running in background)")
    except Exception as e:
        logger.warning(f"[cache-warming] Cache warming failed: {e}")

@app.on_event("shutdown")
async def shutdown_event():
    """Shutdown gRPC server and data pipeline gracefully"""
    global grpc_server
    
    # Shutdown data pipeline
    try:
        await pipeline_shutdown()
        print("[python-ai] Data pipeline shut down")
    except Exception as e:
        print(f"[python-ai] Error shutting down data pipeline: {e}")
    
    # Shutdown database pool
    try:
        await close_db_pool()
        print("[python-ai] Database pool closed")
    except Exception as e:
        print(f"[python-ai] Error closing database pool: {e}")
    
    # Shutdown Redis connections
    try:
        await close_redis()
        print("[python-ai] Redis connections closed")
    except Exception as e:
        print(f"[python-ai] Error closing Redis: {e}")
    
    # Shutdown HTTP clients
    try:
        await close_http_clients()
        print("[python-ai] HTTP clients closed")
    except Exception as e:
        print(f"[python-ai] Error closing HTTP clients: {e}")
    
    # Shutdown gRPC server
    if grpc_server:
        try:
            # grpc.aio.server.stop() is async
            await grpc_server.stop(5)  # 5 second grace period
            await grpc_server.wait_for_termination(timeout=5)
            print("[python-ai] gRPC server stopped")
        except Exception as e:
            print(f"[python-ai] Error stopping gRPC server: {e}")
