# Phase 25A — observability instrumentation architecture design

**Phase 25A:** COMPLETE — design only  
**Live eval:** NOT RUN  
**Runtime/env/default/allowlist changes:** NONE  
**DB schema changes applied:** NO

---

## Executive verdict

Phase 25A defines the **target observability architecture** that closes Phase 24 KPI gaps without claiming missing instrumentation exists today.

Phase 25 designs only. Phase 26 implements.

---

## Phase 24 gaps → Phase 25/26 mapping

| Phase 24 gap | Phase 25 design target | Phase 26 implementation owner |
| ------------ | ---------------------- | ----------------------------- |
| ingestion_success_rate per source type | `ai.ai_kpi_ingestion_events` + ingestion KPI extractor | Phase 26B |
| data_to_searchable_ms end-to-end | `ai.ai_kpi_searchability_checks` + timing chain | Phase 26C |
| H1 full-matrix latency in committed docs | query observation export + doc backfill policy | Phase 26D + doc policy |
| usefulness over time time-series | `ai.ai_kpi_usefulness_observations` | Phase 26E |

---

## Target architecture (text flow)

```text
data source (record, listing, message, …)
  → ingestion run (ai.ai_ingestion_runs — exists today, run-level only)
  → ai_kpi_ingestion_events (per source_type batch, records_received/indexed)
  → document rows (ai.ai_documents — exists)
  → chunk rows (ai.ai_document_chunks — exists)
  → embedding job (ollama-worker / controlled backfill — partial metrics today)
  → ai_kpi_ingestion_events (embedding_jobs_started/completed/failed)
  → vector/index upsert (keyword path today; hybrid vector optional)
  → ai_kpi_searchability_checks (searchable_verified_at probe)
  → KPI extractor/report (Phase 24 read-only today → Phase 26F dashboards)
```

Parallel query path:

```text
RAG query (/api/ai/rag/query)
  → ai_kpi_query_observations (protocol, gate_reason, latency, fallback)
  → ai_kpi_usefulness_observations (rubric pass rates, no raw bodies)
  → phase25_query_latency_kpis.json / phase25_usefulness_kpis.json
```

Operational path:

```text
readiness / 4xx / 5xx / timeout / fallback / canary_error / telemetry WARN
  → phase25_operational_health_kpis.json
  → archive verifiers + production posture locks (existing)
```

---

## Component responsibilities

### Ingestion success by source type

- **Today:** `ai.ai_ingestion_runs.source_counts` JSONB on last run; run-level status only.
- **Target:** Per-source-type `records_received`, `records_indexed`, `embedding_jobs_*`, `index_upsert_*`, `dead_letter_count`, `retry_count`.
- **Does not exist today:** Per-record received vs indexed counters at event granularity.

### Embedding job success/failure

- **Today:** ollama-worker Prometheus counters (jobs processed/failed/DLQ) — not unified in python-ai KPI export.
- **Target:** Events linked to `ingestion_run_id` and `source_type`.

### Index upsert success/failure

- **Today:** Implicit in reindex scripts; not exported as KPI events.
- **Target:** `index_upsert_success`, `index_upsert_failed` per source batch.

### Data arrival → searchable timing

- **Today:** `started_at` / `finished_at` on `ai.ai_ingestion_runs` only.
- **Target:** `data_arrived_at` … `searchable_verified_at` chain per document or batch; derived `arrival_to_searchable_ms`.

### Query/retrieval latency

- **Today:** Phase 22 replay docs (H2/H3 committed); H1 full-matrix latency GAP in docs.
- **Target:** `ai_kpi_query_observations` with `protocol`, `case_id`, `gate_reason`, `rag_total_ms`, `hybrid_retrieval_ms`.

### Usefulness over time

- **Today:** Rubric pass rates in replay docs; no time-series store.
- **Target:** `ai_kpi_usefulness_observations` aggregated by day/protocol/case — rubric only, not labeled model accuracy.

### Operational health

- **Today:** Archive verifiers, kubectl env locks, Phase 22E telemetry audit references.
- **Target:** Combined operational KPI JSON with uptime/error budget placeholders fed by Prometheus/Loki in Phase 26F.

---

## Evidence label preservation (mandatory)

All future dashboards and extractors must preserve:

```text
H1 baseline: 57105/57105 HTTP/1.1
H2 replay: 57105/57105 HTTP/2 PASS
H3 replay: 57105/57105 HTTP/3 PASS
Combined labeled full-protocol evidence: 171315/171315 (labeled sum only)
Phase 22C: 7200/7200 sample only
Phase 22B: 15/15 smoke only
```

Never merge into one unlabeled cumulative matrix total.

---

## Privacy and redaction (architecture-level)

```text
No raw response bodies in KPI tables or exports.
No JWTs, passwords, raw message bodies, proxy max bids.
Hash source identifiers (source_id_hash) where needed.
Aggregate-only usefulness metrics in committed reports.
```

---

## What does NOT exist today (honest)

```text
ai.ai_kpi_ingestion_events — NOT DEPLOYED
ai.ai_kpi_searchability_checks — NOT DEPLOYED
ai.ai_kpi_query_observations — NOT DEPLOYED
ai.ai_kpi_usefulness_observations — NOT DEPLOYED
End-to-end arrival_to_searchable_ms — NOT INSTRUMENTED
Usefulness time-series store — NOT DEPLOYED
Unified operational uptime/error-rate committed report — NOT DEPLOYED
```

---

## Related documents

- `PHASE_25B_KPI_EVENT_AND_SCHEMA_CONTRACT_PROPOSAL.md`
- `PHASE_25C_KPI_EXTRACTOR_AND_DASHBOARD_CONTRACT_DESIGN.md`
- `PHASE_25D_OBSERVABILITY_IMPLEMENTATION_ROLLOUT_PLAN.md`
