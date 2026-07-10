# Phase 32A — Latency RCA Design and Acceptance Gates

```text
Phase 32A: PASS
Scope: latency root-cause analysis and remediation design only
Production enablement: NOT APPROVED
Production default: keyword
PERCENT=0
ALLOW_PROD_PERCENT=0
Hybrid/vector production default: NOT enabled
Input evidence: Phase 31D-R2 /tmp JSONL (51840/51840 PASS)
Blocking outlier: ~1,037,645 ms max rag_total_ms
Generated reports committed: NO
Bench logs committed: NO
```

## Goal

Explain and reduce the ~1,037,645 ms max latency outlier observed during Phase 31D-R2 **before** any production KPI enablement decision. Phase 32 is **not** production enablement.

## Ticket plan

| Ticket | Scope |
| ------ | ----- |
| **32A** | RCA design + acceptance gates (this doc) |
| **32B** | Read-only latency outlier analyzer over Phase 31D-R2 JSONL |
| 32C | Timing attribution patch/design: end-to-end, curl, service, KPI-write, coordinator-wait, retry-delay |
| 32D | Controlled staging micro-soak: H1/H2/H3 with timing attribution |
| 32E | Pipeline durability under injected slow DB/KPI write path |
| 32F | Latency remediation if root cause confirmed |
| 32G | Repaired latency validation soak |
| 32H | Go/no-go: STAGING CONTINUE / BLOCKED / candidate next step |

## JSONL attribution limits (31D-R2)

Current `phase31-matrix.jsonl` rows expose `rag_total_ms` only. They do **not** include:

- `curl time_total`
- retry delay
- coordinator wait
- KPI-write duration

32B classifies max latency as `rag_total_ms` (app-reported) and marks unattributed components as **unknown from JSONL alone**. 32C must add instrumentation before claiming retry/coordinator/curl attribution.

## 32B acceptance gates

```text
PASS when:
- Analyzer reads Phase 31D-R2 shard JSONL without mutation
- Writes outputs only under /tmp/phase32-latency-rca/
- Produces top-50 outliers with protocol/case/window/run/user_class provenance
- Documents max row provenance and JSONL attribution limits
- Emits per-protocol p50/p90/p95/p99/p99.9/max
- Emits per-case, per-window, per-user-class percentiles
- Correlates outliers with monitor shard restarts / lock errors / completion gaps
- Unit tests pass on fixture rows
- make ai-platform-verify-phase32-latency-rca PASS
```

## 32B run

```bash
export PHASE31_MATRIX_ROOT=/tmp/phase31d-r2-repaired-staging-long-soak
make ai-platform-verify-phase32-latency-rca
```

## Hard stops

```text
No production enablement.
No production DB migration.
No production default change.
No PERCENT rollout.
No ALLOW_PROD_PERCENT rollout.
No generated report commits.
No bench log commits.
Do not call Phase 31 production-ready while max-latency RCA is unresolved.
```

## Expected after 32A–32B

```text
Phase 32A: PASS
Phase 32B: PASS
Latency RCA status: CLASSIFIED or BLOCKED (pending 32C instrumentation)
Max outlier explained: partial from JSONL; full attribution requires 32C
Production enablement: NOT APPROVED
Next: 32C timing attribution or remediation depending on RCA
```
