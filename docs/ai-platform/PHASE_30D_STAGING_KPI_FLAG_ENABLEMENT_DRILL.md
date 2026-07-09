# Phase 30D — Staging KPI Flag Enablement Drill

```text
Phase 30D: PASS
Target: controlled staging/non-prod python_ai @ 127.0.0.1:5440
Output: /tmp/phase30-staging-kpi-flag-enablement-drill.json (status=PASS)
```

```bash
services/python-ai-service/.venv/bin/python scripts/phase30-staging-kpi-flag-enablement-drill.py
```

Output: `/tmp/phase30-staging-kpi-flag-enablement-drill.json`

Proves process-scoped enablement with `AI_KPI_ENVIRONMENT=staging` and default-off posture restored after drill.
