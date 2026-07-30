# T20.12Q — Post–Tranche 7 readiness and live inference eval

**Status:** READ-ONLY eval complete  
**Generated:** 2026-06-25  
**Tranche:** `t20-tranche-7` (+500 embeddings, 7,065 → 7,565; post-OBO caps)

## Corpus snapshot

| Metric | Value |
|--------|------:|
| Embedded chunks | **7,565** |
| Non-message chunks | 73,043 |
| Coverage | **≈10.4%** |
| Rollout threshold | ≥15% or ≥10k embedded |
| Gap to 10k | +2,435 |
| Gap to 15% (~10,957) | +3,392 |
| OBO eligible pool | **0** (exhausted) |

### Embedded by source_type

| source_type | embedded | delta (Tranche 7) |
|-------------|--------:|-------------------:|
| listing | 2,774 | +250 |
| listing_revision | 1,350 | +150 |
| notification | 1,050 | +100 |
| obo_offer_summary | 1,544 | 0 |
| record | 594 | 0 |
| auction_bid_summary | 253 | 0 |

## Gate results (post–Tranche 7)

| Gate | Result | Notes |
|------|--------|-------|
| Embedded coverage | **FAIL** | 10.4% / 7,565 — below 10k and 15% bars |
| Source diversity | **PASS** | 6 types in shadow diagnostic |
| Owner-visible OBO embedded | **PASS** | 18 / 1,544 total embedded OBO |
| Shadow p50/p95 (warm) | **CONDITIONAL** | 943 / 3,425 ms (T20.10T 20260625-200731) |
| Embed p50/p95 | **PASS** | 7 / 1,648 ms; 0 timeouts on eval run |
| Default/off chunk overlap | **DIAGNOSTIC** | 1/7 cases with chunk overlap > 0 (transcript) |
| Flagged/on overlap | **DIAGNOSTIC** | 3/7 cases with chunk overlap > 0; flags reset 0/0 |
| Leakage | **PASS** | wrong_dim=0, message_embeddings=0, proxy_leaks=0; transcript PASS |
| Keyword stability | **PASS** | 7/7 keyword cases non-empty; RAG quality smoke PASS |
| Tranche rerun guard | **PASS** | Tranche 2–7 locks block (exit 2) |
| RAG contract | **PASS** | `audit-rp-ai-rag-contract.sh` |
| Quality smoke | **PASS** | `rp-ai-rag-quality-smoke.sh` |
| Runtime/endpoints | **PASS** | runtime + endpoints contract |
| Provider/pgvector | **PASS** | Ollama available; pgvector ready |
| RP | **PASS** | `rp-rp-decontaminate-scan.sh` |

### Shadow source diagnostic (T19.6C)

**RESULT: PASS (0 issues)** — 6 types; OBO owner-visible 18 / 1,544.

## Timing benchmark (warm, flags off)

Artifact (local): `bench_logs/ai-platform/t20-10-shadow-real-query-20260625-200731.md`

| Metric | Value |
|--------|------:|
| shadow p50/p95 ms | 943 / 3,425 |
| embed p50/p95 ms | 7 / 1,648 |
| candidate_fetch p50/p95 ms | 505 / 1,428 |
| embed timeouts | 0 |
| zero-overlap shadow runs | 11/16 |

## Live inference transcript (T20.12H harness)

Artifact (local): `bench_logs/ai-platform/live-inference/20260625-200732.md`

### Production keyword (7 prompts)

All HTTP 200, `retrieval_mode=keyword`, `model_used=rule-engine`, leakage PASS.

### Shadow flags-off / flags-on

7/7 shadow-off ok. Default overlap 1/7; flagged 3/7. Flags reset 0/0.

### Structured endpoints

5/6 non-empty — `buyer_collection_summary` HTTP 404 (pre-existing routing gap).

## Model / provider evidence

| Path | Provider |
|------|----------|
| Production RAG | **rule-engine** (keyword) |
| Shadow diagnostics | **Ollama** (`nomic-embed-text`) |

## What changed vs pre–Tranche 7

| Area | Change |
|------|--------|
| Embedded count | +500 (7,065 → 7,565) |
| Coverage | +0.7 pp (9.7% → 10.4%) |
| Production RAG | **Unchanged** — keyword + rule-engine |
| Rollout verdict | **Unchanged** — NOT APPROVED |

## Final verdict

```text
Vector rollout: NOT APPROVED
Production retrieval remains keyword
Phase 21 is not started
```

Next bounded step: **T20.12R** Tranche 8 dry-run (`t20-tranche-8`). Actual write requires **T20.12S** approval.
