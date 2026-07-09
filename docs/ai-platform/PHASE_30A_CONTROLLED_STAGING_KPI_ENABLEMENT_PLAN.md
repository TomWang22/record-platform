# Phase 30A — Controlled Staging KPI Enablement Plan

```text
Phase 30A: PASS
Production enablement: NOT APPROVED
Production default: keyword
PERCENT=0
ALLOW_PROD_PERCENT=0
Artifact SHA: 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa
```

## Named staging/non-prod target

| Component | Value |
| --------- | ----- |
| Environment name | controlled staging/non-prod |
| Kubernetes namespace | `record-platform` |
| Deployment | `python-ai-service` |
| API base | `https://record-platform.test` |
| Database | `python_ai` @ `127.0.0.1:5440` |
| `AI_KPI_ENVIRONMENT` | `staging` |
| Schema | `infra/db/48-ai-kpi-observability.sql` |

**Not production.** No production DB migration.

## Enablement scope

KPI write flags enabled **only** during controlled drills/matrix in process-scoped env (`AI_KPI_*`), then rolled back via disable-switch drill.

## Evidence label (separate from Phase 22/28/29)

```text
Phase 30 controlled staging KPI enablement matrix: 25920/25920 target
NOT merged into 57105/171315 or Phase 29 25920.
```

## Rollback plan

Master disable + global off + channel off; verify row counts stable after blocked writes (30H).

## Gate chain

30B preflight → 30C schema → 30D flag drill → 30E pipeline soak → 30F matrix → 30G report → 30H rollback → 30I go/no-go → 30J archive.
