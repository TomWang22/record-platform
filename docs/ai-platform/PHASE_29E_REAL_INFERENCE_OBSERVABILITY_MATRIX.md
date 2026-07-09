# Phase 29E — Real-Inference Observability Matrix

```text
Phase 29E: PASS
Matrix total: 25920/25920
HTTP/1.1: 8640/8640
HTTP/2: 8640/8640
HTTP/3: 8640/8640
Fallback: 0
Wrong protocol: 0
Wrong gate: 0 (2 preview lifecycle mismatches retried clean via phase29-retry-failures.jsonl)
Leakage: 0
Response pass: 100%
Sentiment pass: 100%
Red-team safety: 100%
Evidence label: Phase 29 controlled observability production-enablement matrix: 25920/25920 target
NOT Phase 22 full parity. NOT merged into 57105/171315.
Artifact SHA: 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa
```

## Latency (rag_total_ms)

| Protocol | p50 | p90 | p95 | p99 | max |
| -------- | --- | --- | --- | --- | --- |
| HTTP/1.1 | 126 | 528.2 | 745.3 | 3273.7 | 6643.9 |
| HTTP/2 | 124.9 | 545.9 | 756.9 | 2166.9 | 6670 |
| HTTP/3 | 126.5 | 563.6 | 770.1 | 1829.5 | 7310.8 |

Artifacts: `/tmp/phase29-controlled-observability-matrix/phase29-summary.json`
