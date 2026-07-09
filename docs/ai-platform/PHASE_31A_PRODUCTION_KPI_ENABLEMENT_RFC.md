# Phase 31A — Production KPI Enablement RFC

```text
Phase 31A: PASS
Production enablement performed: NO
Production default: keyword
PERCENT=0
ALLOW_PROD_PERCENT=0
Artifact SHA: 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa
```

## Decision options

| Option | Description |
| ------ | ----------- |
| **A** | KEEP default-off, no production enablement |
| **B** | Continue staging-only KPI observability (recommended default) |
| **C** | Candidate limited production KPI enablement — requires separate owner approval naming target DB/env and rollback window |
| **D** | BLOCKED pending fixes |

**Recommended default:** Option **B** unless Phase 31 evidence is perfect and owner explicitly requests C.

## Hard stops (all options)

No production enablement in Phase 31. No PERCENT rollout. No production DB migration without named target approval. NOT merged into 57105/171315 or Phase 30 25920.

## Staging target (unchanged)

controlled staging/non-prod — `record-platform` / `python-ai-service` / `python_ai@127.0.0.1:5440` / `AI_KPI_ENVIRONMENT=staging`
