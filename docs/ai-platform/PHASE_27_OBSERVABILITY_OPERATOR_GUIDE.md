# Phase 27 — Observability Operator Guide

Practical runbook for verifying Phase 27 safely. **No production enablement. No live DB migration. No 57105 replay. No live RAG matrix.**

Related:

- Archive: `PHASE_27_OBSERVABILITY_OPERATIONAL_ENABLEMENT_ARCHIVE.md`
- Code map: `PHASE_27_OBSERVABILITY_CODE_MAP.md`
- Closeout: `PHASE_27H_OBSERVABILITY_OPERATIONAL_ENABLEMENT_CLOSEOUT.md` (`15d8d08`)

---

## How to read Phase 27 docs

```text
1. Start with ACTIVE_CONTEXT.md.
2. Then read PHASE_27_OBSERVABILITY_OPERATIONAL_ENABLEMENT_ARCHIVE.md.
3. Use 27A–27H docs as historical ticket closeouts.
4. Local/dev row counts prove write paths — not production enablement.
```

---

## Hard stops

```text
Live eval: NOT RUN
57105 replay: NOT RUN
Production DB migration: NOT RUN
Production enablement: NOT APPROVED
Production default: keyword
PERCENT=0
ALLOW_PROD_PERCENT=0
Hybrid/vector production default: NOT APPROVED
KPI write paths default enabled: NO
Generated KPI reports committed: NO
Bench logs committed: NO
```

---

## Primary verification

```bash
make ai-platform-verify-phase27-operational-enablement
make ai-platform-verify-phase27-archive
```

`ai-platform-verify-phase27-operational-enablement` chains Phase 26 observability checks, regenerates `/tmp` combined KPI reports (read-only SELECT), and runs the Phase 27 enablement guard (including local/dev row-count introspection when Postgres is available).

`ai-platform-verify-phase27-archive` runs that verifier plus the Phase 27I archive guard.

---

## How to interpret row counts

Local/dev controlled drill proven counts:

```text
ingestion=1
searchability=1
query=3
usefulness=4
```

Important meaning:

```text
These are local/dev synthetic redacted rows.
They prove write paths and report generation work.
They do not mean production KPI observability is enabled.
They do not mean operational population is approved.
They do not authorize production migration or feature flag enablement.
```

Optional local/dev introspection (read-only):

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 5440 -U postgres -d python_ai -c "
SELECT 'ingestion' AS t, count(*) FROM ai.ai_kpi_ingestion_events
UNION ALL SELECT 'searchability', count(*) FROM ai.ai_kpi_searchability_checks
UNION ALL SELECT 'query', count(*) FROM ai.ai_kpi_query_observations
UNION ALL SELECT 'usefulness', count(*) FROM ai.ai_kpi_usefulness_observations;
"
```

Do **not** insert more rows unless a later phase explicitly approves a controlled drill.

---

## Drill script (already executed in 27B–27G)

```text
scripts/phase27-controlled-kpi-enablement-drill.py
```

Uses official write paths against `python_ai@127.0.0.1:5440` with process-local flags, then restores disable-switch posture. Re-running it duplicates synthetic rows — only re-run if an owner explicitly asks.

---

## Combined report (`/tmp` only)

```bash
node scripts/phase26f-combined-kpi-report-readonly.mjs --out /tmp/phase27f-kpi-report
```

```text
Reports write under /tmp only.
Do not commit generated JSON.
Child statuses reflect available ai_kpi_* rows (PASS/PARTIAL/GAP).
```

---

## Default-off reminder

Committed config still defaults to:

```text
AI_KPI_OBSERVABILITY_MASTER_DISABLE=1
AI_KPI_OBSERVABILITY_ENABLED=0
AI_KPI_INGESTION_EVENTS_ENABLED=0
AI_KPI_SEARCHABILITY_CHECKS_ENABLED=0
AI_KPI_QUERY_OBSERVATIONS_ENABLED=0
AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED=0
```

---

## Next allowed step

```text
Approved: start Phase 28A observability production-readiness design only after Phase 27 archive PASS — no live eval, no production default, no PERCENT rollout, no production DB migration.
```
