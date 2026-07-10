# T20.10T — Shadow benchmark hardening

**Generated:** 2026-06-23  
**Baseline SHA:** `809eaac` (T20.10P latency diagnostics)  
**Mode:** script hardening only — no product behavior changes  
**Vector rollout:** NOT APPROVED

## Goal

Harden `scripts/rp-ai-shadow-real-query-timing.sh` so shadow latency runs produce stable, non-ambiguous benchmark summaries after T20.10P found run-to-run instability.

## Changes

| Area | Change |
|------|--------|
| Console summary | Single `console_summary` string with all phase p50/p95; uses `fmt_ms()` — no `undefined` |
| Summary validation | Exits **1** with clear error if required keys missing when `shadow_runs > 0` |
| Benchmark metadata | MD header: baseline SHA, warmup settings, query count, artifact paths |
| Latency contributors | Top-5 tables for `total_ms` and `candidate_fetch_ms` |
| Per-run table | Adds `embed_ms`, `cf_ms` columns; `n/a` for missing diagnostics |
| Missing diagnostics | Counts `shadow_diagnostics_missing` runs |

## Required summary keys (fail if absent)

```text
shadow_total_ms_p50 / p95
embed_ms_p50 / p95
candidate_fetch_ms_p50 / p95
rerank_select_ms_p50 / p95
```

## Validation

```bash
BENCH_REQUIRE_OLLAMA_WARM=1 BENCH_WARMUP_RUNS=1 bash scripts/rp-ai-shadow-real-query-timing.sh
bash scripts/rp-ai-shadow-source-diagnostic.sh
bash scripts/rp-och-decontaminate-scan.sh
```

## Definition of done

- [x] No `undefined` timing fields in console output
- [x] Markdown contains candidate_fetch and rerank_select p50/p95
- [x] Missing summary keys fail with clear message
- [x] Generated artifacts remain uncommitted
- [x] Vector rollout remains NOT APPROVED

## Files changed

- `scripts/rp-ai-shadow-real-query-timing.sh`
- `docs/ai-platform/T20-10T-shadow-benchmark-hardening.md`

## Next

**T20.10U** — pgvector candidate-fetch `EXPLAIN` diagnostics (read-only), using hardened benchmark output as input.
