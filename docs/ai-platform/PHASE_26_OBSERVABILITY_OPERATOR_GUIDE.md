# Phase 26 — Observability Operator Guide

Practical runbook for verifying Phase 26 safely. **No live eval. No production enablement. No live DB migration.**

Related:

- Archive story: `PHASE_26_OBSERVABILITY_IMPLEMENTATION_ARCHIVE.md`
- Code map: `PHASE_26_OBSERVABILITY_CODE_MAP.md`
- Implementation closeout: commit `f09a9ef` (`PHASE_26G_OBSERVABILITY_DISABLE_SWITCH_AND_CLOSEOUT.md`)

---

## How to read Phase 26 docs

```text
How to read Phase 26 docs:
1. Start with ACTIVE_CONTEXT.md.
2. Then read PHASE_26_OBSERVABILITY_IMPLEMENTATION_ARCHIVE.md.
3. Use 26A–26G docs as historical closeout records.
4. If an older doc says a later phase is NOT STARTED, treat that as true only at the time that older doc was committed.
```

Current Phase 26 source of truth: this operator guide (for how to verify) plus the archive and `ACTIVE_CONTEXT.md` (for status). Older “Next allowed step: Phase 26G” lines in 26F are historical snapshots only.

---

## Hard stops

```text
Live eval: NOT RUN
Runtime/env/default/allowlist changes: NONE
DB writes from this guide: NO (verification only)
Migrations to live: NOT APPROVED
Production default: keyword
Preview UI/API: KEEP
PERCENT=0
ALLOW_PROD_PERCENT=0
Hybrid/vector production default: NOT APPROVED
KPI write paths default enabled: NO
```

---

## Primary verification

```bash
make ai-platform-verify-phase26-observability
```

This chains Phase 26F KPI report verification, then the Phase 26G disable-switch guard and unit tests.

### Layered verifiers (optional drill-down)

```bash
make ai-platform-verify-phase26f-kpi-report
make ai-platform-verify-phase26e-usefulness
make ai-platform-verify-phase26d-query-observations
make ai-platform-verify-phase26c-searchability
make ai-platform-verify-phase26b-ingestion
make ai-platform-verify-phase26a-schema
```

Each target includes earlier-phase guards. Prefer the top-level target for closeout confidence.

---

## Local/dev SQL schema

```text
infra/db/48-ai-kpi-observability.sql exists and is idempotent.
It was applied only to local/dev python_ai DB during validation where stated.
Do not apply to live DB without explicit approval.
```

Local/dev apply only (not live):

```bash
PGPASSWORD=postgres \
psql -h 127.0.0.1 -p 5440 -U postgres -d python_ai \
  -f infra/db/48-ai-kpi-observability.sql \
  --single-transaction --set ON_ERROR_STOP=1
```

Tables created:

```text
ai.ai_kpi_ingestion_events
ai.ai_kpi_searchability_checks
ai.ai_kpi_query_observations
ai.ai_kpi_usefulness_observations
```

---

## Default-off flags (locked posture)

```text
AI_KPI_OBSERVABILITY_MASTER_DISABLE=1
AI_KPI_OBSERVABILITY_ENABLED=0
AI_KPI_INGESTION_EVENTS_ENABLED=0
AI_KPI_SEARCHABILITY_CHECKS_ENABLED=0
AI_KPI_QUERY_OBSERVATIONS_ENABLED=0
AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED=0
```

Disable-switch behavior:

```text
AI_KPI_OBSERVABILITY_MASTER_DISABLE=1 blocks all channels.
AI_KPI_OBSERVABILITY_ENABLED=0 blocks all channels.
All channel flags default OFF.
Runtime writes enabled by default: NO.
```

Do **not** flip these in production without an explicitly approved Phase 27+ enablement plan.

---

## Report generation

```text
Phase 26F report generator is read-only.
It writes generated JSON reports to /tmp by default.
Report output is not committed.
Reports show PASS/PARTIAL/GAP depending on available ai_kpi_* rows.
```

Typical local CLI (already invoked by the Makefile target):

```bash
node scripts/phase26f-combined-kpi-report-readonly.mjs --out /tmp/phase26f-kpi-report
```

Rules:

- SELECT-only against KPI tables
- Output restricted to temp paths
- No commit of `/tmp` reports
- No raw questions, answers, JWTs, or private fields in report artifacts

With default-off writes, expect GAP/PARTIAL children when rows are empty — that is correct, not a broken verifier.

---

## What “PASS” means for operators

| Check | Meaning |
|-------|---------|
| `make ai-platform-verify-phase26-observability` PASS | Guards, tests, report generators, and disable-switch drill agree with committed design |
| Report child PASS | Enough redacted KPI rows exist for that contract |
| Report child PARTIAL / GAP | Implementation present; operational rows missing or incomplete (typical under defaults) |
| Disable switch PASS | Master disable + global off + channel offs block all four write channels |

---

## Do not do

```text
curl / kubectl against live RAG as part of Phase 26 verification
Live 57105 H1/H2/H3 replay
Enable AI_KPI_* in production without RFC approval
Apply 48-ai-kpi-observability.sql to live without approval
Commit /tmp reports, bench logs, JWTs, DB dumps, or traces
Claim operational KPI population from Phase 26 alone
```

---

## Quick posture checklist

Before claiming Phase 26 still closed:

```bash
git rev-parse --short HEAD
make ai-platform-verify-phase26-observability
```

Confirm docs still say:

```text
Phase 26: CLOSED PASS
KPI write paths default enabled: NO
Runtime writes enabled by default: NO
Production default: keyword
PERCENT=0
ALLOW_PROD_PERCENT=0
```
