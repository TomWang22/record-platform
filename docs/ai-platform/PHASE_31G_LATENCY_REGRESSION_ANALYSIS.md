# Phase 31G — Latency and Regression Analysis

```text
Phase 31G: PASS
Output: /tmp/phase31d-r2-repaired-staging-long-soak/phase31-latency-regression.json
Baseline: /tmp/phase30-controlled-staging-matrix/phase30-summary.json
Regression flags: p50/p95 elevated vs Phase 30 baseline (2× scale soak); p99 within tolerance
Production enablement: NOT APPROVED
```

## Latency (31D-R2)

| Protocol | p50 | p95 | p99 | max |
| -------- | --- | --- | --- | --- |
| HTTP/1.1 | 308.6 | 2124.6 | 5296.2 | 1037645.8 |
| HTTP/2 | 307.3 | 2041.3 | 5296.7 | 1037617.7 |
| HTTP/3 | 308.9 | 2081.4 | 5306.1 | 1037626.1 |

```bash
export PHASE31_MATRIX_ROOT=/tmp/phase31d-r2-repaired-staging-long-soak
node scripts/phase31-latency-regression-analysis.mjs \
  --in "$PHASE31_MATRIX_ROOT" \
  --out "$PHASE31_MATRIX_ROOT/phase31-latency-regression.json"
```
