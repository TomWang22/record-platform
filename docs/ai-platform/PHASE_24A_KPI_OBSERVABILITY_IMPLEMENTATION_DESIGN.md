# Phase 24A — KPI observability implementation design

**Phase 24A:** COMPLETE — design only  
**Live eval:** NOT RUN  
**Runtime/env/default/allowlist changes:** NONE  
**Production default:** keyword  
**Preview UI/API:** KEEP  
**PERCENT=0**  
**ALLOW_PROD_PERCENT=0**  
**Hybrid/vector production default:** NOT APPROVED

---

## Executive verdict

Phase 24 defines a **read-only KPI observability layer** on top of committed Phase 21–23 evidence. It does not run live inference and does not claim missing instrumentation is complete.

The remaining real gap after H1/H2/H3 full protocol parity is **monitoring**: usefulness over time, retrieval latency by labeled protocol, ingestion success, data-to-searchable timing, and operational health in one redacted read-only report.

---

## Existing labeled evidence (do not relabel)

```text
H1 baseline: 57105/57105 HTTP/1.1 — Phase 21 historical matrix
H2 replay: 57105/57105 HTTP/2 PASS — Phase 22I
H3 replay: 57105/57105 HTTP/3 PASS — Phase 22J
Combined labeled full-protocol evidence: 171315/171315 — H1+H2+H3 only
Phase 22C: 7200/7200 sample only
Phase 22B: 15/15 smoke only
```

---

## KPI family 1 — Recommendation usefulness over time

### Available today (committed docs)

| Source | Metrics |
| ------ | ------- |
| `PHASE_22I_H2_FULL_57105_REPLAY.md` | response/sentiment/red-team pass rates, leakage=0, fallback=0 |
| `PHASE_22J_H3_FULL_57105_REPLAY.md` | same for H3 |
| `PHASE_22C_*` | sample-only usefulness at 7200 scale |
| `PHASE_22_FULL_PROTOCOL_PARITY_ARCHIVE.md` | H1/H2/H3 labeled counts, gate summary |
| Phase 21 archive | H1 57105/57105 HTTP 200, 0% fallback |

### Gaps

```text
No time-series store for usefulness over time (no TSDB export committed).
quality_score exists per probe in replay path but is not aggregated over time in one committed report.
Do not label rubric pass rates as model accuracy without ground truth.
```

### Phase 24B extractor approach

Read committed docs only. Emit labeled buckets per protocol. Never merge into one unlabeled cumulative matrix.

---

## KPI family 2 — Search / retrieval latency

### Available today

| Label | p50 | p95 | max | Source |
| ----- | --: | --: | --: | ------ |
| H2 replay | 118.9 | 670.1 | 7192 | Phase 22I / archive |
| H3 replay | 130.9 | 785.8 | 8652.5 | Phase 22J / archive |
| Phase 22C sample H1 | 127.0 | 475.1 | 5535.9 | Phase 22C doc |
| Phase 22C sample H2 | 124.1 | 504.7 | 5523.9 | Phase 22C doc |
| Phase 22C sample H3 | 124.6 | 708.9 | 6335.8 | Phase 22C doc |

### Gaps

```text
H1 full-matrix p50/p95/max is not in committed archive docs — report GAP.
hybrid_retrieval_ms is not uniformly exported in committed summaries.
```

---

## KPI family 3 — Ingestion pipeline success rates

### Defined formulas (`PHASE_22_KPI_OBSERVABILITY_READINESS.md`)

```text
ingestion_success_rate = indexed_records / received_records
embedding_success_rate = completed_embedding_jobs / started_embedding_jobs
index_success_rate = successful_upserts / attempted_upserts
```

### Existing repo surfaces

| Source | Read-only data |
| ------ | -------------- |
| `ai.ai_ingestion_runs` | status, started_at, finished_at, source_counts |
| `ai.ai_documents` / `ai.ai_document_chunks` | corpus counts, chunks_with_embedding |
| `services/python-ai-service/app/rag_status.py` | last ingestion run snapshot |

### Gaps (honest)

```text
ingestion_success_rate is defined but not fully extracted at per-source granularity.
No standard embedding_jobs_started/completed counters in python-ai-service Prometheus today.
No dead_letter_count aggregate in one committed endpoint.
Phase 24B reports run-level counts when DB is reachable; otherwise GAP.
```

---

## KPI family 4 — End-to-end data-arrival-to-searchable time

### Target lifecycle

```text
data_arrived_at → normalized_at → embedding_started_at → embedding_completed_at → index_upserted_at → searchable_verified_at
```

### Available today

```text
ai.ai_ingestion_runs.started_at
ai.ai_ingestion_runs.finished_at
```

### Gaps (honest)

```text
data_to_searchable_ms is defined but not instrumented end-to-end.
No searchable_verified_at probe in standard smoke path.
No per-record arrival_to_searchable chain in schema.
Phase 24B must output GAP — never invent timing.
```

---

## KPI family 5 — Operational health

### Available today

```text
Phase 21 archive verifier
Phase 22 full protocol parity verifier
Phase 23 guardrails (archive + evidence-label + dry-run resume)
Production posture locks (keyword default, PERCENT=0, allowlist contract UID)
Phase 22E telemetry audit references (not re-run in Phase 24)
```

### Gaps

```text
No single committed uptime/error-rate time series.
Fallback/canary-error rates exist in replay evidence but are not a continuous ops dashboard.
```

---

## Phase 24 workstream

| Phase | Scope | Status |
| ----- | ----- | ------ |
| 24A | KPI observability implementation design | COMPLETE |
| 24B | Read-only KPI extractor scripts | In batch |
| 24C | KPI guard tests + Makefile target | In batch |
| 24D | Phase 24 KPI observability closeout | In batch |

---

## Hard stops

```text
No live eval
No production-default RFC
No PERCENT rollout
No runtime/env/default/allowlist/artifact/user changes
No bench log commits
No invented KPI values
```

---

## Next approval phrase

```text
Approved: start Phase 25 observability instrumentation design only — no live eval, no runtime changes.
```
