# T20.10F — Post-hardening vector readiness re-evaluation (read-only)

**Generated:** 2026-06-22
**Baseline SHA:** `e891edf4bd2ef64cf8f5e1ef4d572712a6620c91`
**Mode:** read-only — no embeddings, no product behavior changes, no vector default flip
**Preceding hardening:** T20.10C (selection), T20.10D (OBO corpus repair), T20.10E (embed latency diagnostics)

## Executive verdict

**Production vector default: NOT READY**

Keyword retrieval remains the correct production default. Latency and OBO owner-visible gates improved materially after T20.10C–E, but **embedded coverage** and **shadow–keyword overlap** still fail T20.3 rollout thresholds.

| Gate | Threshold | Current | Status |
|------|-----------|---------|--------|
| Embedded coverage | ≥15% non-message **or** ≥10k embedded | **6.9%** (5,065 / 73,043) | **FAIL** |
| Source diversity (shadow weighted) | ≥5 types across contract prompts | **6 types** | **PASS** |
| Owner-visible OBO (e2e-contract) | ≥10 embedded chunks | **18** | **PASS** |
| Shadow latency p95 (warmup=1) | ≤3,000 ms | **1,831 ms** | **PASS** |
| Shadow latency p95 (warmup=0) | ≤3,000 ms | **2,523 ms** (prior run) | **PASS** |
| Embed latency p95 (warmup=1) | ≤2,000 ms (stretch) | **954 ms** | **PASS** |
| Embed outliers (≥5s / timeout) | 0 in measured runs | **0** | **PASS** |
| Leakage (message/proxy/forbidden) | 0 | **0** | **PASS** |
| Keyword stability | unchanged summaries/refs | contract audits PASS | **PASS** |
| Shadow–keyword overlap | meaningful overlap | **12/16 zero-overlap** | **FAIL** |
| Coverage gate (python-ai) | ≥90% `app/ai/*` | **91.53%** | **PASS** |
| Tranche rerun guard | exit 2 on lock | unchanged (T20.7R) | **PASS** |

## Delta vs T20.8 (`8633149`)

| Metric | T20.8 | T20.10F | Change |
|--------|------:|--------:|--------|
| Embedded chunks | 5,049 | 5,065 | +16 |
| Embedded coverage | 6.9% | 6.9% | flat |
| e2e-contract owner OBO embedded | 2 | **18** | **+16 PASS** |
| Shadow p95 (hinted diagnostic) | ~7,091 ms | ~1,438 ms (T19.6C rerun) | **~5× better PASS** |
| Real-query shadow p95 (warmup=1) | n/a | **1,831 ms** | **PASS** |
| Zero-overlap shadow runs | 0 overlap/prompt | **12/16** | still **FAIL** |

## Corpus snapshot (read-only SQL, 2026-06-22)

| source_type | embedded | unembedded | total |
|-------------|--------:|-----------:|------:|
| notification | 750 | 54,701 | 55,451 |
| listing | 1,700 | 7,618 | 9,318 |
| listing_revision | 800 | 5,083 | 5,883 |
| obo_offer_summary | 968 | 576 | 1,544 |
| record | 594 | 0 | 594 |
| auction_bid_summary | 253 | 0 | 253 |
| **Total (non-message)** | **5,065** | **67,978** | **73,043** |

**Coverage:** 5,065 / 73,043 = **6.93%**

## T20.10E live benchmark (warmup=1, canonical harness)

Artifact: `bench_logs/ai-platform/t20-10-shadow-real-query-20260622-174423.{jsonl,md}`

| Metric | Value |
|--------|------:|
| shadow p50 / p95 total ms | 907 / **1,831** |
| embed p50 / p95 ms | 394 / **954** |
| candidate_fetch p50 / p95 ms | 200 / 850 |
| owner OBO selected `obo_offer_summary` | **6** (all 8 OBO runs) |
| owner OBO prompt selected mix | **6 OBO + 2 listing** |
| owner OBO prompt total ms | **1,692** |
| zero-overlap shadow runs | **12 / 16** |
| embed outliers | **0** |

Prior comparison run (same day, warmup=0): shadow p95 **2,523 ms**, embed p95 **1,406 ms** — still under 3s SLO.

## Shadow quality diagnostic (T19.6C rerun)

Artifact: `bench_logs/ai-platform/t19-6-route-shadow-quality.md`

- **RESULT:** PASS (0 issues)
- **Unweighted types:** auction_bid_summary, listing, listing_revision
- **Weighted / hinted types:** all 6 shadow-allowed types
- **Latency p50/p95 ms (hinted):** 1,215 / **1,438**
- **OBO owner-visible (e2e-contract):** **18** / 968 embedded OBO globally

## Safety SQL (read-only)

| Check | Count |
|-------|------:|
| wrong_dim (≠768) | 0 |
| message_embeddings | 0 |
| proxy/forbidden in embedded content | 0 |

## Validation bundle (all PASS on `e891edf`)

```text
bash scripts/rp-ai-shadow-real-query-timing.sh          # BENCH_WARMUP_RUNS=1
bash scripts/rp-ai-shadow-source-diagnostic.sh
bash scripts/audit-rp-ai-rag-contract.sh
bash scripts/rp-ai-rag-quality-smoke.sh
bash scripts/audit-rp-ai-runtime-contract.sh
bash scripts/audit-rp-ai-endpoints-contract.sh
bash scripts/rp-ai-provider-readiness.sh
bash scripts/rp-ai-pgvector-readiness.sh
bash scripts/coverage/run-service-coverage.sh python-ai-service  # 109 passed, 91.53%
node scripts/coverage/enforce-service-coverage.mjs
bash scripts/rp-och-decontaminate-scan.sh
```

## Product configuration (unchanged)

| Setting | Value |
|---------|-------|
| `AI_RAG_SHADOW_VECTOR` default | `0` (off) |
| Production retrieval | **keyword** |
| Vector path | shadow/diagnostic only |
| `EMBEDDING_BACKFILL_FORCE` | not used |

## Gate summary

| Gate | Verdict |
|------|---------|
| Coverage (embedded %) | **FAIL** |
| OBO owner-visible | **PASS** |
| Latency (shadow + embed) | **PASS** |
| Leakage | **PASS** |
| Keyword stability | **PASS** |
| Overlap / quality parity | **FAIL** |

## Recommended next steps (do not auto-start)

| Priority | Ticket | Scope |
|----------|--------|-------|
| 1 | **Hold** | Do **not** enable vector default |
| 2 | Discuss | **T20.9** bounded Tranche 3 for coverage growth (backup + dry-run + caps) |
| 3 | Discuss | **T20.10G** ranking/overlap alignment for quality parity |
| 4 | Future | Production vector rollout only after **all** T20.3 thresholds pass |

**Do not:** Phase 21, Tranche 2 rerun, `EMBEDDING_BACKFILL_FORCE=1`, vector default flip.

## References

- T20.8 prior eval: `docs/ai-platform/T20-8-vector-rollout-readiness.md`
- T20.10C: `docs/ai-platform/T20-10C-shadow-profile-narrowing.md`
- T20.10E: `docs/ai-platform/T20-10E-shadow-embedding-latency.md`
- Copilot context: `docs/ai-platform/PHASE_20_COPILOT_CONTEXT.md`
- T20.9 dry-run plan: `docs/ai-platform/T20-9-tranche3-dry-run-plan.md`

**RESULT: T20.10F evaluation complete — vector rollout NOT APPROVED**
