# Phase 32H packet-index lifecycle

## Problem (baseline-r9)

Mid-run, a batch packet-index was created **before** matrix append and remained
`PENDING`. The status evaluator compared index count to completed matrix batches
and reported literal `BLOCKED` for a valid **+1** in-flight lead.

Terminal quiescence correctly reached `delta=0`. Index files on the frozen R9
root were **not** rewritten.

## Required lifecycle

`PENDING` → `RUNNING` | `CORRELATING` → `COMPLETE`

Failure: `PENDING` | `RUNNING` | `CORRELATING` → `FAILED`

Completion is written atomically after three probes finish, three matrix rows are
appended, correlation completes, and the queue job is `COMPLETE`.

## Alignment classifications

| Status | Meaning |
|--------|---------|
| `ALIGNED` | indexes == completed; no active pre-matrix batch |
| `ACTIVE_TRANSIENT_LEAD` | indexes == completed + 1; extra ID == active batch; PENDING/RUNNING/CORRELATING |
| `TERMINAL_PASS` | orchestrator complete; delta 0; all indexes COMPLETE; queue quiescent |
| `BLOCKED_*` | orphan, lead > 1, deficit, ID mismatch, queue failure, malformed |

Never emit literal `BLOCKED` for a valid active +1 lead.

## Terminal summary

`buildPhase32hSummary` resolves R1 `target_total` from `phase32h-r1-launch.json`
(or R1 evidence labels). Frozen PASS outputs must not retain `IN_PROGRESS`.

## Verify

```bash
make ai-platform-verify-phase32h-packet-index-lifecycle
```

Smoke root: `/tmp/phase32h-r1-packet-index-lifecycle-smoke-v1` (90 probes / 30 batches).
