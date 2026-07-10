# Phase 32C — Timing Attribution Instrumentation

```text
Phase 32C: PASS
Scope: matrix probe timing attribution instrumentation (no live eval in 32C)
Production enablement: NOT APPROVED
Production default: keyword
PERCENT=0
ALLOW_PROD_PERCENT=0
Hybrid/vector production default: NOT enabled
Max outlier explained: NO — 32D micro-soak required
Generated reports committed: NO
Bench logs committed: NO
```

## Goal

Add per-probe timing attribution fields so Phase 32D micro-soak can explain whether the ~1,037,645 ms outlier came from app RAG time, curl/end-to-end time, coordinator wait, retry delay, KPI writes, process stall, or monitor/shard restart behavior.

## JSONL timing block

Each new matrix probe row includes a redacted `timing` object:

```json
{
  "timing": {
    "probe_started_at": "ISO",
    "probe_finished_at": "ISO",
    "wall_total_ms": 0,
    "curl_time_total_ms": 0,
    "rag_total_ms": 0,
    "coordinator_wait_ms": 0,
    "window_reset_ms": 0,
    "pre_probe_gate_verify_ms": 0,
    "retry_count": 0,
    "retry_delay_ms": 0,
    "kpi_query_write_ms": 0,
    "kpi_usefulness_write_ms": 0,
    "jsonl_write_ms": 0,
    "unattributed_ms": 0
  }
}
```

## Attribution formulas

```text
wall_total_ms = probe_finished_at - probe_started_at

known_ms =
  coordinator_wait_ms
  + window_reset_ms
  + pre_probe_gate_verify_ms
  + curl_time_total_ms
  + retry_delay_ms
  + kpi_query_write_ms
  + kpi_usefulness_write_ms
  + jsonl_write_ms

unattributed_ms = max(0, wall_total_ms - known_ms)
```

`rag_total_ms` inside `timing` is **app-reported** when the API returns it (`details.rag_total_ms`). It is stored separately from `curl_time_total_ms` and must not be treated as curl time.

Top-level `rag_total_ms` remains for Phase 31 summary compatibility: app-reported when available, otherwise falls back to curl time for legacy percentile tables. Phase 32D analysis must use `timing.*` fields.

## Instrumentation points

| Field | Source |
| ----- | ------ |
| `curl_time_total_ms` | curl `time_total` on `/api/ai/rag/query` |
| `rag_total_ms` | app response body when present; else `null` in `timing` |
| `coordinator_wait_ms` | `PreviewWindowCoordinator.enterWindow` wait-for-previous-window |
| `window_reset_ms` | preview revoke/enroll + gate verify on first probe per window |
| `retry_count` / `retry_delay_ms` | outer probe loop + inner `ragQuery` retries |
| `kpi_query_write_ms` | `phase31-write-matrix-kpi-rows.py` subprocess (combined query+usefulness) |
| `kpi_usefulness_write_ms` | `0` until helper split in 32D+ |
| `jsonl_write_ms` | JSONL append for probe row |

Window-level coordinator/reset costs attach to the **first probe** in each window only.

## Hard stops

```text
No raw prompt/response in JSONL.
No JWT/password/private message/proxy max bid.
No generated report commits.
No bench log commits.
No production enablement.
No production DB migration.
No production default change.
No PERCENT rollout.
```

## Verify

```bash
make ai-platform-verify-phase32-timing-attribution
make ai-platform-verify-phase32-latency-rca
```

## Next

Phase 32D — controlled H1/H2/H3 micro-soak with timing attribution to reproduce or rule out the ~17-minute outlier.
