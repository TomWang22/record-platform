# Phase 29 — Observability Operator Guide

Phase 29 is **CLOSED PASS**. This guide explains how to verify archive truth and interpret the production-enablement matrix without mistaking it for production rollout or Phase 22 full parity.

```text
Phase 29: CLOSED PASS
Production enablement: NOT APPROVED
Decision: CANDIDATE CONTROLLED ENABLEMENT — staging/non-prod only
25920 matrix is NOT merged into 57105/57105 or 171315/171315
```

## Primary verify commands

```bash
make ai-platform-verify-phase29-archive
make ai-platform-verify-phase29-closeout
make ai-platform-verify-phase29-preflight
```

## Evidence label

```text
Phase 29 controlled observability production-enablement matrix: 25920/25920 target
```

Matrix artifacts: `/tmp/phase29-controlled-observability-matrix/` only — **never commit**.

## Historical commands (reference only)

```bash
services/python-ai-service/.venv/bin/python scripts/phase29-pipeline-durability-drill.py
node scripts/phase29-summarize-controlled-matrix.mjs --in /tmp/phase29-controlled-observability-matrix
node scripts/phase29-generate-kpi-report-readonly.mjs /tmp/phase29-kpi-report
services/python-ai-service/.venv/bin/python scripts/phase29-disable-switch-rollback-drill.py
```

Local/dev row counts and CANDIDATE CONTROLLED ENABLEMENT do **not** mean production KPI observability is enabled.
