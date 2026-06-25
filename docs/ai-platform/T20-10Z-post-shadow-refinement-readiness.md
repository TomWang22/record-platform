# T20.10Z — Post shadow-refinement readiness re-evaluation

**Generated:** 2026-06-25  
**Baseline SHA:** `31d300f` (T20.10Y implementation SHA doc fix)  
**Mode:** read-only — no embeddings, no metadata writes, no vector default flip  
**Preceding work:** T20.10W shadow fetch strategy, T20.10X diversity diagnostics, T20.10Y diversity top-ups

## Executive verdict

**Production vector default: NOT APPROVED**

Keyword retrieval remains the correct production default (`AI_RAG_SHADOW_VECTOR=0`). T20.10W/T20.10Y materially improved shadow fetch latency and **restored source diversity to 6 types**. The T20.10Z canonical benchmark run clears **shadow p95**, **embed p95**, and **embed timeout** gates — but **embedded coverage** and **shadow–keyword overlap** still fail T20.3 rollout thresholds. Latency remains **run-to-run unstable** (prior T20.10Y runs failed embed/shadow p95); a single passing run does not justify rollout.

| Gate | Threshold | Current (T20.10Z) | Status |
|------|-----------|-------------------|--------|
| Embedded coverage | ≥15% non-message **or** ≥10k embedded | **7.62%** (5,565 / 73,043) | **FAIL** |
| Source diversity (shadow weighted+hints) | ≥5 types across contract prompts | **6 types** | **PASS** |
| Owner-visible OBO (e2e-contract) | ≥10 embedded chunks | **18** | **PASS** |
| Shadow latency p95 (warmup=1) | ≤3,000 ms | **2,839 ms** | **PASS**† |
| Embed latency p95 (warmup=1) | ≤2,000 ms (stretch) | **950 ms** | **PASS**† |
| Embed outliers / timeouts | 0 in measured runs | **0** | **PASS**† |
| Leakage (message/proxy/forbidden) | 0 | **0** | **PASS** |
| Keyword stability | unchanged summaries/refs | contract + source diag PASS | **PASS** |
| Shadow–keyword overlap | meaningful overlap | **11/16 zero-overlap** | **FAIL** |
| Tranche rerun guard | exit 2 on lock | T20.7R smoke PASS | **PASS** |

† T20.10Z canonical run (`215017`). Prior T20.10O/T20.10Y runs on same corpus failed these gates — treat latency as **conditionally passing**, not stable.

## Delta vs T20.10O (`2cdbf26` era)

| Metric | T20.10O | T20.10Z | Change |
|--------|--------:|--------:|--------|
| Embedded chunks | 5,565 | 5,565 | flat |
| Embedded coverage | 7.62% | 7.62% | flat **FAIL** |
| Source diversity (hinted union) | 6 | **6** | flat **PASS** |
| Owner OBO embedded (contract) | 18 | 18 | flat **PASS** |
| Real-query shadow p95 | 6,446 ms | **2,839 ms** | improved **PASS**† |
| Real-query embed p95 | 5,493 ms | **950 ms** | improved **PASS**† |
| candidate_fetch p95 | 3,434 ms | **1,478 ms** | improved |
| Embed timeouts | 2 | **0** | improved **PASS**† |
| Zero-overlap shadow runs | 12/16 | **11/16** | slight improvement, still **FAIL** |
| doc-overlap >0 runs | 4/16 | **5/16** | +1 |
| entity-overlap >0 runs | 4/16 | **5/16** | +1 |
| zero-result shadow runs | 2/16 | **0/16** | improved |

## Delta vs T20.10W (`b7e17b6` / `c838cda`)

| Metric | T20.10W (best run) | T20.10Z | Change |
|--------|-------------------:|--------:|--------|
| Source diversity | **4 — FAIL** | **6 — PASS** | restored (T20.10Y) |
| candidate_fetch p95 | 801.8 ms | 1,478 ms | +84% (diversity top-up cost) |
| shadow p95 | 3,095 ms | 2,839 ms | improved |
| Missing types | listing_revision, notification | none | fixed |

## Delta vs T20.10Y (`3e2a80f` bad-variance run)

| Metric | T20.10Y run `214301` | T20.10Z | Change |
|--------|---------------------:|--------:|--------|
| shadow p95 | 7,240 ms | **2,839 ms** | improved |
| embed p95 | 5,424 ms | **950 ms** | improved |
| embed timeouts | 1 | **0** | improved |
| candidate_fetch p95 | 3,099 ms | **1,478 ms** | improved |
| Source diversity | 6 PASS | 6 PASS | flat |

**Interpretation:** T20.10Y diversity restoration is stable; latency variance is infrastructure (Ollama cold/warm), not a regression from top-ups alone.

## Corpus snapshot (read-only SQL, 2026-06-25)

| source_type | embedded | unembedded | total chunks |
|-------------|--------:|-----------:|-------------:|
| listing | 1,900 | 7,418 | 9,318 |
| obo_offer_summary | 1,118 | 426 | 1,544 |
| listing_revision | 900 | 4,983 | 5,883 |
| notification | 800 | 54,651 | 55,451 |
| record | 594 | 0 | 594 |
| auction_bid_summary | 253 | 0 | 253 |
| **Total (non-message)** | **5,565** | **67,478** | **73,043** |

**Coverage:** 5,565 / 73,043 = **7.62%**

### Safety SQL

| Check | Count |
|-------|------:|
| wrong_dim (≠768) | 0 |
| message_embeddings | 0 |
| proxy/forbidden in embedded content | 0 |
| owner-visible OBO embedded (contract user) | 18 |

## T20.10Z live benchmark (warmup=1, `BENCH_REQUIRE_OLLAMA_WARM=1`)

Artifacts (local, not committed):

- `bench_logs/ai-platform/t20-10-shadow-real-query-20260624-215017.jsonl`
- `bench_logs/ai-platform/t20-10-shadow-real-query-20260624-215017.md`

| Metric | Value |
|--------|------:|
| shadow p50 / p95 total ms | 771.5 / **2,839** |
| embed p50 / p95 ms | 3.0 / **950** |
| candidate_fetch p50 / p95 ms | 537 / **1,478** |
| rerank_select p50 / p95 ms | 9 / 18.5 |
| zero-overlap shadow runs | **11 / 16** |
| document-overlap >0 runs | **5 / 16** |
| entity-overlap >0 runs | **5 / 16** |
| embed outliers / timeouts | **0** |
| zero-result shadow runs | **0 / 16** |

### Zero-overlap reasons (chunk overlap=0)

| Reason | Count |
|--------|------:|
| same_source_type_different_chunks | 10 |
| source_type_mismatch | 1 |

### Top candidate_fetch contributors (embed cache hit)

| Query theme | cf_ms |
|-------------|------:|
| Notifications | 1,478 (p95 aggregate) |
| Listing revisions | ~1,118 (top total_ms row) |

Fetch cost remains below T20.10O p95 (3,434 ms) despite T20.10Y diversity top-ups.

## Source diversity (T19.6C diagnostic)

Artifact: `bench_logs/ai-platform/t19-6-route-shadow-quality.md`

| Metric | Value |
|--------|-------|
| RESULT | **PASS** (0 issues) |
| Hinted union types | auction_bid_summary, listing, listing_revision, notification, obo_offer_summary, record (**6**) |
| OBO owner-visible | 18 / 1,118 total embedded OBO |
| Hinted latency p50/p95 | 4,453 / 10,856 ms (diagnostic prompts; embed variance) |
| Hinted fetch p95 | 3,367 ms |

Keyword stability: all 7 contract prompts unchanged (retrieval_mode=keyword, summary unchanged).

## Validation bundle

| Script | Result |
|--------|--------|
| `rp-ai-shadow-real-query-timing.sh` | PASS harness (metrics above) |
| `rp-ai-shadow-source-diagnostic.sh` | **PASS** — 6 types |
| `audit-rp-ai-rag-contract.sh` | **PASS** |
| `rp-ai-rag-quality-smoke.sh` | **PASS** |
| `audit-rp-ai-runtime-contract.sh` | **PASS** |
| `audit-rp-ai-endpoints-contract.sh` | **PASS** |
| `rp-ai-provider-readiness.sh` | **PASS** |
| `rp-ai-pgvector-readiness.sh` | **PASS** |
| `rp-ai-backfill-rerun-guard-smoke.sh` | **PASS** (blocked rerun exit 2) |
| `rp-och-decontaminate-scan.sh` | **PASS** (588 files) |

## Remaining blockers

1. **Embedded coverage** — 7.62% vs ≥15% or ≥10k embedded; requires approved embedding tranche work (T20.12+), not shadow fetch tuning.
2. **Shadow–keyword overlap** — 11/16 zero chunk-overlap; diversity restoration alone did not fix parity. Recommend **T20.10AA** overlap deep dive.
3. **Latency stability** — single T20.10Z run passes p95 gates; T20.10O/T20.10Y runs failed on same corpus/config. Ollama embed variance remains a production risk for vector default.
4. **No ANN index** — candidate_fetch still exact-sort bound at scale (T20.10U); separate ops-approved ticket if pursued.

Restored source diversity **does not** justify vector rollout while coverage and overlap fail.

## Recommended next ticket

**T20.10AA** — Shadow/keyword overlap deep dive (read-only), if overlap gate remains failing after T20.10Z.

Do **not** proceed to T20.14/T20.15 vector rollout or T20.12 embedding tranches without explicit approval.

## Definition of done (T20.10Z)

- [x] Readiness verdict documented
- [x] No code changed
- [x] No generated artifacts committed
- [x] All validation results recorded
- [x] Vector rollout remains NOT APPROVED

**Vector rollout: NOT APPROVED**
