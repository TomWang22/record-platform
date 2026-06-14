# Record Platform AI platform release 20260613

Generated: 2026-06-13  
Edge: `https://record-platform.test` (strict TLS only)

## Release identity

| Field | Value |
|-------|-------|
| Main SHA | `a234b9683e51582e6fcdb1119497ea73194958a4` |
| Short SHA | `a234b96` |
| T15.5 feature SHA | `45719767998ea0f692240657c1e26a162307ddeb` |
| Previous release tag | `rp-marketplace-release-20260611` |
| Previous release SHA | `d0af166dd0ec3295c118459945b374a60470230d` |
| Prepared tag (not created) | `rp-ai-platform-release-20260613` |
| Phase 16 | **Not started** |

## T15.1–T15.5 chain

| Ticket | Scope | Status |
|--------|-------|--------|
| **T15.1** | AI platform architecture inventory + canonical contracts (`docs/ai-platform/rp-ai-contracts.md`) | Green |
| **T15.2** | RAG corpus schema, analytics normalization, reindex + RAG contract audit | Green |
| **T15.3** | python-ai provider registry (rule/Ollama/HF/PyTorch/TF), insight envelopes, gateway AI routes | Green |
| **T15.4** | Analytics → python-ai → outbox/Kafka/notification pipeline; auction-monitor signals; platform event matrix | Green |
| **T15.5** | `/insights` AI UI (live `/api/ai/*` only), notification deep links, 6 Playwright UI contracts + 7 AI screenshots | Green |

**Platform flow (locked):** analytics cleans/normalizes → python-ai retrieves/reasons with provider layer → UI shows grounded insights with `source_refs` → outbox/Kafka/notification proof.

## AI endpoints shipped (edge)

| Method | Path | Contract |
|--------|------|----------|
| GET | `/api/ai/rag/status` | RAG corpus + provider status |
| POST | `/api/ai/rag/query` | `rag_query` |
| POST | `/api/ai/records/valuation` | `record_valuation` |
| POST | `/api/ai/listings/pricing-advice` | `pricing_recommendation` |
| GET | `/api/ai/offer-insights` | OBO helper (offer summaries only) |
| POST | `/api/ai/auctions/risk` | `auction_risk` |
| POST | `/api/ai/seller/summary` | `seller_sales_summary` |
| POST | `/api/ai/buyer/collection-summary` | `buyer_collection_summary` |
| GET | `/api/analytics/ai/features/:userId` | Analytics feature pipeline → `AIInsightCreatedV1` |
| GET | `/auctions/ai-signals` | Persisted auction-monitor signals |

**UI surface:** `/insights` — dashboard cards for all insight types above (no legacy chat/mock/demo path).

## RAG corpus (python_ai @ 5440)

| Metric | Count |
|--------|------:|
| Documents | 43,326 |
| Chunks | 43,330 |

| source_type | documents |
|-------------|----------:|
| notification | 26,850 |
| listing | 8,833 |
| listing_revision | 5,489 |
| obo_offer_summary | 1,348 |
| record | 585 |
| auction_bid_summary | 221 |

Retrieval mode: `keyword` (owner-scoped). Message bodies opt-in only. No proxy max in corpus.

## Provider status (`GET /api/ai/rag/status`)

| Provider | Status | Notes |
|----------|--------|-------|
| **rule** | live | Active production boundary (`model_used: rule-engine`) |
| **Ollama** | degraded | Backend optional; unavailable DNS in cluster sample |
| **HuggingFace** | disabled | `disabled_by_default` |
| **PyTorch** | disabled | `disabled_by_default` |
| **TensorFlow** | disabled | `disabled_by_default` |

Embeddings: `degraded` (`nomic-embed-text`; 0 chunks with embedding — keyword retrieval path is live).

## Analytics features

Pipeline: `GET /api/analytics/ai/features/:userId` emits normalized features with per-feature `source_refs` and drains to `AIInsightCreatedV1` outbox.

## Auction monitor signals (5438)

| signal_code | persisted rows |
|-------------|---------------:|
| proxy_bid_pressure | 103 |
| likely_underpriced | 75 |
| stale_listing | 65 |
| reserve_not_met | 49 |
| ending_soon | 33 |
| **Total signals** | **325** |

Codes: `bid_spike`, `ending_soon`, `proxy_bid_pressure`, `reserve_not_met`, `likely_underpriced`, `stale_listing`.

## AI event outbox (`published=true`)

| Event | DB | published=true |
|-------|-----|---------------:|
| `AIInsightCreatedV1` | analytics (5439) | 46 |
| `PricingRecommendationCreatedV1` | python_ai (5440) | 55 |
| `AuctionRiskDetectedV1` | auction_monitor (5438) | 76,269 |

Notifications table (5441): rows for `AIInsightCreatedV1`, `AuctionRiskDetectedV1`, `PricingRecommendationCreatedV1` with `marketplace_ai` category and `/insights` deep links.

## Contract screenshots (dated)

Path: `webapp/e2e/screenshots/authenticated/2026-06-13/`

- `authenticated-ai-insights-dashboard.png`
- `authenticated-ai-record-valuation.png`
- `authenticated-ai-pricing-obo-helper.png`
- `authenticated-ai-auction-risk-monitor.png`
- `authenticated-ai-seller-summary.png`
- `authenticated-ai-buyer-summary.png`
- `authenticated-ai-notification-bell.png`

## Rollback

```bash
# Git: return to pre-AI-platform marketplace release
git checkout rp-marketplace-release-20260611
# or
git reset --hard d0af166dd0ec3295c118459945b374a60470230d

# Kubernetes: roll back AI-touching deployments
kubectl -n record-platform rollout undo deployment/webapp
kubectl -n record-platform rollout undo deployment/python-ai-service
kubectl -n record-platform rollout undo deployment/analytics-service
kubectl -n record-platform rollout undo deployment/auction-monitor
kubectl -n record-platform rollout undo deployment/notification-service
kubectl -n record-platform rollout undo deployment/api-gateway
```

## Tag (prepared, not executed)

```bash
git tag -a rp-ai-platform-release-20260613 -m "Record Platform AI platform release"
```

## Phase 16

**Not started.** Phase 15 closeout only — no soak dashboards, external provider expansion, or new product scope.
