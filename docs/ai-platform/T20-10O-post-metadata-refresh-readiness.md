# T20.10O — Post notification-metadata refresh readiness re-evaluation

**Generated:** 2026-06-23  
**Baseline SHA:** `2cdbf26` (T20.10N metadata-only refresh)  
**Mode:** read-only — no embeddings, no metadata writes, no vector default flip  
**Preceding work:** T20.9 Tranche 3 actual, T20.10J overlap audit, T20.10K entity aliases, T20.10L notification normalization, T20.10N contract-user metadata refresh

## Executive verdict

**Production vector default: NOT READY**

Keyword retrieval remains the correct production default. T20.10N improved notification entity metadata parity for the contract user without touching chunks or embeddings, but **embedded coverage**, **shadow–keyword overlap**, and **latency stability** still fail T20.3 rollout thresholds.

| Gate | Threshold | Current | Status |
|------|-----------|---------|--------|
| Embedded coverage | ≥15% non-message **or** ≥10k embedded | **7.62%** (5,565 / 73,043) | **FAIL** |
| Source diversity (shadow weighted) | ≥5 types across contract prompts | **6 types** | **PASS** |
| Owner-visible OBO (e2e-contract) | ≥10 embedded chunks | **18** | **PASS** |
| Shadow latency p95 (warmup=1) | ≤3,000 ms | **6,446 ms** | **FAIL** |
| Embed latency p95 (warmup=1) | ≤2,000 ms (stretch) | **5,493 ms** | **FAIL** |
| Embed outliers / timeouts | 0 in measured runs | **2 timeouts** | **FAIL** |
| Leakage (message/proxy/forbidden) | 0 | **0** | **PASS** |
| Keyword stability | unchanged summaries/refs | contract audits PASS | **PASS** |
| Shadow–keyword overlap | meaningful overlap | **12/16 zero-overlap** | **FAIL** |
| Tranche rerun guard | exit 2 on lock | unchanged (T20.7R / T20.9 lock) | **PASS** |

## Delta vs T20.10F (`e891edf`)

| Metric | T20.10F | T20.10O | Change |
|--------|--------:|--------:|--------|
| Embedded chunks | 5,065 | **5,565** | +500 (T20.9) |
| Embedded coverage | 6.93% | **7.62%** | +0.69 pp |
| Notification docs with entity metadata | 0 | **11,849** | +11,849 (T20.10N) |
| Contract user notification `listing_id` | 0 | **11,849** | +11,849 |
| Embedded notification chunks | 750 | **800** | +50 (T20.9; unchanged since) |
| e2e-contract owner OBO embedded | 18 | **18** | flat PASS |
| Real-query shadow p95 (warmup=1) | 1,831 ms | **6,446 ms** | **regressed** |
| Real-query embed p95 (warmup=1) | 954 ms | **5,493 ms** | **regressed** |
| Embed timeouts | 0 | **2** | **regressed** |
| Zero-overlap shadow runs | 12/16 | **12/16** | flat FAIL |
| doc-overlap >0 | n/a | **4/16** | — |
| entity-overlap >0 | n/a | **4/16** | — |

## Delta vs T20.9 post-tranche (`1f72c60` era)

| Metric | T20.9 post-tranche | T20.10O | Change |
|--------|-------------------:|--------:|--------|
| Embedded total | 5,565 | 5,565 | flat |
| Coverage | 7.62% | 7.62% | flat |
| Shadow p95 | 3,010 ms | **6,446 ms** | worse (Ollama variance) |
| Embed p95 | 1,887 ms | **5,493 ms** | worse |
| Zero-overlap | 12/16 | 12/16 | flat |

## Metadata refresh impact (T20.10N)

| Metric | Before T20.10N | After T20.10O eval |
|--------|-------------:|-------------------:|
| Global notification docs with entity metadata | 0 | **11,849** |
| Contract user docs with `listing_id` | 0 | **11,849** |
| Embedded notification chunks | 800 | **800** (unchanged) |
| Chunks/embeddings touched by refresh | — | **0** |

**Interpretation:** Metadata-only refresh succeeded for contract-user notifications (`owner_user_id` column — not stored in `metadata`). Entity-linking parity improved in corpus metadata but does not alone clear rollout gates. Remaining **43,602** notification docs (55,451 − 11,849) still lack entity metadata.

Prior T20.10N post-run benchmark showed notification query `entity_ov=3` on `shadow_obo_owner`. This T20.10O rerun hit **2 embed timeouts** including that notification query (`selected_count=0`, `total_ms=5656`) — latency instability dominates, not metadata regression.

## Corpus snapshot (read-only SQL, 2026-06-23)

| source_type | embedded | unembedded | total |
|-------------|--------:|-----------:|------:|
| notification | 800 | 54,651 | 55,451 |
| listing | 1,900 | 7,418 | 9,318 |
| listing_revision | 900 | 4,983 | 5,883 |
| obo_offer_summary | 1,118 | 426 | 1,544 |
| record | 594 | 0 | 594 |
| auction_bid_summary | 253 | 0 | 253 |
| **Total (non-message)** | **5,565** | **67,478** | **73,043** |

**Coverage:** 5,565 / 73,043 = **7.62%**

## T20.10O live benchmark (warmup=1, `BENCH_REQUIRE_OLLAMA_WARM=1`)

Artifacts:

- `bench_logs/ai-platform/t20-10-shadow-real-query-20260623-143601.jsonl`
- `bench_logs/ai-platform/t20-10-shadow-real-query-20260623-143601.md`

| Metric | Value |
|--------|------:|
| shadow p50 / p95 total ms | 1,522 / **6,446** |
| embed p50 / p95 ms | 8.5 / **5,493** |
| candidate_fetch p50 / p95 ms | 867 / **3,434** |
| owner OBO selected mix (`shadow_obo_owner`) | **6 OBO + 2 listing** |
| zero-overlap shadow runs | **12 / 16** |
| document-overlap >0 runs | **4 / 16** |
| entity-overlap >0 runs | **4 / 16** |
| insufficient metadata runs | **0** |
| embed outliers (≥5s / timeout) | **2** |
| zero-result shadow runs | **2 / 16** |

### Embed outliers

| Query | embed_ms | timed_out |
|-------|--------:|:---------:|
| What notifications matter most for my selling activity right now? | 5,430 | yes |
| Summarize my private seller-side negotiation context… | 5,681 | yes |

Warmup gate: 3 consecutive embeds ≤2000 ms after 4 failed cold attempts (Ollama cold-load variance).

## Shadow source diagnostic (T19.6C)

Artifact: `bench_logs/ai-platform/t19-6-route-shadow-quality.md`

| Metric | Value |
|--------|------:|
| RESULT | **PASS** (0 issues) |
| Latency p50/p95 ms (hinted) | 3,665 / **7,778** |
| OBO owner-visible embedded | **18** / 1,118 global OBO embedded |
| Weighted types | 6 (all shadow-allowed) |

## Safety SQL (read-only)

| Check | Count |
|-------|------:|
| embedded_total | 5,565 |
| notification_docs_with_entity_metadata | **11,849** |
| embedded_notification_chunks | **800** |
| contract_notification_docs_with_listing_id (`owner_user_id`) | **11,849** |
| wrong_dim (≠768) | **0** |
| message_embeddings | **0** |
| proxy_leaks (contract audit) | **0** |

## Validation bundle (all PASS on `2cdbf26`)

```text
BENCH_REQUIRE_OLLAMA_WARM=1 BENCH_WARMUP_RUNS=1 bash scripts/rp-ai-shadow-real-query-timing.sh
bash scripts/rp-ai-shadow-source-diagnostic.sh          # PASS
bash scripts/audit-rp-ai-rag-contract.sh                  # PASS
bash scripts/rp-ai-rag-quality-smoke.sh                 # PASS
bash scripts/audit-rp-ai-runtime-contract.sh              # PASS
bash scripts/audit-rp-ai-endpoints-contract.sh            # PASS
bash scripts/rp-ai-provider-readiness.sh                  # PASS
bash scripts/rp-ai-pgvector-readiness.sh                  # PASS
bash scripts/rp-och-decontaminate-scan.sh                 # PASS
```

## Product configuration (unchanged)

| Setting | Value |
|---------|-------|
| `AI_RAG_SHADOW_VECTOR` default | `0` (off) |
| Production retrieval | **keyword** |
| Vector path | shadow/diagnostic only |
| `EMBEDDING_BACKFILL_FORCE` | not used |
| Phase 21 | not started |

## Remaining blockers

1. **Coverage** — 7.62% embedded; need ≥15% or ≥10k embedded chunks.
2. **Overlap** — 12/16 zero chunk-overlap; complementary retrieval still dominates.
3. **Latency** — shadow p95 6.4s and 2 embed timeouts this run; Ollama cold/warm variance not production-stable.
4. **Metadata corpus gap** — 43,602 notification docs outside contract user still lack entity metadata (requires bounded dry-run before any further metadata-only refresh).

## Recommendation

- **Hold vector rollout** — verdict NOT READY.
- **Do not** enable vector default or start Phase 21.
- **Optional next work:** bounded metadata-only dry-run for additional test users; overlap/latency diagnostics only — no ranking changes, no new tranches without explicit approval.

**Vector rollout:** NOT APPROVED
