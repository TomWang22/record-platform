# Phase 28G — Disable-Switch Rollback Drill

```text
Phase 28G: PASS — disable-switch rollback
Production default: keyword (unchanged)
PERCENT: 0
ALLOW_PROD_PERCENT: 0
Hybrid/vector production default: NOT APPROVED
Runtime writes enabled: NO
Artifact SHA: 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa
```

## Rollback drill

```bash
services/python-ai-service/.venv/bin/python scripts/phase28-disable-switch-rollback-drill.py
```

Proved:

- `AI_KPI_OBSERVABILITY_MASTER_DISABLE=1` blocks all channels
- `AI_KPI_OBSERVABILITY_ENABLED=0` blocks all channels
- All channel flags OFF blocks writes
- Row counts unchanged after blocked write attempts
- Local dev deployment KPI env re-disabled (kubectl set env rollback)

Output: `/tmp/phase28-disable-switch-rollback-drill.json`

Included in `node scripts/phase28-finalize-closeout.mjs`.
