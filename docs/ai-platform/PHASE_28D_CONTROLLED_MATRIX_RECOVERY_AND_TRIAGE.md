# Phase 28D-R — Controlled Matrix Recovery and Triage

```text
Phase 28D-R: RECOVERY_PASS (retried failure set)
Phase 28D: IN_PROGRESS (8025/25920 before resume)
Phase 28: BLOCKED until full matrix PASS
HEAD SHA at triage: 1685716
Triage artifact: /tmp/phase28-controlled-observability-matrix/phase28-failure-triage.json
```

## Partial matrix snapshot (pre-recovery)

```text
Matrix total: 8025/25920
HTTP/1.1: 5571/8640
HTTP/2:   1188/8640
HTTP/3:   1266/8640
wrong_gate rows: 15
non-200 rows: H1=7, H2=0, H3=8
response_fail rows: 15 (all overlap non-200)
Fallback: 0
Wrong protocol: 0
Leakage: 0
```

## Failure triage summary

| Category | Count | Classification | Lifecycle bug? |
| -------- | ----- | -------------- | -------------- |
| wrong_gate | 15 | retryable (all HTTP 502/504, gate_reason undefined) | NO |
| wrong_gate true mismatch @ HTTP 200 | 0 | — | NO |
| non_200 | 15 | retryable (502×14, 504×1) | NO |
| response_fail | 15 | retryable (empty body on gateway errors) | NO |
| deterministic | 0 | — | — |
| lifecycle/enroll/revoke suspect | 0 | — | NO |

**Root cause:** Gateway transient **502/504** responses during burst probing. `ragQuery` returned without retrying 502/504; runner recorded rows with `gate_reason: undefined`, which triage counted as `wrong_gate`. Not a preview enroll/revoke or gate-parser bug.

## Runner exits / stalls by shard

| Shard | Last progress | Notes |
| ----- | ------------- | ----- |
| shard-h1 | ~5571/8640 | Stopped manually for 28D-R; 7×502/504 at window 3 run 9 |
| shard-h2 | ~1188/8640 | Stopped manually; no failures in completed rows |
| shard-h3 | ~1266/8640 | Stopped manually; 8×502 at window 1 |

Inspect logs: `/tmp/phase28-controlled-observability-matrix/runner-{h1,h2,h3}.log`

## Patches applied (28D-R)

1. `scripts/phase28-extract-controlled-matrix-failures.mjs` — grouped triage JSON
2. `scripts/phase28-summarize-controlled-matrix.mjs` — merge shards + retry overrides
3. `scripts/phase28-controlled-observability-matrix-runner.mjs` — `--retry-failures`, per-window `resetWindowEnrollments`, 502/504 retry loop
4. `scripts/lib/phase22-full-replay-common.mjs` — retry 502/503/504 in `ragQuery`; preview revoke/enroll helpers

## Recovery retry acceptance

```text
Retried probes: 15/15
wrong_gate from retried set: 0
wrong_protocol from retried set: 0
fallback from retried set: 0
non-200 from retried set: 0
response_pass from retried set: 100%
leakage from retried set: 0
Phase 28D-R recovery: PASS
```

Artifacts:

```text
/tmp/phase28-controlled-observability-matrix/phase28-retry-failures.jsonl
/tmp/phase28-controlled-observability-matrix/phase28-retry-summary.json
```

Original failed rows remain in shard JSONL; retry overrides merged at summarize time (not silently deleted).

## Next step

Resume full matrix (one runner per protocol, `T20_EVAL_RAG_PAUSE_SEC=0.15`, `--resume`). Do **not** run closeout until `25920/25920` with all gates zero.
