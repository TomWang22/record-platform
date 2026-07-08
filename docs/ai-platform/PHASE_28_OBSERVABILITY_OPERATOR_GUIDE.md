# Phase 28 — Observability Operator Guide

## Verify offline gates

```bash
make ai-platform-verify-phase28-production-readiness
```

## Run local/dev durability (28C)

```bash
services/python-ai-service/.venv/bin/python scripts/phase28-local-dev-kpi-pipeline-durability-drill.py
```

## Run controlled matrix (28D/E)

```bash
export T20_EVAL_RAG_PAUSE_SEC=0.05
bash scripts/phase28-run-controlled-matrix-parallel.sh
# or resume shards individually with --resume
```

Outputs under `/tmp/phase28-controlled-observability-matrix/` only — never commit.

## Finalize closeout

```bash
node scripts/phase28-finalize-closeout.mjs
make ai-platform-verify-phase28-closeout
```

Phase 28 status: CLOSED PASS (25920/25920 controlled matrix).

## Hard stops

- No production DB migration
- No production default / PERCENT / allowlist changes
- No bench log or generated report commits
- Artifact SHA: 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa
