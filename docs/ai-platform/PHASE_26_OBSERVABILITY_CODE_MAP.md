# Phase 26 — Observability Code Map

Map from Phase 26 documents → code → flags → tests → operational status. Implementation closed at `4409ffc`; this doc is explanatory only.

Archive: `PHASE_26_OBSERVABILITY_IMPLEMENTATION_ARCHIVE.md`  
Operator guide: `PHASE_26_OBSERVABILITY_OPERATOR_GUIDE.md`

---

## Config and gate layer

| Path | Role |
|------|------|
| `services/python-ai-service/app/ai/config.py` | Defines `AI_KPI_*` env defaults |
| `services/python-ai-service/app/ai/kpi_observability.py` | `kpi_writes_allowed`, posture snapshot, `noop_write_kpi_*` |

### Default-off flags

```text
AI_KPI_OBSERVABILITY_ENABLED = "0"
AI_KPI_INGESTION_EVENTS_ENABLED = "0"
AI_KPI_SEARCHABILITY_CHECKS_ENABLED = "0"
AI_KPI_QUERY_OBSERVATIONS_ENABLED = "0"
AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED = "0"
AI_KPI_OBSERVABILITY_MASTER_DISABLE = "1"
```

### Master disable

When `AI_KPI_OBSERVABILITY_MASTER_DISABLE` resolves true, **every** channel is blocked regardless of other flags.

### `kpi_writes_allowed(channel)`

Returns true only if:

1. master disable is off, and
2. global observability is enabled, and
3. the channel-specific flag is enabled.

Channels: `ingestion` | `searchability` | `query` | `usefulness`.

### No-op / safe emitter behavior

- `noop_write_kpi_ingestion_event` / `_searchability_check` / `_query_observation` / `_usefulness_observation`
- If writes disallowed → return `None` immediately (no DB call)
- If allowed → delegate to the channel module’s sync write helper
- Query channel also has `emit_rag_query_observation_safe` (catch/log on failure; still gated)
- Usefulness has `emit_usefulness_observation_safe` (caller-supplied rubric only; still gated)

Tests: `services/python-ai-service/tests/test_phase26a_kpi_observability.py`

---

## Schema

| Path | Role |
|------|------|
| `infra/db/48-ai-kpi-observability.sql` | Idempotent CREATE SCHEMA/TABLE/INDEX for four `ai.ai_kpi_*` tables |

Operational: applied to local/dev `python_ai` @ `127.0.0.1:5440` where stated. Live migration: **NOT APPLIED**.

---

## KPI write paths

### `kpi_ingestion_events.py` (26B)

| Item | Detail |
|------|--------|
| Payload | Redacted ingestion counters + timestamps + durations; hashes source id when provided |
| Redacts / rejects | `FORBIDDEN_PAYLOAD_KEYS` (raw source ids, bodies, jwt/token, private_message, db_dump, …) |
| Table | `ai.ai_kpi_ingestion_events` |
| Flag | `AI_KPI_INGESTION_EVENTS_ENABLED` (+ master/global) |
| Entry | `noop_write_kpi_ingestion_event` → `write_kpi_ingestion_event_sync` |
| Tests | `tests/test_phase26b_kpi_ingestion.py` |

### `kpi_searchability_checks.py` (26C)

| Item | Detail |
|------|--------|
| Payload | Redacted searchability probe: hashed source, `arrival_to_searchable_ms`, probe status, optional protocol |
| Redacts / rejects | Raw source ids, raw probe queries, bodies, secrets |
| Table | `ai.ai_kpi_searchability_checks` |
| Flag | `AI_KPI_SEARCHABILITY_CHECKS_ENABLED` (+ master/global) |
| Entry | `noop_write_kpi_searchability_check` → `write_kpi_searchability_check_sync` |
| Tests | `tests/test_phase26c_kpi_searchability.py` |

### `kpi_query_observations.py` (26D)

| Item | Detail |
|------|--------|
| Payload | Protocol, retrieval mode, timing ms, fallback/canary counts, environment; built from RAG envelope metrics |
| Redacts / rejects | question/prompt/answer/summary/excerpts/citations, auth/cookies/emails/user_id, bodies |
| Table | `ai.ai_kpi_query_observations` |
| Flag | `AI_KPI_QUERY_OBSERVATIONS_ENABLED` (+ master/global) |
| Hook | `services/python-ai-service/app/ai/routes.py` on `/ai/rag/query` (default-off) |
| Entry | `noop_write_kpi_query_observation` / `emit_rag_query_observation_safe` |
| Tests | `tests/test_phase26d_kpi_query_observations.py` |

### `kpi_usefulness_observations.py` (26E)

| Item | Detail |
|------|--------|
| Payload | Rubric metadata: response_pass, leakage_failures, optional quality/sentiment/red-team flags, evidence_label |
| Redacts / rejects | question/answer/bodies, rubric_input, auth/emails/user_id |
| Table | `ai.ai_kpi_usefulness_observations` |
| Flag | `AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED` (+ master/global) |
| Note | No production request-path hook; caller-supplied export only |
| Entry | `noop_write_kpi_usefulness_observation` / `emit_usefulness_observation_safe` |
| Tests | `tests/test_phase26e_kpi_usefulness.py` |

**Operational status for all four write paths:** implemented, default-off, disable-switch verified.

---

## Report / extractor layer

| Path | Role |
|------|------|
| `scripts/lib/phase26b-ingestion-kpi-readonly.mjs` | Ingestion KPI extractor (PASS/PARTIAL/GAP) |
| `scripts/lib/phase26c-searchability-kpi-readonly.mjs` | Searchability / data_to_searchable_ms extractor |
| `scripts/lib/phase26d-query-observation-kpi-readonly.mjs` | Query observation extractor |
| `scripts/lib/phase26e-usefulness-observation-kpi-readonly.mjs` | Usefulness observation extractor |
| `scripts/lib/phase26f-combined-kpi-report-readonly.mjs` | Combined Phase 25C report builder + temp-dir write + redaction |
| `scripts/phase26f-combined-kpi-report-readonly.mjs` | CLI: SELECT-only DB read, write under `/tmp` |

### Semantics

```text
Read-only behavior — SELECT / in-memory aggregation only; no INSERT INTO ai.ai_kpi_*
PASS / PARTIAL / GAP — based on available redacted rows, not accuracy claims
No raw/private report fields — forbidden keys guarded in writer/assertArtifactRedacted
/tmp output only — assertWritableOutputDir rejects non-temp destinations
```

---

## Guard / test layer (26A–26G)

### Schema / closeout guards (Node lib + readonly CLI)

| Guard lib | CLI | Tests |
|-----------|-----|-------|
| `scripts/lib/phase26a-ai-kpi-schema-guard.mjs` | `scripts/phase26a-ai-kpi-schema-guard-readonly.mjs` | `tests/phase26a-ai-kpi-schema-guard.test.mjs` |
| `scripts/lib/phase26b-ingestion-guard.mjs` | `scripts/phase26b-ingestion-guard-readonly.mjs` | `tests/phase26b-ingestion-guard.test.mjs`, `tests/phase26b-ingestion-kpi-readonly.test.mjs` |
| `scripts/lib/phase26c-searchability-guard.mjs` | `scripts/phase26c-searchability-guard-readonly.mjs` | `tests/phase26c-searchability-guard.test.mjs`, `tests/phase26c-searchability-kpi-readonly.test.mjs` |
| `scripts/lib/phase26d-query-observation-guard.mjs` | `scripts/phase26d-query-observation-guard-readonly.mjs` | `tests/phase26d-query-observation-guard.test.mjs`, `tests/phase26d-query-observation-kpi-readonly.test.mjs` |
| `scripts/lib/phase26e-usefulness-observation-guard.mjs` | `scripts/phase26e-usefulness-observation-guard-readonly.mjs` | `tests/phase26e-usefulness-observation-guard.test.mjs`, `tests/phase26e-usefulness-observation-kpi-readonly.test.mjs` |
| `scripts/lib/phase26f-dashboard-report-guard.mjs` | `scripts/phase26f-dashboard-report-guard-readonly.mjs` | `tests/phase26f-dashboard-report-guard.test.mjs`, `tests/phase26f-combined-kpi-report-readonly.test.mjs` |
| `scripts/lib/phase26g-observability-disable-switch-guard.mjs` | `scripts/phase26g-observability-disable-switch-guard-readonly.mjs` | `tests/phase26g-observability-disable-switch-guard.test.mjs` |

### Python unit tests

```text
services/python-ai-service/tests/test_phase26a_kpi_observability.py
services/python-ai-service/tests/test_phase26b_kpi_ingestion.py
services/python-ai-service/tests/test_phase26c_kpi_searchability.py
services/python-ai-service/tests/test_phase26d_kpi_query_observations.py
services/python-ai-service/tests/test_phase26e_kpi_usefulness.py
```

### Makefile targets

```text
ai-platform-verify-phase26a-schema
ai-platform-verify-phase26b-ingestion
ai-platform-verify-phase26c-searchability
ai-platform-verify-phase26d-query-observations
ai-platform-verify-phase26e-usefulness
ai-platform-verify-phase26f-kpi-report
ai-platform-verify-phase26-observability   # 26F + 26G disable-switch closeout
```

---

## Closeout docs (one per phase)

```text
docs/ai-platform/PHASE_26A_OBSERVABILITY_SCHEMA_AND_NOOP_INSTRUMENTATION.md
docs/ai-platform/PHASE_26B_INGESTION_INSTRUMENTATION_CLOSEOUT.md
docs/ai-platform/PHASE_26C_SEARCHABILITY_VERIFICATION_PROBE_CLOSEOUT.md
docs/ai-platform/PHASE_26D_QUERY_OBSERVATION_INSTRUMENTATION_CLOSEOUT.md
docs/ai-platform/PHASE_26E_USEFULNESS_OBSERVATION_EXPORT_CLOSEOUT.md
docs/ai-platform/PHASE_26F_KPI_DASHBOARD_REPORT_GENERATION_CLOSEOUT.md
docs/ai-platform/PHASE_26G_OBSERVABILITY_DISABLE_SWITCH_AND_CLOSEOUT.md
docs/ai-platform/PHASE_26_OBSERVABILITY_IMPLEMENTATION_ARCHIVE.md      # 26H
docs/ai-platform/PHASE_26_OBSERVABILITY_OPERATOR_GUIDE.md               # 26H
docs/ai-platform/PHASE_26_OBSERVABILITY_CODE_MAP.md                     # 26H (this file)
```

---

## Design ancestors (read-only history)

```text
docs/ai-platform/PHASE_25A_OBSERVABILITY_INSTRUMENTATION_ARCHITECTURE_DESIGN.md
docs/ai-platform/PHASE_25B_KPI_EVENT_AND_SCHEMA_CONTRACT_PROPOSAL.md
docs/ai-platform/PHASE_25C_KPI_EXTRACTOR_AND_DASHBOARD_CONTRACT_DESIGN.md
docs/ai-platform/PHASE_25D_OBSERVABILITY_IMPLEMENTATION_ROLLOUT_PLAN.md
```

Phase 24 was read-only gap inventory preceding the Phase 25 design batch.
