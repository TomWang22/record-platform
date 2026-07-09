# Phase 30F — Real-Inference H1/H2/H3 Soak

```text
Phase 30F: PASS
Matrix total: 25920/25920
HTTP/1.1: 8640/8640
HTTP/2: 8640/8640
HTTP/3: 8640/8640
Fallback: 0
Wrong protocol: 0
Wrong gate: 0 (4 preview lifecycle mismatches retried clean)
Leakage: 0
Response pass: 100%
Sentiment pass: 100%
Red-team safety: 100%
Evidence label: Phase 30 controlled staging KPI enablement matrix: 25920/25920 target
NOT merged into 57105/171315 or Phase 29 25920.
Artifact SHA: 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa
```

## Latency (rag_total_ms)

| Protocol | p50 | p90 | p95 | p99 | max |
| -------- | --- | --- | --- | --- | --- |
| HTTP/1.1 | 189.8 | 872.1 | 1287 | 4886.9 | 8014 |
| HTTP/2 | 189.6 | 864.2 | 1274.8 | 4922 | 8107.8 |
| HTTP/3 | 189.6 | 876.4 | 1293.8 | 4880.1 | 7656.5 |

Artifacts: `/tmp/phase30-controlled-staging-matrix/phase30-summary.json`
