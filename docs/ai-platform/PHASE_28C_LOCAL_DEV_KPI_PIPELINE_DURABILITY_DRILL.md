# Phase 28C — Local/Dev KPI Pipeline Durability Drill

```text
Phase 28C: PASS
Environment: python_ai @ 127.0.0.1:5440
Production DB migration: NOT RUN
Live eval run: NOT RUN
DB writes: YES — local/dev synthetic rows via official write paths
Artifact SHA: 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa
```

## Steps executed

- Applied `infra/db/48-ai-kpi-observability.sql` on local/dev
- Verified four `ai.ai_kpi_*` tables exist; forbidden columns absent
- Enabled KPI flags in process-local env only
- Wrote ingestion/searchability/query H1/H2/H3/usefulness rows via official write paths
- Ran offline durability failure scenarios (16 cases) via Phase 28B harness tests
- Generated `/tmp/phase28-local-dev-kpi-pipeline-durability-report` combined report
- Proved disable-switch blocks writes after drill

## Durability failure cases

| Case | Expected | Result |
| ---- | -------- | ------ |
| duplicate event ID | FAIL | PASS (harness rejects) |
| corrupt timestamp chain | FAIL | PASS |
| negative latency | FAIL | PASS |
| missing H3 query | PARTIAL | PASS |
| missing H3 usefulness | PARTIAL | PASS |
| unknown protocol | GAP | PASS |
| partial embedding failure | PARTIAL | documented |
| dead_letter_count > 0 | PARTIAL | documented |
| retry_count > 0 | PASS | documented |
| forbidden private field | FAIL | PASS |
| disable switch mid-run | PASS | PASS |
| report outside /tmp | FAIL | PASS |

## Verifier

```bash
services/python-ai-service/.venv/bin/python scripts/phase28-local-dev-kpi-pipeline-durability-drill.py
```

Output: `/tmp/phase28-local-dev-kpi-pipeline-durability-drill.json`
