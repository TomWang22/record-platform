# Phase 28D — Controlled Real-Inference Observability Matrix

```text
Phase 28D: IN_PROGRESS (controlled matrix running — resume with --resume)
Evidence label: Phase 28 controlled observability production-readiness matrix: 25920/25920 target
Live eval run: NOT RUN
Controlled real inference run: IN_PROGRESS
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
HTTP/1.1: 8,640 target
HTTP/2:   8,640 target
HTTP/3:   8,640 target
```

## Runner

```bash
# parallel shards (recommended)
export T20_EVAL_RAG_PAUSE_SEC=0.05
for p in h1 h2 h3; do
  node scripts/phase28-controlled-observability-matrix-runner.mjs \
    --protocol $p --windows 16 --runs 10 \
    --out /tmp/phase28-controlled-observability-matrix/shard-$p --resume &
done
# finalize when all shards complete
node scripts/phase28-finalize-closeout.mjs
```

## Latency by protocol (partial snapshot — updates in /tmp)

| Protocol | count | HTTP 200 | p50 | p90 | p95 | p99 | max | fallback | wrong_protocol | wrong_gate |
| -------- | ----- | -------- | --- | --- | --- | --- | --- | -------- | -------------- | ---------- |
| HTTP/1.1 | see /tmp | see /tmp | see /tmp | see /tmp | see /tmp | see /tmp | see /tmp | 0 | 0 | see /tmp |
| HTTP/2 | see /tmp | see /tmp | see /tmp | see /tmp | see /tmp | see /tmp | see /tmp | 0 | 0 | 0 |
| HTTP/3 | see /tmp | see /tmp | see /tmp | see /tmp | see /tmp | see /tmp | see /tmp | 0 | 0 | see /tmp |

Read live values: `/tmp/phase28-controlled-observability-matrix/phase28-latency-by-protocol.json`

## Gate expectations

- N5 preview participants: `preview_opt_in` when enrolled
- Contract control: `allowlist`
- `keyword_default` during matrix: **0**

## PASS criteria

```text
Matrix total: 25920/25920
HTTP/1.1: 8640/8640
HTTP/2: 8640/8640
HTTP/3: 8640/8640
Fallback count: 0
Wrong protocol count: 0
Wrong gate count: 0
Leakage failures: 0
```

Until all criteria met: **Phase 28: BLOCKED** — do not close out.
