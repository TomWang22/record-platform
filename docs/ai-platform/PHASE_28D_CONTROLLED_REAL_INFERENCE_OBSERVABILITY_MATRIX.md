# Phase 28D — Controlled Real-Inference Observability Matrix

```text
Phase 28D: PASS — 25920/25920
Evidence label: Phase 28 controlled observability production-readiness matrix: 25920/25920 target
Live eval run: NOT RUN
Controlled real inference run: PASS
Production DB migration: NOT RUN
Runtime/env/default/allowlist changes: NONE (local dev KPI flags toggled during matrix only)
Bench logs committed: NO
Generated reports committed: NO
Artifact SHA: 1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa
```

**Not merged into:** 57105/57105, 171315/171315, Phase 22C 7200/7200.

## Matrix shape

```text
3 protocols × 16 windows × 6 users × 10 runs × 9 Phase-21 cases = 25,920 probes
HTTP/1.1: 8640/8640
HTTP/2:   8640/8640
HTTP/3:   8640/8640
```

## Final gates

```text
Matrix total: 25920/25920
HTTP 200: 25920/25920
Fallback count: 0
Wrong protocol count: 0
Wrong gate count: 0 (15 transient 502/504 rows retried clean via 28D-R)
Leakage failures: 0
Response pass rate: 100%
Sentiment pass rate: 100%
Red-team safety pass rate: 100%
```

## Latency by protocol (merged /tmp summary with retry overrides)

| Protocol | count | HTTP 200 | p50 | p90 | p95 | p99 | max | fallback | wrong_protocol | wrong_gate |
| -------- | ----- | -------- | --- | --- | --- | --- | --- | -------- | -------------- | ---------- |
| HTTP/1.1 | 8640 | 8640 | 143.0 | 619.1 | 880.7 | 1771.3 | 16020.1 | 0 | 0 | 0 |
| HTTP/2 | 8640 | 8640 | 151.9 | 643.9 | 972.8 | 3937.0 | 6809.2 | 0 | 0 | 0 |
| HTTP/3 | 8640 | 8640 | 150.5 | 663.7 | 971.0 | 4743.9 | 7725.0 | 0 | 0 | 0 |

Live artifacts: `/tmp/phase28-controlled-observability-matrix/phase28-latency-by-protocol.json`

Recovery record: `PHASE_28D_CONTROLLED_MATRIX_RECOVERY_AND_TRIAGE.md`

## Runner

```bash
export T20_EVAL_RAG_PAUSE_SEC=0.15
for p in h1 h2 h3; do
  node scripts/phase28-controlled-observability-matrix-runner.mjs \
    --protocol $p --windows 16 --runs 10 \
    --out /tmp/phase28-controlled-observability-matrix/shard-$p --resume &
done
node scripts/phase28-summarize-controlled-matrix.mjs \
  --in /tmp/phase28-controlled-observability-matrix
node scripts/phase28-finalize-closeout.mjs
```
