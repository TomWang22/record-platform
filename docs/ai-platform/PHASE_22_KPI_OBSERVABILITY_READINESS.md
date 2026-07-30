# Phase 22 — KPI and observability readiness

**Status:** COMPLETE (planning/readiness definitions)  
**Created:** 2026-07-05  
**Audience:** Cursor, GitHub Copilot, and other coding agents working on `record-platform`

This document defines Phase 22 **KPI and observability evidence buckets** separate from the Phase 21 cumulative live matrix and separate from H1/H2/H3 transport/response smoke counts.

```text
Phase 21 cumulative matrix: 57105/57105 HTTP 200, 0% fallback — HTTP/1.1 live-runner stack only.
Phase 22 smoke probes: read-only, not added to 57105.
Do not claim labeled model accuracy without ground truth — use usefulness / rubric pass rates.
```

---

## 1. Recommendation accuracy / usefulness over time

### Per-run row fields

```text
case_id
protocol
intent
response_pass
sentiment_pass
quality_score (if returned)
human_rating (optional)
usefulness_rating (optional)
grounding_pass
leakage_pass
fallback_count
timestamp
git_sha
artifact_sha
```

Captured by: `scripts/smoke-ai-rag-real-inference-response-readonly.sh` when `WRITE_JSONL=1`.

### Metrics

```text
response_pass_rate = passed_response_cases / total_cases
sentiment_pass_rate = passed_sentiment_cases / sentiment_required_cases
avg_quality_score
worst_quality_score
red_team_safety_pass_rate
grounding_pass_rate
```

**Naming:** Use **usefulness / rubric pass rate** for current evidence. Do not label as “model accuracy” unless labeled ground truth exists.

Summarized by: `scripts/summarize-phase22-ai-kpis-readonly.mjs`

---

## 2. Search / retrieval latency for common workflows

### Per-probe fields

```text
rag_total_ms          # curl time_total × 1000 (end-to-end RAG HTTP)
hybrid_retrieval_ms   # from response details.hybrid_canary.hybrid_latency_ms when present
keyword_retrieval_ms  # reserved — not always returned in contract path
response_total_ms     # alias of rag_total_ms in smoke
```

### Aggregates

```text
p50 / p95 / max by workflow (case_id)
p50 / p95 / max by protocol (h1-explicit, h2, h3)
```

### Workflows (Phase 22 smoke suite)

```text
seller_listing_advice
buyer_sentiment
negotiation_strategy
auction_pressure
red_team_overclaim
```

Phase 22B baseline capture only — latency is **not** a hard fail gate unless non-200/timeout.

---

## 3. Ingestion pipeline success rates

Read-only planning. **Do not mutate data** in Phase 22B.

### Target metrics

```text
records_received
records_indexed
embedding_jobs_started
embedding_jobs_completed
embedding_jobs_failed
index_upsert_success
index_upsert_failed
retry_count
dead_letter_count
```

### Formulas

```text
ingestion_success_rate = indexed_records / received_records
embedding_success_rate = completed_embedding_jobs / started_embedding_jobs
index_success_rate = successful_upserts / attempted_upserts
```

### Existing repo references

| Source | What it exposes |
| ------ | ---------------- |
| `services/python-ai-service/app/rag_status.py` | `ai.ai_ingestion_runs`, `last_ingestion_run`, corpus counts, `chunks_with_embedding` |
| `scripts/rp-ai-rag-reindex.mjs` / `scripts/lib/rp-ai-rag-db.mjs` | Ingestion run insert/update |
| `scripts/rp-ai-embedding-backfill-controlled.sh` | Controlled embedding backfill |
| `services/ollama-worker/worker.js` | Prometheus counters: jobs processed/failed/DLQ, job latency |

### Instrumentation gaps (Phase 22B)

```text
No unified Phase 22 KPI export for records_received vs indexed_records per source type.
No standard embedding_jobs_started/completed counters in python-ai-service Prometheus today.
No dead_letter_count aggregate exposed for RAG ingestion in one endpoint.
```

Phase 22C live matrix may require closing these gaps before production-readiness sign-off.

---

## 4. End-to-end processing time to searchable

### Lifecycle timestamps (target)

```text
data_arrived_at
normalized_at
embedding_started_at
embedding_completed_at
index_upserted_at
searchable_verified_at
```

### Metrics

```text
arrival_to_searchable_ms
arrival_to_embedding_ms
embedding_duration_ms
upsert_to_searchable_ms
p50 / p95 / max
```

### Instrumentation gaps (Phase 22B)

```text
ai.ai_ingestion_runs has started_at/finished_at but not per-record arrival_to_searchable chain.
No searchable_verified_at probe in standard smoke path.
Proposed fields: extend ai_ingestion_runs metadata JSON with stage timestamps (design only — no schema change in 22B).
```

Do not invent timing data. Use smoke `rag_total_ms` as **query-path latency** only.

---

## 5. Operational metrics

### Runtime health

```text
uptime / readiness probe pass
HTTP 5xx rate
HTTP 4xx auth/config rate
RAG 200 rate
fallback rate
canary errors
timeout count
429 retry count
pod restart count
telemetry WARN count
RP result
Playwright C-suite result
```

### Development health gates (Phase 22B validator)

```text
Phase 21 archive verification: PASS
Transport + response smoke: PASS (15/15)
Telemetry WARNs = 0 for validator smoke scope (when checked)
RP PASS (when run)
Preview UI smoke PASS (when run)
No production-default drift
No PERCENT drift
No allowlist drift
```

Existing references: T20 closeout telemetry audits, `scripts/verify-phase-21-archive-readonly.sh`, RP/coverage scripts under `scripts/coverage/`.

---

## Local summarizer

```bash
# Optional input override
PHASE22_KPI_INPUT_GLOB='/tmp/phase22-smoke-*.jsonl' \
  node scripts/summarize-phase22-ai-kpis-readonly.mjs

# Optional write (not staged by default)
PHASE22_KPI_WRITE_SUMMARY=1 \
PHASE22_KPI_SUMMARY_OUT=bench_logs/ai-platform/phase22/kpi-summary.json \
  node scripts/summarize-phase22-ai-kpis-readonly.mjs
```

If no files exist: `NO_DATA: KPI summarizer found no local Phase 22 result files` (exit 0).

---

## Related documents

- `docs/ai-platform/PHASE_22B_REAL_INFERENCE_RESPONSE_TRANSPORT_VALIDATOR.md`
- `docs/ai-platform/PHASE_22A_REAL_INFERENCE_RESPONSE_VALIDATION_DESIGN.md`
- `docs/ai-platform/PHASE_22_REAL_INFERENCE_TRANSPORT_READINESS_PLAN.md`
