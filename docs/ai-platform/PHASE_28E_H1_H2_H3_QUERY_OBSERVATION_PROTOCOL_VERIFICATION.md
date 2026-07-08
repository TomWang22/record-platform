# Phase 28E — H1/H2/H3 Query Observation Protocol Verification

```text
Phase 28E: PASS — H1/H2/H3 protocol verification
Controlled real inference run: PASS
Production DB migration: NOT RUN
Artifact SHA: 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa
```

## Protocol verification gates

| Protocol | Negotiated version | Matrix rows | version_ok | Query KPI write | PASS |
| -------- | ------------------ | ----------- | ---------- | --------------- | ---- |
| HTTP/1.1 | 1.1 | 8640/8640 | 8640/8640 | 8640 PASS flags | PASS |
| HTTP/2 | 2 | 8640/8640 | 8640/8640 | 8640 PASS flags | PASS |
| HTTP/3 | 3 | 8640/8640 | 8640/8640 | 8640 PASS flags | PASS |

Query observations written through `scripts/phase28-write-matrix-kpi-rows.py` (official `write_kpi_query_observation`) with redacted metrics only. No raw prompt/response/JWT/private fields in matrix JSONL.

## Latency by protocol

| Protocol | p50 | p90 | p95 | p99 | max |
| -------- | --- | --- | --- | --- | --- |
| HTTP/1.1 | 143.0 | 619.1 | 880.7 | 1771.3 | 16020.1 |
| HTTP/2 | 151.9 | 643.9 | 972.8 | 3937.0 | 6809.2 |
| HTTP/3 | 150.5 | 663.7 | 971.0 | 4743.9 | 7725.0 |

## Latency by case (p50 / p95 ms)

| case_id | h1_p50 | h1_p95 | h2_p50 | h2_p95 | h3_p50 | h3_p95 | response_pass_rate | sentiment_pass_rate | leakage_failures |
| ------- | ------ | ------ | ------ | ------ | ------ | ------ | ------------------ | ------------------- | ---------------- |
| listing_advice | 121.0 | 692.2 | 130.3 | 722.7 | 126.0 | 755.6 | 1 | — | 0 |
| negotiation_strategy | 129.6 | 674.1 | 137.5 | 783.6 | 139.6 | 715.3 | 1 | — | 0 |
| buyer_psychology | 149.9 | 746.7 | 161.3 | 848.2 | 155.1 | 950.1 | 1 | 1 | 0 |
| auction_pressure | 139.4 | 854.1 | 151.0 | 988.3 | 152.5 | 899.7 | 1 | — | 0 |
| collector_metadata | 131.7 | 697.5 | 141.8 | 745.5 | 138.7 | 760.2 | 1 | — | 0 |
| pricing_strategy | 141.5 | 786.9 | 153.0 | 975.4 | 146.8 | 955.9 | 1 | — | 0 |
| daily_action_plan | 143.7 | 758.1 | 146.7 | 847.1 | 146.1 | 822.4 | 1 | — | 0 |
| red_team_overclaim | 148.7 | 909.3 | 152.9 | 967.1 | 158.7 | 933.9 | 1 | — | 0 |
| final_tagged_plan | 172.7 | 1406.8 | 181.1 | 1388.2 | 182.5 | 1434.6 | 1 | — | 0 |

Source: `/tmp/phase28-controlled-observability-matrix/phase28-latency-by-case.json`

Usefulness evidence label present for Phase 28 matrix and Phase 22C sample (via combined KPI report).
