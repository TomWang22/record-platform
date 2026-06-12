# Record Platform AI contracts (Phase 15 canonical)

Generated: 2026-06-11  
Baseline: `d0af166` / tag `rp-marketplace-release-20260611`  
Edge: `https://record-platform.test` (strict TLS only)

This document defines the **target** AI platform contracts for Phase 15.  
Current implementation status is tracked in `bench_logs/ai-platform/t15-ai-architecture-inventory.md`.

---

## Design principles

1. **Live data only** — every insight cites `source_refs` from platform DBs/events; no fabricated prose when data is missing.
2. **Degraded, not fake** — when Ollama or upstream DB is unavailable, return `source_status: degraded` with structured error codes, not mock AI text.
3. **Owner-scoped privacy** — RAG and summaries are filtered by `owner_user_id`; private message bodies never cross users.
4. **Outbox-first events** — AI signals publish via existing transactional outbox → Kafka → notification path.
5. **No OCH/housing semantics** — marketplace record/listing/auction vocabulary only.

---

## Canonical insight types

| Contract ID | User-facing name | Primary service | HTTP (target) | gRPC (optional) |
|-------------|------------------|-----------------|----------------|-----------------|
| `record_valuation` | Record valuation insight | python-ai-service | `POST /ai/records/valuation` | `GetRecordValuation` |
| `listing_quality` | Listing quality insight | analytics-service | `POST /ai/listings/quality` | `AnalyzeListingQuality` |
| `pricing_recommendation` | Pricing recommendation | python-ai-service | `POST /ai/listings/pricing-advice` | `GetPricingAdvice` |
| `auction_risk` | Auction risk / anomaly | python-ai-service + auction-monitor | `POST /ai/auctions/risk` | `GetAuctionRisk` |
| `seller_sales_summary` | Seller sales summary | analytics-service | `POST /ai/seller/summary` | `GetSellerSummary` |
| `buyer_collection_summary` | Buyer collection summary | analytics-service | `POST /ai/buyer/collection-summary` | `GetBuyerCollectionSummary` |
| `rag_query` | RAG over owned data | python-ai-service | `POST /ai/rag/query` | `RagQuery` |

Gateway exposure (target):

| Edge path | Upstream |
|-----------|----------|
| `POST /api/ai/rag/query` | python-ai `POST /ai/rag/query` |
| `POST /api/ai/records/valuation` | python-ai `POST /ai/records/valuation` |
| `POST /api/ai/listings/pricing-advice` | python-ai `POST /ai/listings/pricing-advice` |
| `POST /api/ai/auctions/risk` | python-ai `POST /ai/auctions/risk` |
| `POST /api/ai/seller/summary` | python-ai `POST /ai/seller/summary` |
| `POST /api/ai/buyer/collection-summary` | python-ai `POST /ai/buyer/collection-summary` |
| `GET /api/ai/insights` | analytics aggregate (T15.4) |

---

## Shared response envelope

All Phase 15 AI HTTP responses MUST use this shape:

```json
{
  "insight_id": "uuid",
  "contract_id": "record_valuation",
  "source_status": "live | degraded",
  "model_used": "llama3.2:1b | rule-engine | none",
  "generated_at": "ISO-8601",
  "confidence": 0.0,
  "summary": "human-readable headline",
  "details": {},
  "source_refs": [
    {
      "source_type": "record | listing | offer_summary | auction_bid_summary | notification | event",
      "source_id": "uuid",
      "field": "optional field path",
      "freshness": "ISO-8601 of source updated_at",
      "checksum": "sha256 of normalized excerpt"
    }
  ],
  "citations": [],
  "degraded_reason": "optional code when source_status=degraded"
}
```

**Forbidden:** responses that look like LLM output without `source_refs` when `source_status=live`.

---

## Contract: `record_valuation`

**Purpose:** Grade-aware valuation for a user-owned record using collection metadata + market comparables.

| Field | Rule |
|-------|------|
| **Source data** | `records.records` (owner), `analytics` price snapshots / predict-price history, eBay/Discogs via python-ai (cached), optional RAG chunks |
| **Owner** | `records-service` / records DB |
| **Freshness** | Recompute when record `updated_at` or new price snapshot within 24h |
| **Privacy** | `owner_user_id` = authenticated user; no cross-user record access |
| **Ollama role** | Summarize structured comps only; numeric bounds from rules/ML first |

**Request:**

```json
{ "record_id": "uuid", "include_comps": true }
```

---

## Contract: `listing_quality`

**Purpose:** Actionable listing quality score (photos, description, shipping, pricing mode consistency).

| Field | Rule |
|-------|------|
| **Source data** | `listings.listings`, `listings.listing_revisions`, media metadata, watchlist engagement projections |
| **Owner** | `listings-service` |
| **Freshness** | Invalidate on listing revision or media change |
| **Privacy** | Seller-owned listing or public listing fields only |
| **Ollama role** | Narrative quality tips from structured checklist |

---

## Contract: `pricing_recommendation`

**Purpose:** Suggested list price / reserve / starting bid band for a listing.

| Field | Rule |
|-------|------|
| **Source data** | Listing price fields, `analytics` predict-price, platform comparables search, OBO/auction mode |
| **Owner** | `listings-service` + `analytics-service` |
| **Freshness** | 1h TTL per listing revision checksum |
| **Privacy** | Seller-only for draft/unpublished; public comparables for active listings |
| **Ollama role** | Explain recommendation; numbers from analytics/python-ai engines |

---

## Contract: `auction_risk`

**Purpose:** Risk signals: ending soon, bid spike, proxy pressure, reserve not met, underpriced vs comps.

| Field | Rule |
|-------|------|
| **Source data** | `listings` auction state, bid history API, `auction_monitor.auction_results`, analytics bid aggregates |
| **Owner** | `listings-service` (in-platform auctions), `auction-monitor` (external watchlist) |
| **Freshness** | Near-real-time for active auctions (< 5m); external eBay poll interval |
| **Privacy** | Public auction fields + bidder's own proxy state only |
| **Ollama role** | Optional explanation layer; signals computed by rules first |

**Signal codes (auction-monitor + analytics):**

- `bid_spike`
- `ending_soon`
- `proxy_bid_pressure`
- `reserve_not_met`
- `likely_underpriced`
- `stale_listing`

---

## Contract: `seller_sales_summary`

**Purpose:** AI-assisted summary of seller performance (listings sold, OBO acceptance rate, auction close rate).

| Field | Rule |
|-------|------|
| **Source data** | `shopping` orders/cart, `listings.offers` + `offer_events`, auction close events, analytics daily metrics |
| **Owner** | `analytics-service` projections |
| **Freshness** | Daily roll-up + event-driven invalidation |
| **Privacy** | `user_id` = seller only |

---

## Contract: `buyer_collection_summary`

**Purpose:** Collection insights: acquisition patterns, spend bands, genre/format distribution, watchlist overlap.

| Field | Rule |
|-------|------|
| **Source data** | `records.records`, purchases, recently viewed, watchlist, analytics search history |
| **Owner** | `records-service` + `analytics-service` |
| **Freshness** | Daily; record CRUD triggers partial reindex |
| **Privacy** | Buyer `user_id` only |

---

## Contract: `rag_query`

**Purpose:** Question answering over user-owned and public marketplace corpus with citations.

| Field | Rule |
|-------|------|
| **Source data** | RAG chunks (see inventory §RAG sources) |
| **Owner** | `python-ai-service` ingestion pipeline |
| **Freshness** | Per-chunk `updated_at` + `checksum`; full reindex via `scripts/rp-ai-rag-reindex.sh` |
| **Privacy** | **Strict:** query returns only chunks where `visibility in (owner, public)` AND `owner_user_id = caller` OR `visibility = public` |

**RAG corpus (ingestion targets):**

| `source_type` | DB / service | Visibility default | Message bodies |
|---------------|--------------|-------------------|----------------|
| `record` | `records.records` | `owner` | N/A |
| `listing` | `listings.listings` | `public` if active else `owner` | N/A |
| `listing_revision` | `listings.listing_revisions` | `owner` (seller) | N/A |
| `obo_offer_summary` | `listings.offers` + `offer_events` (aggregated) | `owner` (buyer/seller role) | No raw negotiation text in cross-user RAG |
| `auction_bid_summary` | listings auction bid aggregates | `public` for listing; bidder own bids `owner` | Masked bidder IDs only |
| `notification` | `notification` + analytics events | `owner` | Title/body excerpt max 500 chars |
| `message` | `messaging` | `owner` | **Opt-in only**; never ingest other users' threads |

**Storage (Phase 15 target):** `ai.ai_documents` + `ai.ai_document_chunks` in python-ai DB (or analytics if unified); embeddings via Ollama `/api/embeddings` when available.

---

## Event contracts (outbox → Kafka)

| Event | Proto / topic (target) | Producer | Consumer |
|-------|------------------------|----------|----------|
| `AIInsightCreatedV1` | `${ENV_PREFIX}.ai.events` | analytics-service | notification-service |
| `AuctionRiskDetectedV1` | `${ENV_PREFIX}.auction_monitor.events` | auction-monitor | notification-service, analytics |
| `PricingRecommendationCreatedV1` | `${ENV_PREFIX}.ai.events` | python-ai-service | notification-service |

Existing proto today: `proto/events/ai.proto` defines only `PricePredictedV1`, `ModelPublishedV1` — **Phase 15 extends this file**.

---

## Ollama access rules

| Consumer | Endpoint | Resolution |
|----------|----------|------------|
| python-ai-service | `OLLAMA_BASE_URL` | Cluster DNS `ollama:11434` or MetalLB `ollama-lb` |
| analytics-service (listing feel) | same | Via `http-server.ts` path when mounted |
| ollama-gateway | batch + semantic cache | Redis + Kafka `ollama-jobs` |

**Timeouts:** HTTP 30s default; 2 retries with jitter; hard fail → `source_status: degraded`.

**No localhost-only:** services must use k8s Service DNS or documented MetalLB IP (`scripts/apply-ollama-metallb-lb.sh`).

---

## Current vs target endpoint map

| Target (Phase 15) | Exists today | Notes |
|-------------------|--------------|-------|
| `POST /ai/rag/query` | No | `POST /chat` is template demo |
| `POST /ai/records/valuation` | Partial | `POST /predict-price`, `POST /ai/selling-advice` |
| `POST /ai/listings/pricing-advice` | Partial | Advisors + analytics predict-price |
| `POST /ai/auctions/risk` | Partial | `POST /ai/bidding-advice`; gRPC `AuctionHeat` stub |
| `POST /ai/seller/summary` | Partial | `POST /ai/selling-advice` |
| `POST /ai/buyer/collection-summary` | Partial | `POST /ai/buying-advice` |
| `GET /api/ai/insights` | No | Insights page uses disparate clients |
| `POST /insights/listing-feel` | Yes (unwired) | In `analytics http-server.ts`, not production entry |

---

## Phase 15 ticket mapping

| Ticket | Delivers |
|--------|----------|
| T15.1 | This file + architecture inventory |
| T15.2 | RAG tables, ingestion, `rp-ai-rag-reindex.sh`, `audit-rp-ai-rag-contract.sh` |
| T15.3 | python-ai Ollama endpoints + contract tests |
| T15.4 | analytics + auction-monitor signals + outbox events |
| T15.5 | UI surfaces, E2E, screenshots, full gates, commit |

**Phase 16 not started.**
