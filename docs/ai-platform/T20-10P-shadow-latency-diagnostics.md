# T20.10P — Shadow latency diagnostics (read-only)

**Generated:** 2026-06-23  
**Baseline SHA:** `387bdc7` (T20.10O readiness eval)  
**Mode:** read-only diagnostics — no product behavior changes  
**Vector rollout:** NOT APPROVED

## Executive summary

T20.10O latency regression vs T20.10F is **not caused by T20.10N metadata refresh** or retrieval ranking changes. The dominant factor is **Ollama embed instability** (cold-load variance + 5s timeout hits), with a secondary contributor of **candidate_fetch p95 variance** on pgvector queries. Rerank/select remains negligible (&lt;60 ms p95).

| Category | Verdict |
|----------|---------|
| Ollama cold/warm variance | **Primary blocker** |
| Embed timeout (5s cap) | **2/16 shadow runs in T20.10O** |
| Candidate fetch variance | **Secondary** (p95 898 → 3,434 ms across runs) |
| Rerank/select | **Not a blocker** (p95 ≤59 ms) |
| Metadata refresh (T20.10N) | **Not causal** (metadata-only; no code path change) |
| Route/profile selection | **Amplifies embed cost** on `obo_helper` (11 hint terms) |

## Run comparison (warmup=1, `BENCH_REQUIRE_OLLAMA_WARM=1`)

| Run | Artifact | shadow p50/p95 | embed p50/p95 | candidate_fetch p50/p95 | timeouts | zero-overlap |
|-----|----------|---------------:|--------------:|----------------------:|---------:|-------------:|
| T20.10F | `t20-10-shadow-real-query-20260622-174423` | 873 / **2,248** | 372 / **1,126** | 170 / 898 | 0 | 12/16 |
| T20.10N post | `t20-10-shadow-real-query-20260623-134712` | 2,416 / **4,757** | 1,251 / **3,697** | 894 / 1,451 | 0 | 11/16 |
| T20.10O | `t20-10-shadow-real-query-20260623-143601` | 1,433 / **7,422** | 0 / **5,000**† | 867 / **3,434** | **2** | 12/16 |

† embed p95 capped at 5,000 ms timeout floor for timed-out runs.

**Interpretation:** Shadow p95 swung **2.2s → 4.8s → 7.4s** across three warmup-gated runs on the same corpus/config. Overlap (12/16 zero) stayed flat — latency regression is infrastructure variance, not retrieval-quality regression.

## Warmup gate evidence (T20.10O run)

From `rp-ai-ollama-embed-warmup.sh` before T20.10O benchmark:

```text
warmup_attempt=1..3: TimeoutError ~25s (cold Ollama)
warmup_attempt=4: ok 7047 ms (still over 2000 ms target)
warmup_attempt=5..7: ok 1059 / 371 / 182 ms → WARMUP_PASS
```

Even after gate pass, measured shadow runs still hit **2 embed timeouts** — warmup does not guarantee all subsequent per-query embeds stay hot under `OLLAMA_NUM_PARALLEL=1` + multi-worker load.

## Outlier classification (T20.10O artifact)

| Query | mode | profile | total_ms | embed_ms | candidate_fetch_ms | timed_out | cache_hit | selected | Root cause |
|-------|------|---------|--------:|---------:|-------------------:|:---------:|:---------:|---------:|------------|
| Notifications matter most… | shadow_obo_owner | obo_helper | 5,656 | 5,430 | 0 | **yes** | no | 0 | **embed_timeout** (11 hint terms, expanded query) |
| Private negotiation context… | shadow_default | — | 6,121 | 5,681 | 0 | **yes** | no | 0 | **embed_timeout** |
| Private negotiation context… | shadow_obo_owner | obo_helper | 7,422 | 4,861 | 1,427 | no | no | 8 | **embed_slow + fetch** |
| Listing revisions / offer conversion… | shadow_default | — | 4,140 | 10 | 3,434 | no | **yes** | 8 | **candidate_fetch_slow** (embed cached) |

### Outlier reason codes

| Code | Count (T20.10O) | Description |
|------|----------------:|-------------|
| `embed_timeout` | 2 | Hit 5s embed cap; zero shadow results |
| `embed_slow` | 1 | &gt;4s embed, no timeout |
| `candidate_fetch_slow` | 1 | embed cache hit; pgvector fetch dominates |
| `normal` | 12 | Within typical range |

## Phase attribution (aggregate T20.10O, non-warmup shadow runs)

| Phase | p50 ms | p95 ms | Share of total p95 |
|-------|-------:|-------:|-------------------:|
| embed | 8.5 | 5,493 | **~74%** (timeout-skewed) |
| candidate_fetch | 867 | 3,434 | **~46%** (on non-timeout runs) |
| rerank_select | 4 | 59 | &lt;1% |
| total | 1,522 | 6,446 | — |

On **non-timeout** runs, candidate_fetch is often the largest stable phase when embed cache hits.

## Profile / hint impact

`shadow_obo_owner` + `obo_helper` adds **11 query hints** → expanded query length ~163–170 chars vs ~79 for default shadow. Timeout outliers correlate with:

- `cache_hit=false`
- `hint_terms_count=11`
- `profile=obo_helper`

This is expected shadow-only cost amplification, not a keyword-path change.

## What did NOT cause regression

| Hypothesis | Evidence against |
|------------|------------------|
| T20.10N metadata refresh | Metadata-only UPDATE; no chunk/embed/text changes; latency regressed on runs before and after refresh |
| Ranking / keyword changes | No commits to `rag_retrieval.py` ranking between T20.10F and T20.10O |
| Coverage/tranche change | Embedded count flat at 5,565 since T20.9 |
| Leakage filter slowdown | `privacy_filter` ms ≈ 0 in diagnostics |

## Script instrumentation (T20.10P)

`scripts/rp-ai-shadow-real-query-timing.sh` now reports in summary MD and console:

- `candidate_fetch` p50/p95
- `rerank_select` p50/p95
- existing embed/shadow aggregates and outlier table

No retrieval logic changed.

## Recommended next steps (no implementation in T20.10P)

1. **T20.10T** — benchmark hardening (stable console fields, schema checks).
2. **T20.10U** — pgvector `EXPLAIN` on slow candidate_fetch queries (read-only).
3. **Do not** raise embed timeout or change ranking without explicit approval.
4. **Do not** treat single-run p95 as rollout gate pass/fail — require consecutive stable runs.

## Validation

```bash
BENCH_REQUIRE_OLLAMA_WARM=1 BENCH_WARMUP_RUNS=1 bash scripts/rp-ai-shadow-real-query-timing.sh
bash scripts/rp-ai-shadow-source-diagnostic.sh   # PASS, 0 issues
bash scripts/rp-och-decontaminate-scan.sh        # PASS
```

## Artifacts referenced (not committed)

- `bench_logs/ai-platform/t20-10-shadow-real-query-20260622-174423.{jsonl,md}`
- `bench_logs/ai-platform/t20-10-shadow-real-query-20260623-134712.{jsonl,md}`
- `bench_logs/ai-platform/t20-10-shadow-real-query-20260623-143601.{jsonl,md}`
- `bench_logs/ai-platform/t19-6-route-shadow-quality.md`

## Verdict

Latency regression is **categorized**. Primary blocker remains **Ollama embed instability**; secondary **candidate_fetch variance**. No product behavior changes in this ticket.

**Vector rollout:** NOT APPROVED
