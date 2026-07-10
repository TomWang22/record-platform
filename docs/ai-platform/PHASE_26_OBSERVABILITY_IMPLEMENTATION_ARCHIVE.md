# Phase 26 — Observability Implementation Archive

Human-readable archive of what Phase 26 built, why, how to verify it, and what remains gated. This is a documentation addendum only — it does **not** reopen implementation.

```text
Phase 26: CLOSED PASS
Closeout commit: f09a9ef
Phase 26H: archive/explainer docs only (no code changes)
Artifact SHA unchanged: 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa
Live eval: NOT RUN
Runtime/env/default/allowlist changes: NONE
DB writes during closeout: NO
Migrations applied to live DB: NO
KPI write paths default enabled: NO
Runtime writes enabled by default: NO
Disable switch verified: PASS
Production default: keyword
Preview UI/API: KEEP
PERCENT=0
ALLOW_PROD_PERCENT=0
Hybrid/vector production default: NOT APPROVED
```

```text
Archive precedence: When older phase docs conflict with this archive, this archive and ACTIVE_CONTEXT.md are authoritative for current state. Older docs are historical snapshots of their phase at the time they were committed.
```

| Snapshot / addendum | Status reading |
| ------------------- | -------------- |
| 26F doc says 26G NOT STARTED | historical snapshot |
| 26G doc closes Phase 26 implementation | current implementation closeout (`f09a9ef`) |
| 26H docs explain/archive Phase 26 | current human-readable archive addendum (`6d13e83`) |
| 26I docs note supersession / historical snapshots | consistency pass so older “NOT STARTED” lines cannot be mistaken for current state |

---

## Why Phase 26 existed

Phases 24–25 designed KPI observability (gap inventory, schema contracts, extractors, rollout plan). Phase 26 **implemented** that design behind default-off gates so the platform can later collect:

- ingestion success / timing by source type
- data-to-searchable latency
- query latency and protocol/mode observations
- usefulness rubric outcomes over time

…without enabling production writes, changing search defaults, or running live eval.

---

## Phase map

```text
26A — schema + no-op instrumentation foundation
26B — ingestion KPI write path + extractor
26C — searchability verification write path + extractor
26D — query observation write path + extractor
26E — usefulness observation write path + extractor
26F — combined KPI report generation
26G — disable-switch drill + implementation closeout
26H — archive/explainer docs only
26I — archive consistency / supersession notes only
```

| Phase | Closeout doc | Status |
|-------|--------------|--------|
| 26A | `PHASE_26A_OBSERVABILITY_SCHEMA_AND_NOOP_INSTRUMENTATION.md` | PASS |
| 26B | `PHASE_26B_INGESTION_INSTRUMENTATION_CLOSEOUT.md` | PASS |
| 26C | `PHASE_26C_SEARCHABILITY_VERIFICATION_PROBE_CLOSEOUT.md` | PASS |
| 26D | `PHASE_26D_QUERY_OBSERVATION_INSTRUMENTATION_CLOSEOUT.md` | PASS |
| 26E | `PHASE_26E_USEFULNESS_OBSERVATION_EXPORT_CLOSEOUT.md` | PASS |
| 26F | `PHASE_26F_KPI_DASHBOARD_REPORT_GENERATION_CLOSEOUT.md` | PASS |
| 26G | `PHASE_26G_OBSERVABILITY_DISABLE_SWITCH_AND_CLOSEOUT.md` | PASS |
| 26H | this archive + operator guide + code map | docs only |
| 26I | supersession / historical-snapshot consistency notes | docs only |

Companion docs:

- `PHASE_26_OBSERVABILITY_OPERATOR_GUIDE.md` — how to verify safely
- `PHASE_26_OBSERVABILITY_CODE_MAP.md` — docs → code → flags → tests

---

## What was built (end-to-end story)

1. **Schema** — idempotent SQL in `infra/db/48-ai-kpi-observability.sql` defining four `ai.ai_kpi_*` tables. Applied to local/dev `python_ai` @ `127.0.0.1:5440` during validation where stated. **Not** applied to live DB.
2. **Gate layer** — `AI_KPI_*` flags in `config.py`; `kpi_writes_allowed(channel)` and `noop_write_kpi_*` in `kpi_observability.py`. Master disable ON and all channel flags OFF by default.
3. **Write paths** — redacting payload builders + sync inserts for ingestion, searchability, query, and usefulness. Writes return `None` / no-op when gated off.
4. **Extractors + combined report** — read-only Node libraries and Phase 26F combined report (SELECT-only, `/tmp` output, redaction guards).
5. **Guards/tests** — Makefile targets through `make ai-platform-verify-phase26-observability`; Node guards + Python unit tests; disable-switch drill in 26G.

---

## Four KPI tables

### `ai.ai_kpi_ingestion_events`

| Field | Value |
|-------|-------|
| Purpose | Per-run / per-source_type ingestion counters and timing (arrival → searchable, embedding, index upsert) |
| Owning phase | 26B (schema 26A) |
| Write path | `services/python-ai-service/app/ai/kpi_ingestion_events.py` via `noop_write_kpi_ingestion_event` |
| Extractor/report | `scripts/lib/phase26b-ingestion-kpi-readonly.mjs`; included in 26F combined report |
| Default flag | `AI_KPI_INGESTION_EVENTS_ENABLED=0` (also blocked by master disable / global off) |
| Forbidden private/raw fields | `source_id`, `raw_source_id`, `response_body`, `raw_response_body`, `message_body`, `jwt`, `token`, `password`, `proxy_max_bid`, `private_message`, `authorization_header`, `db_dump`, … |
| Operational status | **Implemented but default-off** |

### `ai.ai_kpi_searchability_checks`

| Field | Value |
|-------|-------|
| Purpose | Probe that a source became searchable; `arrival_to_searchable_ms`, probe status |
| Owning phase | 26C (schema 26A) |
| Write path | `services/python-ai-service/app/ai/kpi_searchability_checks.py` via `noop_write_kpi_searchability_check` |
| Extractor/report | `scripts/lib/phase26c-searchability-kpi-readonly.mjs`; included in 26F combined report |
| Default flag | `AI_KPI_SEARCHABILITY_CHECKS_ENABLED=0` |
| Forbidden private/raw fields | `source_id`, `raw_source_id`, `probe_query`, `raw_probe_query`, response/message bodies, `jwt`, `token`, `password`, `private_message`, `db_dump`, … |
| Operational status | **Implemented but default-off** |

### `ai.ai_kpi_query_observations`

| Field | Value |
|-------|-------|
| Purpose | Per-request RAG timing/mode/protocol observations (no question/answer bodies) |
| Owning phase | 26D (schema 26A); hooked on `/ai/rag/query` behind flags |
| Write path | `services/python-ai-service/app/ai/kpi_query_observations.py` via `noop_write_kpi_query_observation` |
| Extractor/report | `scripts/lib/phase26d-query-observation-kpi-readonly.mjs`; included in 26F combined report |
| Default flag | `AI_KPI_QUERY_OBSERVATIONS_ENABLED=0` |
| Forbidden private/raw fields | `question`, `prompt`, `answer`, `summary`, `excerpts`, `citations`, bodies, JWT/auth/cookies, emails, `user_id`, `db_dump`, … |
| Operational status | **Implemented but default-off** |

### `ai.ai_kpi_usefulness_observations`

| Field | Value |
|-------|-------|
| Purpose | Caller-supplied rubric outcomes (pass flags, leakage counts, optional quality score, evidence labels) |
| Owning phase | 26E (schema 26A); no production request-path hook |
| Write path | `services/python-ai-service/app/ai/kpi_usefulness_observations.py` via `noop_write_kpi_usefulness_observation` |
| Extractor/report | `scripts/lib/phase26e-usefulness-observation-kpi-readonly.mjs`; included in 26F combined report |
| Default flag | `AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED=0` |
| Forbidden private/raw fields | `question`, `prompt`, `answer`, bodies, JWT/auth, emails, `user_id`, `rubric_input` / `raw_rubric_input`, `db_dump`, … |
| Operational status | **Implemented but default-off** |

---

## How write gates work

```text
AI_KPI_OBSERVABILITY_MASTER_DISABLE=1  → blocks all channels
AI_KPI_OBSERVABILITY_ENABLED=0         → blocks all channels
Per-channel AI_KPI_*_ENABLED=0         → blocks that channel
```

Defaults (all locked):

```text
AI_KPI_OBSERVABILITY_MASTER_DISABLE=1
AI_KPI_OBSERVABILITY_ENABLED=0
AI_KPI_INGESTION_EVENTS_ENABLED=0
AI_KPI_SEARCHABILITY_CHECKS_ENABLED=0
AI_KPI_QUERY_OBSERVATIONS_ENABLED=0
AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED=0
```

`kpi_writes_allowed(channel)` is true only when master disable is off **and** global enabled **and** the channel flag is on. All `noop_write_kpi_*` helpers return `None` when disallowed (no DB insert).

---

## How reports are generated

Phase 26F builds Phase 25C-style JSON contracts plus a combined report:

- SELECT-only reads against local/dev KPI tables when available
- Output under `/tmp` (or `os.tmpdir()`), **not** committed
- Redaction guards reject forbidden private/raw field names
- Child statuses are **PASS / PARTIAL / GAP** based on whether `ai_kpi_*` rows exist — not model accuracy claims

With defaults (writes off), many report children are GAP or PARTIAL. That is expected.

---

## KPI truth (do not overclaim)

```text
KPI observability implementation is complete behind default-off gates.
Operational KPI row population remains disabled by default.
KPI reports show PASS/PARTIAL/GAP based on available rows.
H1 full-matrix latency in committed docs remains GAP unless separately backfilled.
No production rollout is approved.
```

Operational gaps that remain **row-population** issues (not missing code):

- ingestion per `source_type` rates — need enabled writes + rows
- `data_to_searchable_ms` end-to-end — need check rows
- query latency summaries — need observation rows
- usefulness time-series — need usefulness rows
- H1 full-matrix latency in committed docs — not backfilled

---

## What Phase 26 did / did not do

```text
What Phase 26 did:
- Created the KPI schema contract and idempotent SQL file.
- Added default-off KPI write paths for ingestion, searchability, query observations, and usefulness observations.
- Added read-only extractors and combined report generation.
- Added guards/tests to preserve privacy, evidence labels, default-off posture, and read-only reporting.
- Verified disable switch behavior.

What Phase 26 did not do:
- Did not run live inference.
- Did not change production default.
- Did not set PERCENT or ALLOW_PROD_PERCENT above 0.
- Did not broaden allowlist.
- Did not enable KPI writes by default.
- Did not apply live DB migrations.
- Did not commit generated reports or bench logs.
- Did not backfill H1 full-matrix latency.
- Did not operationally populate KPI rows by default.
```

---

## Evidence label rules (preserved)

```text
H1 baseline: 57105/57105 HTTP/1.1
H2 replay: 57105/57105 HTTP/2 PASS
H3 replay: 57105/57105 HTTP/3 PASS
Combined labeled: 171315/171315 (labeled H1+H2+H3 only — never unlabeled cumulative)
Phase 22C: 7200/7200 sample only
Phase 22B: 15/15 smoke only
```

---

## How to verify safely

```bash
make ai-platform-verify-phase26-observability
```

Full operator commands, flags, and local/dev SQL notes: see `PHASE_26_OBSERVABILITY_OPERATOR_GUIDE.md`.  
Code / test inventory: see `PHASE_26_OBSERVABILITY_CODE_MAP.md`.

---

## Future roadmap (planning only — not approved)

```text
Phase 27A — operational enablement design only
Phase 27B — controlled dev/staging KPI writes with flags enabled
Phase 27C — report artifact review and redaction audit
Phase 27D — optional dashboard/Grafana wiring design
Phase 27E — production enablement RFC, only if explicitly approved
```

```text
No Phase 27 live work is approved by Phase 26H.
No production-default RFC is approved.
No PERCENT rollout is approved.
No DB migration to live is approved.
```

---

## Next allowed step

```text
No further Phase 26 work required. Suggested next safe path: Approved: start Phase 27A observability operational enablement design only — no live eval, no production default, no PERCENT rollout, no live DB migration.
```
