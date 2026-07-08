# Phase 28G — Disable-Switch Rollback Drill

```text
Phase 28G: NOT STARTED (run after 28F /tmp report)
Production default: keyword (unchanged)
PERCENT: 0
ALLOW_PROD_PERCENT: 0
Artifact SHA: 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa
```

## Rollback steps

```bash
services/python-ai-service/.venv/bin/python scripts/phase28-disable-switch-rollback-drill.py
```

Proves:

- Master disable ON, global observability OFF, all channel flags OFF
- No-op writes return None for ingestion/searchability/query/usefulness
- Row counts unchanged after blocked write attempts
- Local dev deployment KPI env re-disabled (kubectl set env rollback)

Output: `/tmp/phase28-disable-switch-rollback-drill.json`

Included in `node scripts/phase28-finalize-closeout.mjs`.
