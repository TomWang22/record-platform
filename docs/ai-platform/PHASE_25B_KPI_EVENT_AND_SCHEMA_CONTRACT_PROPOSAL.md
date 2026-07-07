# Phase 25B — KPI event and schema contract proposal

**Phase 25B:** COMPLETE — design only  
**DB schema changes applied:** NO  
**Migrations applied:** NO

---

## Executive verdict

This document proposes **four new `ai` schema tables** for Phase 26A migration. Nothing in this proposal is deployed today.

Privacy rules (mandatory):

```text
No raw response bodies.
No raw message bodies.
No JWTs.
No passwords.
No raw buyer private data.
No proxy max bids.
Hash or redact source identifiers when needed.
```

---

## Table: `ai.ai_kpi_ingestion_events`

Per-batch ingestion KPI events linked to `ai.ai_ingestion_runs`.

| Field | Type | Nullable? | Source | PII risk | Redaction rule | Example | Phase 26 required? |
| ----- | ---- | --------- | ------ | -------- | -------------- | ------- | ------------------ |
| id | uuid | NO | generated | low | none | `a1b2c3d4-...` | YES |
| ingestion_run_id | uuid | NO | `ai.ai_ingestion_runs.id` | low | none | `run-uuid` | YES |
| source_type | text | NO | ingestion pipeline | low | enum only | `listing` | YES |
| source_id_hash | text | YES | hash(source_id) | medium | SHA-256, no raw ID | `sha256:abc...` | YES |
| data_arrived_at | timestamptz | NO | ingestion receipt | low | none | `2026-07-07T12:00:00Z` | YES |
| normalized_at | timestamptz | YES | normalizer | low | none | `2026-07-07T12:00:05Z` | YES |
| embedding_started_at | timestamptz | YES | ollama-worker | low | none | `2026-07-07T12:00:10Z` | YES |
| embedding_completed_at | timestamptz | YES | ollama-worker | low | none | `2026-07-07T12:00:45Z` | YES |
| index_upserted_at | timestamptz | YES | reindex/upsert | low | none | `2026-07-07T12:01:00Z` | YES |
| searchable_verified_at | timestamptz | YES | searchability probe | low | none | `2026-07-07T12:01:05Z` | YES |
| arrival_to_searchable_ms | bigint | YES | derived | low | none | `65000` | YES |
| embedding_duration_ms | bigint | YES | derived | low | none | `35000` | YES |
| index_upsert_duration_ms | bigint | YES | derived | low | none | `15000` | YES |
| records_received | integer | NO | ingestion counter | low | aggregate only | `120` | YES |
| records_indexed | integer | NO | index counter | low | aggregate only | `118` | YES |
| embedding_jobs_started | integer | NO | worker counter | low | none | `120` | YES |
| embedding_jobs_completed | integer | NO | worker counter | low | none | `118` | YES |
| embedding_jobs_failed | integer | NO | worker counter | low | none | `2` | YES |
| index_upsert_success | integer | NO | upsert counter | low | none | `118` | YES |
| index_upsert_failed | integer | NO | upsert counter | low | none | `2` | YES |
| dead_letter_count | integer | NO | DLQ counter | low | none | `1` | YES |
| retry_count | integer | NO | retry counter | low | none | `3` | YES |
| created_at | timestamptz | NO | default now() | low | none | `2026-07-07T12:01:05Z` | YES |
| updated_at | timestamptz | NO | @updatedAt | low | none | `2026-07-07T12:01:05Z` | YES |

**Indexes (proposed):** `(ingestion_run_id)`, `(source_type, data_arrived_at)`, `(created_at)`.

**Does not exist today:** This table is NOT DEPLOYED.

---

## Table: `ai.ai_kpi_searchability_checks`

Verification probes confirming documents are searchable after indexing.

| Field | Type | Nullable? | Source | PII risk | Redaction rule | Example | Phase 26 required? |
| ----- | ---- | --------- | ------ | -------- | -------------- | ------- | ------------------ |
| id | uuid | NO | generated | low | none | `uuid` | YES |
| ingestion_run_id | uuid | YES | FK optional | low | none | `run-uuid` | YES |
| source_type | text | NO | probe config | low | enum | `listing` | YES |
| source_id_hash | text | NO | hash | medium | SHA-256 | `sha256:def...` | YES |
| data_arrived_at | timestamptz | YES | copied from ingestion event | low | none | `2026-07-07T12:00:00Z` | YES |
| searchable_verified_at | timestamptz | NO | probe success time | low | none | `2026-07-07T12:01:05Z` | YES |
| arrival_to_searchable_ms | bigint | NO | derived | low | none | `65000` | YES |
| probe_query_hash | text | YES | hash(probe query) | low | no raw query text | `sha256:probe...` | NO |
| probe_status | text | NO | probe result | low | PASS/FAIL only | `PASS` | YES |
| protocol | text | YES | keyword/hybrid | low | none | `keyword` | NO |
| created_at | timestamptz | NO | default | low | none | `2026-07-07T12:01:05Z` | YES |

**Does not exist today:** End-to-end `arrival_to_searchable_ms` is NOT INSTRUMENTED.

---

## Table: `ai.ai_kpi_query_observations`

Per-query latency and gate observations. **No raw response bodies.**

| Field | Type | Nullable? | Source | PII risk | Redaction rule | Example | Phase 26 required? |
| ----- | ---- | --------- | ------ | -------- | -------------- | ------- | ------------------ |
| id | uuid | NO | generated | low | none | `uuid` | YES |
| observed_at | timestamptz | NO | request time | low | none | `2026-07-07T14:00:00Z` | YES |
| protocol | text | NO | HTTP version / transport | low | none | `HTTP/2` | YES |
| retrieval_mode | text | NO | keyword/hybrid/vector | low | none | `keyword` | YES |
| gate_reason | text | YES | allowlist/shadow gate | low | enum | `keyword_default` | YES |
| case_id | text | YES | eval case label | low | no user PII | `seller-intel-042` | NO |
| workflow | text | YES | RAG workflow name | low | none | `seller_intelligence` | NO |
| rag_total_ms | integer | NO | total latency | low | none | `142` | YES |
| hybrid_retrieval_ms | integer | YES | hybrid path only | low | none | `89` | YES |
| keyword_retrieval_ms | integer | YES | keyword path | low | none | `45` | YES |
| fallback_count | integer | NO | fallback invocations | low | none | `0` | YES |
| canary_error_count | integer | NO | canary errors | low | none | `0` | YES |
| http_status | integer | YES | response code | low | none | `200` | NO |
| environment | text | NO | prod/preview/lab | low | none | `preview` | YES |
| created_at | timestamptz | NO | default | low | none | `2026-07-07T14:00:01Z` | YES |

**Forbidden columns:** `response_body`, `message_body`, `jwt`, `password`, `proxy_max_bid`.

**Does not exist today:** Query observation store is NOT DEPLOYED. H1 full-matrix latency in committed docs remains GAP until Phase 26D.

---

## Table: `ai.ai_kpi_usefulness_observations`

Rubric outcomes over time. **No raw response bodies.**

| Field | Type | Nullable? | Source | PII risk | Redaction rule | Example | Phase 26 required? |
| ----- | ---- | --------- | ------ | -------- | -------------- | ------- | ------------------ |
| id | uuid | NO | generated | low | none | `uuid` | YES |
| observed_at | timestamptz | NO | eval time | low | none | `2026-07-07T14:00:00Z` | YES |
| protocol | text | NO | H1/H2/H3 label | low | preserve evidence labels | `HTTP/2` | YES |
| case_id | text | YES | eval case | low | no PII | `case-001` | NO |
| workflow | text | YES | workflow name | low | none | `seller_intelligence` | NO |
| response_pass | boolean | NO | rubric | low | none | `true` | YES |
| sentiment_pass | boolean | YES | rubric | low | none | `true` | YES |
| red_team_safety_pass | boolean | YES | rubric | low | none | `true` | YES |
| leakage_failures | integer | NO | rubric count | low | none | `0` | YES |
| quality_score | numeric(4,2) | YES | rubric score | low | none | `4.00` | YES |
| evidence_label | text | YES | H1/H2/H3/22C/22B | low | preserve labels | `H2 replay 57105/57105` | YES |
| environment | text | NO | prod/preview/lab | low | none | `lab` | YES |
| created_at | timestamptz | NO | default | low | none | `2026-07-07T14:00:01Z` | YES |

**Does not exist today:** Usefulness time-series store is NOT DEPLOYED.

---

## Migration policy (Phase 26A only)

```text
Phase 25: proposal only — NO migrations.
Phase 26A: CREATE TABLE behind feature flag; tables empty or no-op writes until 26B–26E.
Rollback: DROP TABLE or disable write path via env gate.
```

---

## Related documents

- `PHASE_25A_OBSERVABILITY_INSTRUMENTATION_ARCHITECTURE_DESIGN.md`
- `PHASE_25C_KPI_EXTRACTOR_AND_DASHBOARD_CONTRACT_DESIGN.md`
- `PHASE_25D_OBSERVABILITY_IMPLEMENTATION_ROLLOUT_PLAN.md`
