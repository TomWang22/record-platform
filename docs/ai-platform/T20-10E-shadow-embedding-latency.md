# T20.10E — Shadow embedding latency stability / timeout diagnostics

**Status:** implemented (shadow-only)
**Depends on:** T20.10C (selection tuning), T20.10D (OBO corpus repair)
**Does not:** change keyword retrieval, enable vector default, start T20.9, or Phase 21

## Problem (post-T20.10C)

Live benchmark showed selection quality improved, but aggregate shadow p95 remained rollout-blocking:

| Metric | Post-T20.10C |
|--------|-------------:|
| Owner OBO selected `obo_offer_summary` | 6 |
| Owner OBO prompt total | 2399 ms |
| Candidate fetch p95 | 2007 ms |
| Aggregate shadow p95 | 10674 ms |
| Embed p95 | 8026 ms |
| Zero-overlap | 12/16 |

Conclusion: aggregate p95 is dominated by **embedding provider latency outliers** (Ollama variance / cold start), not OBO selection or candidate fetch.

## Changes (shadow-only)

### `config.py`

- `AI_RAG_SHADOW_EMBED_TIMEOUT_MS` (default **5000**)
- `AI_RAG_SHADOW_EMBED_HINT_MAX_CHARS` (default **512**)
- `AI_RAG_SHADOW_EMBED_CACHE_MAX` (default **64**)

### `shadow_profiles.py`

- `expand_query_with_hints()` caps expanded query length when profile hints inflate embed input
- Returns truncation flag for diagnostics

### `rag_retrieval.py`

- `ShadowEmbedDiagnostics` on `shadow_diagnostics.embed`:
  - provider, model, query_length, expanded_query_length
  - profile_hints_enabled, hint_terms_count, hint_expansion_truncated
  - timeout_ms, retry_count, cache_hit, latency_ms, timed_out, error, fallback_reason
- Shadow embed path uses bounded timeout; on timeout **fail closed for shadow only**:
  - keyword answer unchanged
  - status `embed_timed_out` with `embed_timed_out=true`
  - no vector chunks returned for that request
- In-process LRU cache for shadow query embeddings (same model + expanded query)

### `scripts/rp-ai-shadow-real-query-timing.sh`

- `BENCH_WARMUP_RUNS=1` default — one OBO owner warmup before measured runs
- Warmup rows marked `"warmup": true` and excluded from aggregates
- Summary includes embed p50/p95 and embed outlier table (>=5s or timeout)

Keyword path untouched.

## Validation

```bash
bash scripts/coverage/run-service-coverage.sh python-ai-service
node scripts/coverage/enforce-service-coverage.mjs
bash scripts/rp-ai-shadow-real-query-timing.sh
bash scripts/rp-rp-decontaminate-scan.sh
```

## Acceptance

- [x] Keyword path unchanged
- [x] Shadow diagnostics expose embed outlier attribution fields
- [x] Benchmark supports warmup + embed metrics
- [x] Shadow embed timeout fail-closed (no whole-request failure)
- [x] Coverage >=90% on `app/ai/*`

## Preserve (do not regress)

- Owner OBO selected `obo_offer_summary` >= 6
- Owner OBO prompt total under 3s
- Dominant selected source type = `obo_offer_summary` on OBO owner prompts

## T20.9 gate

**Wait.** T20.9 adds corpus volume; current blocker is embed latency variance, not OBO depth.
