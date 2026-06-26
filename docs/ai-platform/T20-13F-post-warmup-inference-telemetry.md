# T20.13F — Post-warmup real inference telemetry

**Status:** READ-ONLY report from T20.13E warmed harness run  
**Generated:** 2026-06-26  
**Harness baseline SHA:** `bd2b607` (pre-commit); implementation in T20.13E commit

## Artifacts (local, not committed)

| Artifact | Path |
|----------|------|
| Report MD | `bench_logs/ai-platform/live-inference/20260626-174112.md` |
| Summary JSON | `bench_logs/ai-platform/live-inference/20260626-174112.summary.json` |
| Raw JSON dir | `bench_logs/ai-platform/live-inference/raw-20260626-174112/` |

**Harness invocation:**

```bash
bash scripts/rp-ai-live-inference-transcript.sh \
  --embed-warmup-runs 3 \
  --embed-warmup-threshold-ms 2000 \
  --embed-retry-on-timeout 1
```

## Warmup result

| Field | Value |
|-------|------:|
| embed_warmup_enabled | true |
| embed_warmup_passed | **true** |
| runs requested / passed | 3 / 3 |
| threshold_ms | 2000 |
| warmup p50 / p95 ms | 545 / 17,262 |
| embed_retry_on_timeout | 1 |
| embed_retry_attempted / succeeded | 0 / 0 |

Warmup gate **passed** before shadow diagnostics. No per-case embed retries were needed.

## Production keyword

| Metric | Value |
|--------|------:|
| cases | 7 |
| non-empty | **7/7** |
| model_used | rule-engine |
| source_types | listing, listing_revision, obo_offer_summary |
| latency p50 / p95 ms | 1,204 / 1,824 |
| leakage | **PASS** |

Production keyword inference remains **healthy**.

## Shadow flags off

| Metric | T20.13D (no warmup) | T20.13F (warmed) |
|--------|--------------------:|-----------------:|
| request_errors | 0 | **0** |
| embed_timeout_before_fetch | **7/7** | **0/7** |
| true zero-results | 0 | **0** |
| shadow_fetch_attempted | **0/7** | **7/7** |
| chunk/doc/entity overlap >0 | 0/0/0 | **1/1/1** |
| shadow p50 / p95 ms | n/a (embed-blocked) | **1,911 / 3,744** |
| candidate_fetch p50 / p95 ms | 0 (skipped) | **1,111 / 1,733** |

All 7 shadow cases completed with `selected_count=8`, embed ok, and candidate fetch executed.

## Shadow flags on (overlap diagnostics)

| Metric | T20.13D | T20.13F |
|--------|--------:|--------:|
| request_errors | 0 | **0** |
| embed_timeout_before_fetch | **7/7** | **0/7** |
| true zero-results | 0 | **0** |
| shadow_fetch_attempted | **0/7** | **7/7** |
| chunk/doc/entity overlap >0 | 0/0/0 | **3/3/3** |
| entity_boosted rows >0 | 0 | **4** |
| neighbor rows added >0 | 0 | 0 |
| shadow p50 / p95 ms | n/a | **2,562 / 4,656** |
| candidate_fetch p50 / p95 ms | 0 | **1,298 / 2,019** |

Overlap flags (`AI_RAG_SHADOW_ENTITY_HINTS=1`, `AI_RAG_SHADOW_NEIGHBOR_EXPANSION=1`) produced measurable overlap on 3/7 cases with entity boosting on 4/7.

## Structured endpoints

| endpoint | HTTP | status |
|----------|-----:|--------|
| seller_sales_summary | 200 | non-empty |
| buyer_collection_summary | 0 | missing/404 (pre-existing) |
| pricing_recommendation | 200 | non-empty |
| record_valuation | 200 | non-empty |
| auction_risk | 200 | non-empty |

**Aggregate:** 4/5 non-empty, 1 degraded/missing (unchanged from T20.13D).

## Sanitized answer excerpts

1. **catalog_activity:** Retrieved 8 grounded excerpts for your question.
2. **seller_notifications:** Retrieved 8 grounded excerpts for your question.
3. **private_negotiation_no_messages:** Retrieved 8 grounded excerpts for your question.
4. **pricing_recommendation:** Suggested price near $55.0 based on listing, revisions, and offer/auction summaries.

## Leakage

**PASS** — no forbidden tokens, message bodies, or message source types in keyword or endpoint responses.

## Flags reset

After flagged mode:

```text
AI_RAG_SHADOW_ENTITY_HINTS=0
AI_RAG_SHADOW_NEIGHBOR_EXPANSION=0
```

## Interpretation

T20.13D's 7/7 `embed_timeout_before_fetch` failures were **cold-start Ollama embed latency**, not retrieval emptiness or request errors. Diagnostic embed warmup (T20.13B Option A) eliminated all embed timeouts and unlocked shadow candidate fetch on **7/7** cases in both flag modes.

| Before warmup | After warmup |
|---------------|--------------|
| 7/7 embed_timeout_before_fetch | 0/7 |
| 0/7 shadow_fetch_attempted | 7/7 |
| Overlap unmeasurable | Overlap measurable (1/1/1 off, 3/3/3 on) |

**Recommended next:** Continue toward **T20.13G** shadow fetch/latency triage now that fetch and overlap telemetry are observable. Do **not** start overlap tuning or vector rollout until T20.13G completes.

If future runs regress to embed timeouts without warmup, prioritize **Ollama runtime/provider stabilization** rather than retrieval tuning.

## Final verdict

| Gate | Status |
|------|--------|
| Vector rollout | **NOT APPROVED** |
| Phase 21 | **not started** |
| Production retrieval | **keyword** (unchanged) |
