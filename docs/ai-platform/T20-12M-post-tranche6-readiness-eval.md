# T20.12M — Post–Tranche 6 readiness and live inference eval

**Status:** READ-ONLY eval complete  
**Generated:** 2026-06-25  
**Baseline SHA:** post–T20.12K write  
**Tranche:** `t20-tranche-6` (+500 embeddings, 6,565 → 7,065; T20.12J-S adjusted caps)

## Corpus snapshot

| Metric | Value |
|--------|------:|
| Embedded chunks | **7,065** |
| Non-message chunks | 73,043 |
| Coverage | **≈9.7%** |
| Rollout threshold | ≥15% or ≥10k embedded |
| Gap to 10k | +2,935 |
| Gap to 15% (~10,957) | +3,892 |
| OBO eligible pool | **0** (exhausted) |

### Embedded by source_type

| source_type | embedded | delta (Tranche 6) |
|-------------|--------:|-------------------:|
| obo_offer_summary | 1,544 | +126 |
| listing | 2,524 | +224 |
| listing_revision | 1,200 | +100 |
| notification | 950 | +50 |
| record | 594 | 0 |
| auction_bid_summary | 253 | 0 |

## Gate results (post–Tranche 6)

| Gate | Result | Notes |
|------|--------|-------|
| Embedded coverage | **FAIL** | 9.7% / 7,065 — below rollout bar |
| Source diversity | **PASS** | 6 types in shadow diagnostic |
| Owner-visible OBO embedded | **PASS** | 18 / 1,544 total embedded OBO |
| Shadow p50/p95 (warm) | **PASS** | 1,171 / 2,277 ms (T20.10T 20260625-184042) |
| Embed p50/p95 | **PASS** | 500 / 1,191 ms; 0 timeouts on warm eval run |
| Default/off chunk overlap | **DIAGNOSTIC** | 1/7 cases with chunk overlap > 0 (transcript) |
| Flagged/on overlap | **DIAGNOSTIC** | 3/7 cases with chunk overlap > 0; flags reset 0/0 |
| Leakage | **PASS** | wrong_dim=0, message_embeddings=0, proxy_leaks=0; transcript PASS |
| Keyword stability | **PASS** | 7/7 keyword cases non-empty; RAG quality smoke PASS |
| Tranche rerun guard | **PASS** | Tranche 2–6 locks block (exit 2) |
| RAG contract | **PASS** | `audit-rp-ai-rag-contract.sh` |
| Quality smoke | **PASS** | `rp-ai-rag-quality-smoke.sh` |
| Runtime/endpoints | **PASS** | runtime + endpoints contract |
| Provider/pgvector | **PASS** | Ollama available; pgvector ready |
| RP | **PASS** | `rp-rp-decontaminate-scan.sh` |

### Shadow source diagnostic (T19.6C)

**RESULT: PASS (0 issues)**

- Unweighted types: auction_bid_summary, listing, listing_revision, notification, obo_offer_summary
- Weighted/hinted types: + record (6 total)
- OBO owner-visible: 18 / 1,544 total embedded OBO

## Timing benchmark (warm, flags off)

Artifact (local): `bench_logs/ai-platform/t20-10-shadow-real-query-20260625-184042.md`

| Metric | Value |
|--------|------:|
| shadow p50/p95 ms | 1,171 / 2,277 |
| embed p50/p95 ms | 500 / 1,191 |
| candidate_fetch p50/p95 ms | 421 / 1,046 |
| embed timeouts | 0 |
| zero-overlap shadow runs | 11/16 |

Pre-write gate (K1) had 1 embed timeout on timing run; source diagnostic PASS after warmup — write proceeded per flight plan.

## Live inference transcript (T20.12H harness)

Artifact (local): `bench_logs/ai-platform/live-inference/20260625-184149.md`  
Raw JSON: `bench_logs/ai-platform/live-inference/raw-20260625-184149/`

### Production keyword (7 prompts)

All HTTP 200, `retrieval_mode=keyword`, `model_used=rule-engine`, leakage PASS.

| Case | Source types (sample) | Refs |
|------|----------------------|-----:|
| catalog activity | listing, listing_revision | 7 |
| seller notifications | obo_offer_summary | 8 |
| offer/bidding | obo_offer_summary | 8 |
| listing revisions | obo_offer_summary | 8 |
| negotiation context | listing | 8 |
| seller attention | listing | 8 |
| marketplace activity | obo_offer_summary | 8 |

### Shadow flags-off (7 prompts)

7/7 ok. Default overlap: **1/7** chunk overlap (offer_bidding).

### Shadow flags-on (7 prompts)

**3/7** cases with chunk overlap > 0 (seller_notifications 3/3/9; offer_bidding 2/2/5; listing_revisions 3/3/8). Flags reset: `AI_RAG_SHADOW_ENTITY_HINTS=0`, `AI_RAG_SHADOW_NEIGHBOR_EXPANSION=0`.

### Structured endpoints

| Endpoint | HTTP | model_used | Summary |
|----------|-----:|------------|---------|
| seller_sales_summary | 200 | rule-engine | Seller activity across 10 grounded sources |
| buyer_collection_summary | **404** | — | curl 404 (pre-existing routing gap) |
| pricing_recommendation | 200 | rule-engine | Suggested price near $55.0 |
| record_valuation | 200 | rule-engine | Record located; insufficient comparables |
| auction_risk | 200 | rule-engine | 2 auction risk signal(s) |
| rag_query_smoke | 200 | rule-engine | Retrieved 8 grounded excerpts |

**5/6 non-empty**

## Model / provider evidence

| Path | Provider | Notes |
|------|----------|-------|
| Production RAG | **rule-engine** | Keyword retrieval; grounded excerpt summaries |
| Shadow diagnostics | **Ollama** (`nomic-embed-text`) | Embeddings when shadow_vector=1 |

## What changed vs pre–Tranche 6

| Area | Change |
|------|--------|
| Embedded count | +500 (6,565 → 7,065) |
| Coverage | +0.7 pp (9.0% → 9.7%) |
| OBO | Fully embedded (1,544); eligible pool **0** |
| Production RAG | **Unchanged** — keyword + rule-engine |
| Vector default | **Unchanged** — off |
| Rollout verdict | **Unchanged** — NOT APPROVED |

## Final verdict

```text
Vector rollout: NOT APPROVED
Production retrieval remains keyword
Phase 21 is not started
```

Next bounded step: **T20.12N** Tranche 7 dry-run (`t20-tranche-7`). Actual write requires **T20.12O** approval.
