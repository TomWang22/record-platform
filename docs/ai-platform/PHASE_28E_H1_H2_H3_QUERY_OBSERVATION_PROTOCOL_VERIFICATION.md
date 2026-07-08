# Phase 28E — H1/H2/H3 Query Observation Protocol Verification

```text
Phase 28E: IN_PROGRESS (blocked on 28D matrix completion)
Controlled real inference run: IN_PROGRESS
Production DB migration: NOT RUN
Artifact SHA: 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa
```

## Protocol verification gates

| Protocol | Negotiated version | Query KPI rows | PASS requires |
| -------- | ------------------ | -------------- | ------------- |
| HTTP/1.1 | 1.1 | via official write path | 8640 rows, version_ok |
| HTTP/2 | 2 | via official write path | 8640 rows, version_ok |
| HTTP/3 | 3 | via official write path | 8640 rows, version_ok |

Query observations written through `scripts/phase28-write-matrix-kpi-rows.py` (official `write_kpi_query_observation`) with redacted metrics only.

## Latency by case (partial — see /tmp)

`phase28-latency-by-case.json` under `/tmp/phase28-controlled-observability-matrix/`

| case_id | h1_p50 | h1_p95 | h2_p50 | h2_p95 | h3_p50 | h3_p95 | response_pass_rate | sentiment_pass_rate | leakage_failures |
| ------- | ------ | ------ | ------ | ------ | ------ | ------ | ------------------ | ------------------- | ---------------- |

PASS when 28D matrix completes with zero wrong_protocol and per-protocol 8640/8640.
