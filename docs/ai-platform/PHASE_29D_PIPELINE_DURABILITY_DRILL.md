# Phase 29D — Pipeline Durability Drill

```text
Phase 29D: PASS
Target: local/dev python_ai @ 127.0.0.1:5440
Artifact SHA: 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa
Output: /tmp/phase29-pipeline-durability-drill.json (status=PASS)
```

## Run

```bash
services/python-ai-service/.venv/bin/python scripts/phase29-pipeline-durability-drill.py
```

Output: `/tmp/phase29-pipeline-durability-drill.json`

## Required row counts (official write paths)

```text
ingestion >= 1
searchability >= 1
query observations: H1 >= 1, H2 >= 1, H3 >= 1
usefulness observations: H1/H2/H3 + Phase 22C sample label >= 1 each
```

## Failure scenarios

| Scenario | Expected |
| -------- | -------- |
| duplicate event id | FAIL |
| corrupt timestamp chain | FAIL |
| negative latency | FAIL |
| missing H3 query | PARTIAL |
| missing H3 usefulness | PARTIAL |
| unknown protocol | GAP (does not count as H1/H2/H3) |
| disable switch mid-run | stops remaining writes |
| report outside /tmp | rejected |
| private fields in payload | rejected |
