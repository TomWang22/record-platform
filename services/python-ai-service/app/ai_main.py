from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field
from typing import Optional, List
import os, asyncio, time, statistics, json
import httpx
from prometheus_client import Counter, generate_latest, CONTENT_TYPE_LATEST
import redis.asyncio as redis

app = FastAPI(title="python-ai-service", version="0.4.0")
REQS = Counter("ai_http_requests_total","AI HTTP",[ "route","code" ])

GRADES = { "M":0.35, "NM":0.25, "EX":0.18, "VG+":0.10, "VG":0.0, "G+":-0.15, "G":-0.25, "P":-0.5 }
USER_AGENT = "record-platform/0.4 (+https://example)"
DISCOGS_TOKEN = os.getenv("DISCOGS_TOKEN")
EBAY_OAUTH_TOKEN = os.getenv("EBAY_OAUTH_TOKEN")
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
def healthz():
    return {"ok": True}

@app.get("/metrics")
def metrics():
    return PlainTextResponse(generate_latest(), media_type=CONTENT_TYPE_LATEST)

async def ebay_prices(query: str) -> List[float]:
    if not EBAY_OAUTH_TOKEN:
        return []
    headers = {"Authorization": f"Bearer {EBAY_OAUTH_TOKEN}", "User-Agent": USER_AGENT}
    async with httpx.AsyncClient(timeout=20.0, headers=headers) as c:
        r = await c.get("https://api.ebay.com/buy/browse/v1/item_summary/search", params={"q": query, "limit": 20})
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

async def discogs_titles(query: str) -> List[str]:
    if not DISCOGS_TOKEN:
        return []
    headers = {"User-Agent": USER_AGENT, "Authorization": f"Discogs token={DISCOGS_TOKEN}"}
    async with httpx.AsyncClient(timeout=20.0, headers=headers) as c:
        r = await c.get("https://api.discogs.com/database/search", params={"q": query, "per_page": 10})
        r.raise_for_status()
        return [x.get("title") for x in r.json().get("results", []) if x.get("title")]

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
        async with httpx.AsyncClient(timeout=15.0, headers={"User-Agent": USER_AGENT}) as c:
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
        async with httpx.AsyncClient(timeout=15.0, headers={"User-Agent": USER_AGENT}) as c:
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
        async with httpx.AsyncClient(timeout=15.0, headers={"User-Agent": USER_AGENT}) as c:
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
