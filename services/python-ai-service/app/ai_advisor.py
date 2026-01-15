"""
AI Advisor Module
Provides intelligent recommendations for selling, buying, negotiation, and bidding
"""
import os
import asyncio
from typing import Optional, Dict, List, Any
from datetime import datetime, timedelta
import statistics
import logging

from app.data_pipeline import (
    ingest_analytics_data,
    fetch_price_trend,
    fetch_similar_searches,
    predict_price_from_analytics,
    publish_ai_event,
    get_cached_data,
    cache_data,
)
from app.db import (
    get_cached_prediction,
    store_prediction,
    log_inference,
    log_event,
)
import time
import logging

logger = logging.getLogger(__name__)


class SellingAdvisor:
    """AI advisor for selling records"""
    
    @staticmethod
    async def get_selling_advice(
        query: str,
        record_grade: Optional[str] = None,
        sleeve_grade: Optional[str] = None,
        user_id: Optional[str] = None,
        current_price: Optional[float] = None
    ) -> Dict:
        start_time = time.time()
        """
        Get AI-powered selling advice
        
        Returns:
        - Recommended listing price
        - Market analysis
        - Timing recommendations
        - Pricing strategy
        """
        # Use Redis singleflight to prevent cache stampede/thundering herd
        from app.redis_cache import get_with_singleflight
        
        # Create cache key with all parameters
        cache_key = f"ai:selling:{query}:{user_id or 'anonymous'}:{record_grade or 'none'}:{sleeve_grade or 'none'}:{current_price or 0}"
        
        # Wrap entire advice generation in singleflight to prevent concurrent requests
        async def generate_advice():
            """Generate selling advice - only one request executes, others wait"""
            # Check database cache first (fast lookup)
            cached = await get_cached_prediction(query, "selling", user_id, ttl_minutes=60)
            if cached:
                logger.debug(f"[selling-advisor] Using cached prediction for {query}")
                await log_inference(
                    user_id=user_id,
                    query=query,
                    inference_type="selling",
                    input_data={
                        "record_grade": record_grade,
                        "sleeve_grade": sleeve_grade,
                        "current_price": current_price,
                    },
                    output_data=cached["prediction_result"],
                    processing_time_ms=10,
                    analytics_data_used=False,
                    cache_hit=True
                )
                return cached["prediction_result"]
            
            # Ingest analytics data (already uses Redis singleflight internally)
            # Make this non-blocking with timeout to prevent hanging
            # Optimized for baseline: Reduced timeout to 5s (fail fast, use cached data on timeout)
            try:
                analytics_data = await asyncio.wait_for(
                    ingest_analytics_data(query, user_id),
                    timeout=5.0  # Reduced from 8s to 5s (fail faster, use cache on timeout)
                )
            except asyncio.TimeoutError:
                logger.warning(f"[selling-advisor] Analytics data ingestion timeout for {query} (using cached data if available)")
                analytics_data = {}  # Continue with empty data (will use cache if available)
        
            # Get price trend
            price_trend = analytics_data.get("price_trend", {})
            similar_searches = analytics_data.get("similar_searches", {})
            
            # Calculate recommended price
            recommended_price = current_price or 0.0
            
            # Use analytics prediction if available (with timeout and retry logic)
            # Increased timeout to 5s to allow analytics service to respond (it's slow but we retry)
            prediction_items = [{
                "query": query,
                "record_grade": record_grade,
                "sleeve_grade": sleeve_grade,
            }]
            
            # Use timeout with retry logic (predict_price_from_analytics now has retries built-in)
            # Optimized for baseline: Reduced timeout to 6s (fail faster, use fallback pricing)
            try:
                prediction = await asyncio.wait_for(
                    predict_price_from_analytics(prediction_items, timeout=3.0, max_retries=2),  # Reduced timeout and retries
                    timeout=6.0  # Reduced from 10s to 6s (fail faster, use fallback pricing)
                )
                if prediction and prediction.get("suggested"):
                    recommended_price = float(prediction["suggested"])
            except asyncio.TimeoutError:
                logger.warning(f"[selling-advisor] Price prediction timeout for {query} (analytics service may be slow)")
                prediction = None
            except Exception as e:
                logger.warning(f"[selling-advisor] Price prediction failed for {query}: {e}")
                prediction = None
            
            # Analyze market conditions
            market_analysis = {
                "demand_level": "unknown",
                "price_trend": "stable",
                "competition": "unknown",
            }
            
            if price_trend:
                prices = price_trend.get("prices", [])
                if prices:
                    avg_price = statistics.mean(prices)
                    if recommended_price > avg_price * 1.1:
                        market_analysis["demand_level"] = "high"
                    elif recommended_price > avg_price * 0.9:
                        market_analysis["demand_level"] = "medium"
                    else:
                        market_analysis["demand_level"] = "low"
                    
                    # Determine price trend
                    if len(prices) >= 2:
                        recent_avg = statistics.mean(prices[-7:]) if len(prices) >= 7 else prices[-1]
                        older_avg = statistics.mean(prices[:-7]) if len(prices) >= 7 else prices[0]
                        if recent_avg > older_avg * 1.05:
                            market_analysis["price_trend"] = "increasing"
                        elif recent_avg < older_avg * 0.95:
                            market_analysis["price_trend"] = "decreasing"
        
            # Get similar searches for competition analysis
            if similar_searches and similar_searches.get("recommendations"):
                market_analysis["competition"] = "high" if len(similar_searches["recommendations"]) > 5 else "medium"
            
            # Generate pricing strategy
            pricing_strategy = "market_price"
            if market_analysis["demand_level"] == "high" and market_analysis["price_trend"] == "increasing":
                pricing_strategy = "premium"
                recommended_price *= 1.1
            elif market_analysis["demand_level"] == "low" or market_analysis["price_trend"] == "decreasing":
                pricing_strategy = "competitive"
                recommended_price *= 0.95
            
            # Timing recommendations
            timing = {
                "best_time": "now",
                "reason": "Market conditions are favorable",
            }
            
            if market_analysis["price_trend"] == "increasing":
                timing["best_time"] = "wait_1_2_weeks"
                timing["reason"] = "Prices are trending upward, consider waiting"
            elif market_analysis["price_trend"] == "decreasing":
                timing["best_time"] = "sell_now"
                timing["reason"] = "Prices are declining, sell soon"
            
            advice = {
                "query": query,
                "recommended_price": round(recommended_price, 2),
                "market_analysis": market_analysis,
                "pricing_strategy": pricing_strategy,
                "timing": timing,
                "confidence": "medium",
                "data_sources": {
                    "price_trend": price_trend is not None,
                    "similar_searches": similar_searches is not None,
                    "analytics_prediction": prediction is not None,
                },
            }
            
            # Store in cache and log (non-blocking where possible)
            processing_time_ms = int((time.time() - start_time) * 1000)
            
            # Store prediction in cache (async, but don't wait if slow)
            asyncio.create_task(store_prediction(
                query=query,
                prediction_type="selling",
                user_id=user_id,
                input_data={
                    "record_grade": record_grade,
                    "sleeve_grade": sleeve_grade,
                    "current_price": current_price,
                },
                prediction_result=advice,
                confidence_score=0.7 if advice.get("data_sources", {}).get("analytics_prediction") else 0.5,
                ttl_minutes=60
            ))
            
            # Log inference (async, don't block)
            asyncio.create_task(log_inference(
                user_id=user_id,
                query=query,
                inference_type="selling",
                input_data={
                    "record_grade": record_grade,
                    "sleeve_grade": sleeve_grade,
                    "current_price": current_price,
                },
                output_data=advice,
                processing_time_ms=processing_time_ms,
                analytics_data_used=analytics_data.get("price_trend") is not None,
                cache_hit=False
            ))
            
            # Publish event (async, don't block)
            asyncio.create_task(log_event(
                event_type="selling_advice",
                user_id=user_id,
                query=query,
                event_data={
                    "recommended_price": recommended_price,
                    "pricing_strategy": pricing_strategy,
                },
                kafka_published=False,
                kafka_topic="ai-events"
            ))
            asyncio.create_task(publish_ai_event("selling_advice", {
                "query": query,
                "recommended_price": recommended_price,
                "pricing_strategy": pricing_strategy,
            }))
            
            return advice
        
        # Phase 2: Multi-layer caching (L1 memory → L2 Redis → L3 DB → External API)
        # Check L1 (in-memory) cache first (fastest)
        from app.memory_cache import get_l1_advice_cache
        l1_cache = get_l1_advice_cache()
        l1_result = await l1_cache.get(cache_key)
        if l1_result is not None:
            logger.debug(f"[selling-advisor] L1 cache hit for {query}")
            return l1_result if isinstance(l1_result, dict) else {}
        
        # L1 miss, check L2 (Redis) via singleflight
        result = await get_with_singleflight(
            key=cache_key,
            fetch_fn=generate_advice,
            ttl=604800,  # Phase 1: Increased from 24h to 7 days (stable prices rarely change, reduces external API calls by ~75%)
            lock_ttl=15,  # Wait up to 15s for lock holder (advice generation can take time with external APIs)
            use_singleflight=True
        )
        
        # Store in L1 cache if we got a result
        if result:
            await l1_cache.set(cache_key, result, ttl=300)  # 5 min L1 TTL
        
        return result if result else {
            "query": query,
            "recommended_price": current_price or 0.0,
            "market_analysis": {"demand_level": "unknown", "price_trend": "stable", "competition": "unknown"},
            "pricing_strategy": "market_price",
            "timing": {"best_time": "now", "reason": "Unable to generate full analysis"},
            "confidence": "low",
            "data_sources": {},
        }


class BuyingAdvisor:
    """AI advisor for buying records"""
    
    @staticmethod
    async def get_buying_advice(
        query: str,
        max_budget: Optional[float] = None,
        user_id: Optional[str] = None,
        urgency: str = "normal"  # normal, high, low
    ) -> Dict:
        start_time = time.time()
        """
        Get AI-powered buying advice
        
        Returns:
        - Fair price estimate
        - Deal assessment
        - Alternative recommendations
        - Best time to buy
        """
        # Use Redis singleflight to prevent cache stampede
        from app.redis_cache import get_with_singleflight
        
        cache_key = f"ai:buying:{query}:{user_id or 'anonymous'}:{max_budget or 0}:{urgency}"
        
        async def generate_advice():
            """Generate buying advice - only one request executes, others wait"""
            # Check database cache first
            cached = await get_cached_prediction(query, "buying", user_id, ttl_minutes=60)
            if cached:
                logger.debug(f"[buying-advisor] Using cached prediction for {query}")
                await log_inference(
                    user_id=user_id,
                    query=query,
                    inference_type="buying",
                    input_data={"max_budget": max_budget, "urgency": urgency},
                    output_data=cached["prediction_result"],
                    processing_time_ms=10,
                    analytics_data_used=False,
                    cache_hit=True
                )
                return cached["prediction_result"]
            
            # Ingest analytics data (with timeout)
            # Increased timeout to 5s to allow analytics service to respond
            try:
                analytics_data = await asyncio.wait_for(
                    ingest_analytics_data(query, user_id),
                    timeout=8.0  # Increased from 5s to 8s (analytics service can be slow under 50 VUs load)
                )
            except asyncio.TimeoutError:
                logger.warning(f"[buying-advisor] Analytics data ingestion timeout for {query}")
                analytics_data = {}  # Continue with empty data
            
            # Get price trend and similar searches
            price_trend = analytics_data.get("price_trend", {})
            similar_searches = analytics_data.get("similar_searches", {})
            
            # Calculate fair price (with timeout)
            prediction_items = [{"query": query}]
            try:
                prediction = await asyncio.wait_for(
                    predict_price_from_analytics(prediction_items, timeout=5.0, max_retries=3),
                    timeout=10.0  # Increased from 5s to 10s (analytics service can be slow under 50 VUs load)
                )
            except asyncio.TimeoutError:
                logger.warning(f"[buying-advisor] Price prediction timeout for {query} (analytics service may be slow)")
                prediction = None
            except Exception as e:
                logger.warning(f"[buying-advisor] Price prediction failed for {query}: {e}")
                prediction = None
            
            fair_price = 0.0
            if prediction and prediction.get("suggested"):
                fair_price = float(prediction["suggested"])
            elif price_trend and price_trend.get("prices"):
                fair_price = statistics.median(price_trend["prices"])
            
            # Deal assessment
            deal_assessment = {
                "fair_price": round(fair_price, 2),
                "is_good_deal": None,
                "price_vs_market": "unknown",
            }
            
            if max_budget:
                if max_budget >= fair_price * 1.1:
                    deal_assessment["is_good_deal"] = True
                    deal_assessment["price_vs_market"] = "below_market"
                elif max_budget >= fair_price * 0.9:
                    deal_assessment["is_good_deal"] = True
                    deal_assessment["price_vs_market"] = "fair"
                else:
                    deal_assessment["is_good_deal"] = False
                    deal_assessment["price_vs_market"] = "above_market"
            
            # Alternative recommendations (limit to avoid slow queries)
            # Parallelize alternative queries for better performance
            alternatives = []
            if similar_searches and similar_searches.get("recommendations"):
                # Limit to 3 to avoid slow queries, run in parallel
                recs = similar_searches["recommendations"][:3]
                
                async def fetch_alt_price(rec):
                    """Fetch price for alternative recommendation"""
                    try:
                        alt_prediction = await asyncio.wait_for(
                            predict_price_from_analytics([{"query": rec.get("query", "")}], timeout=5.0, max_retries=2),
                            timeout=8.0  # Increased from 5s to 8s (analytics service can be slow under load)
                        )
                        alt_price = alt_prediction.get("suggested", 0) if alt_prediction else 0
                        return {
                            "query": rec.get("query", ""),
                            "similarity": rec.get("similarity", 0),
                            "estimated_price": round(alt_price, 2),
                        }
                    except (asyncio.TimeoutError, Exception):
                        # Skip slow alternative queries, return None
                        return None
                
                # Run alternative queries in parallel
                alt_results = await asyncio.gather(*[fetch_alt_price(rec) for rec in recs], return_exceptions=True)
                alternatives = [r for r in alt_results if r is not None and not isinstance(r, Exception)]
            
            # Best time to buy
            best_time = {
                "recommendation": "now",
                "reason": "Market conditions are stable",
            }
            
            if price_trend and price_trend.get("prices"):
                prices = price_trend["prices"]
                if len(prices) >= 7:
                    recent_avg = statistics.mean(prices[-7:])
                    older_avg = statistics.mean(prices[:-7])
                    if recent_avg < older_avg * 0.95:
                        best_time["recommendation"] = "wait"
                        best_time["reason"] = "Prices are declining, wait for better deals"
                    elif recent_avg > older_avg * 1.05:
                        best_time["recommendation"] = "buy_now"
                        best_time["reason"] = "Prices are rising, buy soon"
            
            if urgency == "high":
                best_time["recommendation"] = "buy_now"
                best_time["reason"] = "High urgency - buy now to avoid missing out"
            
            advice = {
                "query": query,
                "fair_price": round(fair_price, 2),
                "max_budget": max_budget,
                "deal_assessment": deal_assessment,
                "alternatives": alternatives,
                "best_time": best_time,
                "urgency": urgency,
                "confidence": "medium",
            }
        
            # Store in cache and log (non-blocking)
            processing_time_ms = int((time.time() - start_time) * 1000)
            
            asyncio.create_task(store_prediction(
                query=query,
                prediction_type="buying",
                user_id=user_id,
                input_data={"max_budget": max_budget, "urgency": urgency},
                prediction_result=advice,
                confidence_score=0.7 if prediction else 0.5,
                ttl_minutes=60
            ))
            
            asyncio.create_task(log_inference(
                user_id=user_id,
                query=query,
                inference_type="buying",
                input_data={"max_budget": max_budget, "urgency": urgency},
                output_data=advice,
                processing_time_ms=processing_time_ms,
                analytics_data_used=analytics_data.get("price_trend") is not None,
                cache_hit=False
            ))
            
            asyncio.create_task(log_event(
                event_type="buying_advice",
                user_id=user_id,
                query=query,
                event_data={"fair_price": fair_price, "is_good_deal": deal_assessment.get("is_good_deal")},
                kafka_published=False,
                kafka_topic="ai-events"
            ))
            asyncio.create_task(publish_ai_event("buying_advice", {
                "query": query,
                "fair_price": fair_price,
                "is_good_deal": deal_assessment.get("is_good_deal"),
            }))
            
            return advice
        
        # Use Redis singleflight
        result = await get_with_singleflight(
            key=cache_key,
            fetch_fn=generate_advice,
            ttl=3600,
            lock_ttl=10,
            use_singleflight=True
        )
        
        return result if result else {
            "query": query,
            "fair_price": 0.0,
            "max_budget": max_budget,
            "deal_assessment": {"fair_price": 0.0, "is_good_deal": None, "price_vs_market": "unknown"},
            "alternatives": [],
            "best_time": {"recommendation": "now", "reason": "Unable to generate full analysis"},
            "urgency": urgency,
            "confidence": "low",
        }


class NegotiationAdvisor:
    """AI advisor for negotiation (both buyer and seller perspectives)"""
    
    @staticmethod
    async def get_negotiation_advice(
        query: str,
        role: str,  # "buyer" or "seller"
        current_price: float,
        target_price: Optional[float] = None,
        user_id: Optional[str] = None
    ) -> Dict:
        start_time = time.time()
        """
        Get AI-powered negotiation advice
        
        Returns:
        - Negotiation strategy
        - Price range recommendations
        - Talking points
        - Counter-offer suggestions
        """
        # Use Redis singleflight to prevent cache stampede
        from app.redis_cache import get_with_singleflight
        
        cache_key = f"ai:negotiation:{query}:{user_id or 'anonymous'}:{role}:{current_price}:{target_price or 0}"
        
        async def generate_advice():
            """Generate negotiation advice - only one request executes, others wait"""
            # Check cache first
            cached = await get_cached_prediction(query, f"negotiation_{role}", user_id, ttl_minutes=30)
            if cached:
                logger.debug(f"[negotiation-advisor] Using cached prediction for {query} ({role})")
                await log_inference(
                    user_id=user_id,
                    query=query,
                    inference_type=f"negotiation_{role}",
                    input_data={"role": role, "current_price": current_price, "target_price": target_price},
                    output_data=cached["prediction_result"],
                    processing_time_ms=10,
                    analytics_data_used=False,
                    cache_hit=True
                )
                return cached["prediction_result"]
            
            # Ingest analytics data (with timeout)
            # Increased timeout to 5s to allow analytics service to respond
            try:
                analytics_data = await asyncio.wait_for(
                    ingest_analytics_data(query, user_id),
                    timeout=8.0  # Increased from 5s to 8s (analytics service can be slow under 50 VUs load)
                )
            except asyncio.TimeoutError:
                logger.warning(f"[buying-advisor] Analytics data ingestion timeout for {query}")
                analytics_data = {}  # Continue with empty data
            
            # Get market data
            price_trend = analytics_data.get("price_trend", {})
            prediction_items = [{"query": query}]
            try:
                prediction = await asyncio.wait_for(
                    predict_price_from_analytics(prediction_items, timeout=5.0, max_retries=3),
                    timeout=10.0  # Increased from 5s to 10s (analytics service can be slow under 50 VUs load)
                )
            except asyncio.TimeoutError:
                logger.warning(f"[negotiation-advisor] Price prediction timeout for {query} (analytics service may be slow)")
                prediction = None
            except Exception as e:
                logger.warning(f"[negotiation-advisor] Price prediction failed for {query}: {e}")
                prediction = None
            
            market_price = 0.0
            if prediction and prediction.get("suggested"):
                market_price = float(prediction["suggested"])
            elif price_trend and price_trend.get("prices"):
                market_price = statistics.median(price_trend["prices"])
            
            # Calculate negotiation range
            if role == "buyer":
                # Buyer wants to pay less
                min_offer = market_price * 0.85
                max_offer = market_price * 0.95
                ideal_price = market_price * 0.90
                
                if current_price > market_price * 1.1:
                    negotiation_stance = "firm"
                    strategy = "Request significant discount - price is above market"
                elif current_price > market_price:
                    negotiation_stance = "moderate"
                    strategy = "Negotiate for fair market price"
                else:
                    negotiation_stance = "flexible"
                    strategy = "Good price - consider accepting or small counter-offer"
            
            else:  # seller
                # Seller wants to get more
                min_accept = market_price * 0.95
                max_ask = market_price * 1.15
                ideal_price = market_price * 1.05
                
                if current_price < market_price * 0.9:
                    negotiation_stance = "firm"
                    strategy = "Hold firm - price is below market value"
                elif current_price < market_price:
                    negotiation_stance = "moderate"
                    strategy = "Negotiate toward market price"
                else:
                    negotiation_stance = "flexible"
                    strategy = "Good offer - consider accepting or small counter-offer"
            
            # Generate talking points
            talking_points = []
            if price_trend and price_trend.get("prices"):
                prices = price_trend["prices"]
                if len(prices) >= 7:
                    recent_avg = statistics.mean(prices[-7:])
                    if recent_avg > market_price * 1.05:
                        talking_points.append("Recent market prices have been trending upward")
                    elif recent_avg < market_price * 0.95:
                        talking_points.append("Recent market prices have been declining")
            
            similar_searches = analytics_data.get("similar_searches")
            if similar_searches and similar_searches.get("recommendations"):
                talking_points.append(f"Similar items are available in the market")
            
            # Counter-offer suggestions
            counter_offers = []
            if role == "buyer":
                if current_price > market_price:
                    # Suggest lower counter-offers
                    counter_offers.append({
                        "amount": round(market_price * 0.90, 2),
                        "reason": "10% below market price - fair starting point",
                    })
                    counter_offers.append({
                        "amount": round(market_price * 0.85, 2),
                        "reason": "15% below market price - aggressive but reasonable",
                    })
            else:  # seller
                if current_price < market_price:
                    # Suggest higher counter-offers
                    counter_offers.append({
                        "amount": round(market_price * 1.05, 2),
                        "reason": "5% above market price - reasonable counter",
                    })
                    counter_offers.append({
                        "amount": round(market_price * 1.10, 2),
                        "reason": "10% above market price - strong counter",
                    })
            
            advice = {
                "query": query,
                "role": role,
                "current_price": current_price,
                "market_price": round(market_price, 2),
                "target_price": target_price,
                "negotiation_range": {
                    "min": round(min_offer if role == "buyer" else min_accept, 2),
                    "max": round(max_offer if role == "buyer" else max_ask, 2),
                    "ideal": round(ideal_price, 2),
                },
                "negotiation_stance": negotiation_stance,
                "strategy": strategy,
                "talking_points": talking_points,
                "counter_offers": counter_offers,
                "confidence": "medium",
            }
        
            # Store in cache and log (non-blocking)
            processing_time_ms = int((time.time() - start_time) * 1000)
            
            asyncio.create_task(store_prediction(
                query=query,
                prediction_type=f"negotiation_{role}",
                user_id=user_id,
                input_data={"role": role, "current_price": current_price, "target_price": target_price},
                prediction_result=advice,
                confidence_score=0.7 if market_price > 0 else 0.5,
                ttl_minutes=30
            ))
            
            asyncio.create_task(log_inference(
                user_id=user_id,
                query=query,
                inference_type=f"negotiation_{role}",
                input_data={"role": role, "current_price": current_price, "target_price": target_price},
                output_data=advice,
                processing_time_ms=processing_time_ms,
                analytics_data_used=analytics_data.get("price_trend") is not None,
                cache_hit=False
            ))
            
            asyncio.create_task(log_event(
                event_type="negotiation_advice",
                user_id=user_id,
                query=query,
                event_data={"role": role, "current_price": current_price, "market_price": market_price},
                kafka_published=False,
                kafka_topic="ai-events"
            ))
            asyncio.create_task(publish_ai_event("negotiation_advice", {
                "query": query,
                "role": role,
                "current_price": current_price,
                "market_price": market_price,
            }))
            
            return advice
        
        # Use Redis singleflight
        result = await get_with_singleflight(
            key=cache_key,
            fetch_fn=generate_advice,
            ttl=1800,  # 30 minutes (shorter for negotiations)
            lock_ttl=10,
            use_singleflight=True
        )
        
        return result if result else {
            "query": query,
            "role": role,
            "current_price": current_price,
            "market_price": 0.0,
            "target_price": target_price,
            "negotiation_range": {"min": 0.0, "max": 0.0, "ideal": 0.0},
            "negotiation_stance": "moderate",
            "strategy": "Unable to generate full analysis",
            "talking_points": [],
            "counter_offers": [],
            "confidence": "low",
        }


class BiddingAdvisor:
    """AI advisor for auction bidding"""
    
    @staticmethod
    async def get_bidding_advice(
        query: str,
        current_bid: float,
        auction_end_time: Optional[datetime] = None,
        user_id: Optional[str] = None,
        max_budget: Optional[float] = None
    ) -> Dict:
        start_time = time.time()
        """
        Get AI-powered bidding advice for auctions
        
        Returns:
        - Should you bid?
        - Maximum recommended bid
        - Bidding strategy
        - Risk assessment
        """
        # Use Redis singleflight to prevent cache stampede
        from app.redis_cache import get_with_singleflight
        
        cache_key = f"ai:bidding:{query}:{user_id or 'anonymous'}:{current_bid}:{max_budget or 0}"
        
        async def generate_advice():
            """Generate bidding advice - only one request executes, others wait"""
            # Check cache first (very short TTL for bidding)
            cached = await get_cached_prediction(query, "bidding", user_id, ttl_minutes=5)
            if cached:
                logger.debug(f"[bidding-advisor] Using cached prediction for {query}")
                await log_inference(
                    user_id=user_id,
                    query=query,
                    inference_type="bidding",
                    input_data={
                        "current_bid": current_bid,
                        "auction_end_time": auction_end_time.isoformat() if auction_end_time else None,
                        "max_budget": max_budget,
                    },
                    output_data=cached["prediction_result"],
                    processing_time_ms=10,
                    analytics_data_used=False,
                    cache_hit=True
                )
                return cached["prediction_result"]
            
            # Ingest analytics data (with timeout)
            # Increased timeout to 5s to allow analytics service to respond
            try:
                analytics_data = await asyncio.wait_for(
                    ingest_analytics_data(query, user_id),
                    timeout=8.0  # Increased from 5s to 8s (analytics service can be slow under 50 VUs load)
                )
            except asyncio.TimeoutError:
                logger.warning(f"[buying-advisor] Analytics data ingestion timeout for {query}")
                analytics_data = {}  # Continue with empty data
        
        # Get market price
        prediction_items = [{"query": query}]
        # Use retry logic for price prediction (fault-tolerant)
        prediction = await predict_price_from_analytics(prediction_items, timeout=8.0, max_retries=3)
        
        market_price = 0.0
        if prediction and prediction.get("suggested"):
            market_price = float(prediction["suggested"])
        
            # Calculate maximum bid
            max_recommended_bid = market_price * 0.95  # Don't bid more than market price
            if max_budget:
                max_recommended_bid = min(max_recommended_bid, max_budget * 0.95)
            
            # Should you bid?
            should_bid = {
                "recommendation": "yes",
                "reason": "Price is reasonable",
                "confidence": "medium",
            }
            
            if current_bid >= max_recommended_bid:
                should_bid["recommendation"] = "no"
                should_bid["reason"] = f"Current bid (${current_bid:.2f}) exceeds recommended maximum (${max_recommended_bid:.2f})"
                should_bid["confidence"] = "high"
            elif current_bid >= market_price * 0.90:
                should_bid["recommendation"] = "caution"
                should_bid["reason"] = "Bid is approaching market price - proceed carefully"
                should_bid["confidence"] = "medium"
            else:
                should_bid["recommendation"] = "yes"
                should_bid["reason"] = f"Current bid (${current_bid:.2f}) is below market price (${market_price:.2f})"
                should_bid["confidence"] = "high"
            
            # Bidding strategy
            bidding_strategy = {
                "approach": "moderate",
                "increment": round(max_recommended_bid * 0.02, 2),  # 2% increments
                "max_bid": round(max_recommended_bid, 2),
                "tactics": [],
            }
            
            if auction_end_time:
                time_remaining = (auction_end_time - datetime.utcnow()).total_seconds()
                if time_remaining < 3600:  # Less than 1 hour
                    bidding_strategy["approach"] = "aggressive"
                    bidding_strategy["tactics"].append("Bid early to establish presence")
                    bidding_strategy["tactics"].append("Watch for last-minute snipers")
                elif time_remaining < 86400:  # Less than 1 day
                    bidding_strategy["approach"] = "moderate"
                    bidding_strategy["tactics"].append("Monitor auction closely")
                    bidding_strategy["tactics"].append("Prepare final bid strategy")
                else:
                    bidding_strategy["approach"] = "patient"
                    bidding_strategy["tactics"].append("Set maximum bid early")
                    bidding_strategy["tactics"].append("Let others bid first")
            
            # Risk assessment
            risk_assessment = {
                "level": "medium",
                "factors": [],
            }
            
            if current_bid > market_price * 1.1:
                risk_assessment["level"] = "high"
                risk_assessment["factors"].append("Bidding above market price")
            elif current_bid < market_price * 0.85:
                risk_assessment["level"] = "low"
                risk_assessment["factors"].append("Good price opportunity")
            
            if max_budget and max_recommended_bid > max_budget * 0.9:
                risk_assessment["level"] = "high"
                risk_assessment["factors"].append("Approaching budget limit")
            
            advice = {
                "query": query,
                "current_bid": current_bid,
                "market_price": round(market_price, 2),
                "max_recommended_bid": round(max_recommended_bid, 2),
                "max_budget": max_budget,
                "should_bid": should_bid,
                "bidding_strategy": bidding_strategy,
                "risk_assessment": risk_assessment,
                "auction_end_time": auction_end_time.isoformat() if auction_end_time else None,
                "confidence": "medium",
            }
        
            # Store in cache and log (non-blocking)
            processing_time_ms = int((time.time() - start_time) * 1000)
            
            asyncio.create_task(store_prediction(
                query=query,
                prediction_type="bidding",
                user_id=user_id,
                input_data={
                    "current_bid": current_bid,
                    "auction_end_time": auction_end_time.isoformat() if auction_end_time else None,
                    "max_budget": max_budget,
                },
                prediction_result=advice,
                confidence_score=0.8 if market_price > 0 else 0.5,
                ttl_minutes=5
            ))
            
            asyncio.create_task(log_inference(
                user_id=user_id,
                query=query,
                inference_type="bidding",
                input_data={
                    "current_bid": current_bid,
                    "auction_end_time": auction_end_time.isoformat() if auction_end_time else None,
                    "max_budget": max_budget,
                },
                output_data=advice,
                processing_time_ms=processing_time_ms,
                analytics_data_used=analytics_data.get("price_trend") is not None,
                cache_hit=False
            ))
            
            asyncio.create_task(log_event(
                event_type="bidding_advice",
                user_id=user_id,
                query=query,
                event_data={
                    "current_bid": current_bid,
                    "max_recommended_bid": max_recommended_bid,
                    "should_bid": should_bid["recommendation"],
                },
                kafka_published=False,
                kafka_topic="ai-events"
            ))
            asyncio.create_task(publish_ai_event("bidding_advice", {
                "query": query,
                "current_bid": current_bid,
                "max_recommended_bid": max_recommended_bid,
                "should_bid": should_bid["recommendation"],
            }))
            
            return advice
        
        # Use Redis singleflight
        result = await get_with_singleflight(
            key=cache_key,
            fetch_fn=generate_advice,
            ttl=300,  # 5 minutes (short for bidding)
            lock_ttl=10,
            use_singleflight=True
        )
        
        return result if result else {
            "query": query,
            "current_bid": current_bid,
            "market_price": 0.0,
            "max_recommended_bid": max_budget or 0.0,
            "max_budget": max_budget,
            "should_bid": {"recommendation": "unknown", "reason": "Unable to generate full analysis", "confidence": "low"},
            "bidding_strategy": {"approach": "moderate", "increment": 0.0, "max_bid": 0.0, "tactics": []},
            "risk_assessment": {"level": "medium", "factors": []},
            "auction_end_time": auction_end_time.isoformat() if auction_end_time else None,
            "confidence": "low",
        }

