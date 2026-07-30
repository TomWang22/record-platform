# T20.12I — Post–Tranche 5 readiness and live inference eval

**Status:** READ-ONLY eval complete  
**Generated:** 2026-06-25  
**Baseline SHA:** `e2349ce`  
**Tranche:** `t20-tranche-5` (+500 embeddings, 6,065 → 6,565)

## Corpus snapshot

| Metric | Value |
|--------|------:|
| Embedded chunks | **6,565** |
| Non-message chunks | 73,043 |
| Coverage | **≈9.0%** |
| Rollout threshold | ≥15% or ≥10k embedded |
| Gap to 10k | +3,435 |
| Gap to 15% (~10,957) | +4,392 |

### Embedded by source_type

| source_type | embedded |
|-------------|--------:|
| listing | 2,300 |
| obo_offer_summary | 1,418 |
| listing_revision | 1,100 |
| notification | 900 |
| record | 594 |
| auction_bid_summary | 253 |

## Gate results (post–Tranche 5)

| Gate | Result | Notes |
|------|--------|-------|
| Embedded coverage | **FAIL** | 9.0% / 6,565 — improved from 8.3% / 6,065 but below rollout bar |
| Source diversity | **PASS** | 6 types in shadow diagnostic |
| Owner-visible OBO embedded | **PASS** | 18 / 1,418 total embedded OBO |
| Shadow p50/p95 (warm) | **PASS** | 681 / 1,100 ms (T20.10T 2026-06-25) |
| Embed p50/p95 | **PASS** | 3 / 5 ms; 0 timeouts on warm run |
| Default/off chunk overlap | **DIAGNOSTIC** | 1/7 cases with chunk overlap > 0 (transcript harness) |
| Flagged/on overlap | **DIAGNOSTIC** | 2/7 cases with chunk overlap > 0; flags reset 0/0 |
| Leakage | **PASS** | wrong_dim=0, message_embeddings=0, proxy_leaks=0; transcript PASS |
| Keyword stability | **PASS** | 7/7 keyword cases non-empty; RAG quality smoke PASS |
| Tranche rerun guard | **PASS** | Tranche 2–5 locks block (exit 2) |
| RAG contract | **PASS** | `audit-rp-ai-rag-contract.sh` |
| Quality smoke | **PASS** | `rp-ai-rag-quality-smoke.sh` |
| Runtime/endpoints | **PASS** | runtime + endpoints contract |
| Provider/pgvector | **PASS** | Ollama available; pgvector ready |
| RP | **PASS** | `rp-rp-decontaminate-scan.sh` |

### Shadow source diagnostic (T19.6C)

**RESULT: PASS (0 issues)**

- Unweighted types: auction_bid_summary, listing, listing_revision, notification, obo_offer_summary
- Weighted/hinted types: + record (6 total)
- OBO owner-visible: 18 / 1,418 total embedded OBO

## Timing benchmark (warm, flags off)

Artifact (local): `bench_logs/ai-platform/t20-10-shadow-real-query-20260625-172107.md`

| Metric | Value |
|--------|------:|
| shadow p50/p95 ms | 681 / 1,100 |
| embed p50/p95 ms | 3 / 5 |
| candidate_fetch p50/p95 ms | 451 / 799 |
| embed timeouts | 0 |
| zero-overlap shadow runs | 11/16 |

## Live inference transcript (T20.12H harness)

Artifact (local): `bench_logs/ai-platform/live-inference/20260625-172442.md`  
Raw JSON: `bench_logs/ai-platform/live-inference/raw-20260625-172442/`

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

Answers are rule-engine grounded excerpts (e.g. “Retrieved 8 grounded excerpts for your question.”) with OBO/listing/revision excerpts — no message bodies.

### Shadow flags-off (7 prompts)

6/7 ok; **catalog_activity** hit `embed_timeout` (cold first case). Remaining cases returned shadow types including listing, notification, obo_offer_summary, listing_revision. Default overlap: **1/7** cases with chunk overlap > 0.

### Shadow flags-on (7 prompts)

Overlap flags temporarily set to 1/1; **2/7** cases with chunk overlap > 0 (seller_notifications 3/3/9 entity; offer_bidding 2/2/5). Flags reset confirmed: `AI_RAG_SHADOW_ENTITY_HINTS=0`, `AI_RAG_SHADOW_NEIGHBOR_EXPANSION=0`.

### Structured endpoints

| Endpoint | HTTP | model_used | Summary |
|----------|-----:|------------|---------|
| seller_sales_summary | 200 | rule-engine | Seller activity across 10 grounded sources |
| buyer_collection_summary | **404** | — | curl 404 (endpoint unavailable for contract user) |
| pricing_recommendation | 200 | rule-engine | Suggested price near $55.0 |
| record_valuation | 200 | rule-engine | Record located; insufficient comparables |
| auction_risk | 200 | rule-engine | 2 auction risk signal(s) |
| rag_query_smoke | 200 | rule-engine | Retrieved 8 grounded excerpts |

**5/6 non-empty** — buyer_collection_summary 404 is a routing/data gap, not a tranche regression.

## Model / provider evidence

| Path | Provider | Notes |
|------|----------|-------|
| Production RAG | **rule-engine** | Keyword retrieval; grounded excerpt summaries |
| Shadow diagnostics | **Ollama** (`nomic-embed-text`) | Embeddings when shadow_vector=1 |
| Generative prose | Not used for production RAG answers | Confirmed via `model_used=rule-engine` on all keyword cases |

## What changed vs pre–Tranche 5

| Area | Change |
|------|--------|
| Embedded count | +500 (6,065 → 6,565) |
| Coverage | +0.7 pp (8.3% → 9.0%) |
| Production RAG | **Unchanged** — keyword + rule-engine |
| Vector default | **Unchanged** — off |
| Rollout verdict | **Unchanged** — NOT APPROVED |

Tranche 5 improved corpus coverage incrementally. Warm shadow timing improved vs prior cold runs. Production answer generation unchanged.

## Final verdict

```text
Vector rollout: NOT APPROVED
Production retrieval remains keyword
Phase 21 is not started
```

Next bounded step: **T20.12J** Tranche 6 dry-run plan (`t20-tranche-6`). Actual write requires separate **T20.12K** approval.
