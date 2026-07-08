# Phase 28 — Observability Operator Guide

Phase 28 is **CLOSED PASS**. This guide explains how to verify archive truth and interpret controlled matrix evidence without mistaking it for Phase 22 full parity or production rollout.

```text
Phase 28: CLOSED PASS
Production enablement: NOT APPROVED
25920 matrix is NOT merged into 57105/57105 or 171315/171315
```

---

## Primary verify commands

```bash
make ai-platform-verify-phase28-archive
make ai-platform-verify-phase28-closeout
make ai-platform-verify-phase28-production-readiness
```

---

## What the 25920 matrix means

```text
3 protocols × 16 windows × 6 users × 10 runs × 9 cases = 25,920 probes
Evidence label: Phase 28 controlled observability production-readiness matrix: 25920/25920 target
```

- **Is:** controlled observability production-readiness validation on local/dev.
- **Is not:** Phase 22 full parity replay (57105/57105 per protocol).
- **Is not:** production KPI enablement or rollout approval.

Matrix artifacts live under `/tmp/phase28-controlled-observability-matrix/` only — **never commit**.

---

## Historical run commands (reference only — do not re-run unless explicitly approved)

```bash
# 28C local/dev durability
services/python-ai-service/.venv/bin/python scripts/phase28-local-dev-kpi-pipeline-durability-drill.py

# 28D/E controlled matrix (completed)
export T20_EVAL_RAG_PAUSE_SEC=0.15
node scripts/phase28-controlled-observability-matrix-runner.mjs --protocol h1 --windows 16 --runs 10 \
  --out /tmp/phase28-controlled-observability-matrix/shard-h1 --resume

# Summarize merged shards (+ retry overrides)
node scripts/phase28-summarize-controlled-matrix.mjs --in /tmp/phase28-controlled-observability-matrix

# Closeout bundle (matrix merge + /tmp KPI report + rollback drill)
node scripts/phase28-finalize-closeout.mjs
```

Recovery (28D-R): `scripts/phase28-extract-controlled-matrix-failures.mjs` + `--retry-failures`.

---

## KPI report (28F)

```bash
node scripts/phase28-generate-kpi-report-readonly.mjs /tmp/phase28-kpi-report
```

Output stays in `/tmp` only. **Generated reports committed: NO.**

Local/dev row counts from the matrix run do not mean production KPI observability is enabled by default.

---

## Disable-switch rollback (28G)

```bash
services/python-ai-service/.venv/bin/python scripts/phase28-disable-switch-rollback-drill.py
```

Proves master disable / global off / channel off block writes and row counts stay unchanged.

---

## Hard stops (still in force)

- No production DB migration
- No production default / PERCENT / allowlist changes
- No bench log or generated report commits
- No claiming 25920 is added to 57105 or 171315 totals
- Artifact SHA: 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa

---

## Next allowed step

```text
Approved: start Phase 29A observability production enablement RFC/design only after Phase 28 archive PASS — no live eval, no production default, no PERCENT rollout, no production DB migration, no production KPI enablement.
```
