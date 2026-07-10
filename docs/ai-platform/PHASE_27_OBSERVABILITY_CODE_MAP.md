# Phase 27 — Observability Code Map

Map from Phase 27 documents → code → drill → guards → operational status. Controlled local/dev enablement closed at `d289d0e`; this doc is explanatory only.

Archive: `PHASE_27_OBSERVABILITY_OPERATIONAL_ENABLEMENT_ARCHIVE.md`  
Operator guide: `PHASE_27_OBSERVABILITY_OPERATOR_GUIDE.md`

```text
Operational status: Phase 27 CLOSED PASS for controlled local/dev enablement proof.
Production enablement: NOT APPROVED.
KPI write paths default enabled: NO.
```

---

## Schema

| Path | Role |
|------|------|
| `infra/db/48-ai-kpi-observability.sql` | Idempotent KPI tables; applied/verified on local/dev `python_ai` @ 5440 only |

---

## Gate layer

| Path | Role |
|------|------|
| `services/python-ai-service/app/ai/config.py` | `AI_KPI_*` defaults (OFF / master disable ON) |
| `services/python-ai-service/app/ai/kpi_observability.py` | `kpi_writes_allowed`, posture snapshot, `noop_write_kpi_*` |

---

## Write paths (used by Phase 27 drill)

| Path | Channel | Table |
|------|---------|-------|
| `services/python-ai-service/app/ai/kpi_ingestion_events.py` | ingestion | `ai.ai_kpi_ingestion_events` |
| `services/python-ai-service/app/ai/kpi_searchability_checks.py` | searchability | `ai.ai_kpi_searchability_checks` |
| `services/python-ai-service/app/ai/kpi_query_observations.py` | query | `ai.ai_kpi_query_observations` |
| `services/python-ai-service/app/ai/kpi_usefulness_observations.py` | usefulness | `ai.ai_kpi_usefulness_observations` |

Phase 27 populated tiny synthetic redacted rows through these helpers — not ad hoc raw SQL for KPI payloads.

---

## Drill + guard layer

| Path | Role |
|------|------|
| `scripts/phase27-controlled-kpi-enablement-drill.py` | Local/dev schema introspect, flag enable/default-off, write-path population, disable rollback |
| `scripts/lib/phase27-operational-enablement-guard.mjs` | 27B–27H closeout + DB introspection guard |
| `scripts/phase27-operational-enablement-guard-readonly.mjs` | CLI for enablement guard |
| `tests/phase27-operational-enablement-guard.test.mjs` | Unit tests |
| `scripts/lib/phase27-archive-guard.mjs` | 27I archive/explainer guard |
| `scripts/phase27-archive-guard-readonly.mjs` | CLI for archive guard |
| `tests/phase27-archive-guard.test.mjs` | Archive guard tests |

---

## Report layer (read-only)

| Path | Role |
|------|------|
| `scripts/phase26f-combined-kpi-report-readonly.mjs` | Combined KPI report CLI; Phase 27F used `--out /tmp/phase27f-kpi-report` |
| `scripts/lib/phase26f-combined-kpi-report-readonly.mjs` | Builder + redaction + temp-dir guard |

---

## Makefile targets

```text
ai-platform-verify-phase27-operational-enablement
ai-platform-verify-phase27-archive
```

---

## Ticket closeouts (historical)

```text
docs/ai-platform/PHASE_27A_OBSERVABILITY_OPERATIONAL_ENABLEMENT_ROADMAP.md
docs/ai-platform/PHASE_27B_LOCAL_DEV_KPI_SCHEMA_APPLY_VERIFICATION.md
docs/ai-platform/PHASE_27C_CONTROLLED_KPI_FLAG_ENABLEMENT_DRILL.md
docs/ai-platform/PHASE_27D_CONTROLLED_KPI_ROW_POPULATION_DRILL.md
docs/ai-platform/PHASE_27E_CONTROLLED_QUERY_USEFULNESS_OBSERVATION_SMOKE.md
docs/ai-platform/PHASE_27F_COMBINED_KPI_REPORT_FROM_CONTROLLED_ROWS.md
docs/ai-platform/PHASE_27G_KPI_DISABLE_SWITCH_ROLLBACK_DRILL.md
docs/ai-platform/PHASE_27H_OBSERVABILITY_OPERATIONAL_ENABLEMENT_CLOSEOUT.md
docs/ai-platform/PHASE_27I_OPERATIONAL_ENABLEMENT_ARCHIVE_EXPLAINER.md
docs/ai-platform/PHASE_27_OBSERVABILITY_OPERATIONAL_ENABLEMENT_ARCHIVE.md
docs/ai-platform/PHASE_27_OBSERVABILITY_OPERATOR_GUIDE.md
docs/ai-platform/PHASE_27_OBSERVABILITY_CODE_MAP.md
```
