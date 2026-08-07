# Canary-v3 Evidence-Bound DB-Term Provenance Design

**Date:** 2026-08-06  
**Status:** design-only  
**Parent:** `2026-08-06-record-platform-performance-and-lineage-master-design.md`  
**Track:** A / Ticket 1  
**Approach:** B (schema + counters + capture + auditor + tampers ship atomically)  
**execution_authorized:** false

## Goal

Stop trusting database-equation terms merely because they appear in one JSON document. Each term is recomputed from frozen, SHA-256-bound artifacts over a common interval.

## Equation

```text
pending_delta
  = created_unpublished
  - database_acknowledged
  + reopened
  - deleted_unpublished
```

## Counters (exact names)

| Term | Series |
| --- | --- |
| `created_unpublished` | `auction_monitor_outbox_created_total` |
| `database_acknowledged` | `auction_monitor_outbox_db_acknowledged_total` |
| `reopened` | `auction_monitor_outbox_reopened_total` |
| `deleted_unpublished` | `auction_monitor_outbox_deleted_unpublished_total` |

Each counter: monotonic; low-cardinality; incremented at the actual state transition; captured at T0 and T1; frozen as raw exposition; bound by SHA-256; recomputed by the auditor.

**No aliases** to historical `auction_monitor_outbox_db_ack_total` for acceptance. Zero is valid only when the series exists at both T0 and T1 and measured delta is zero.

## Artifact layout (`<canary-root>/`)

```text
database-equation-terms.json
db-provenance/
  interval.json
  metrics/t0.prom.txt
  metrics/t0.meta.json
  metrics/t1.prom.txt
  metrics/t1.meta.json
  terms/{created_unpublished,database_acknowledged,reopened,deleted_unpublished,pending_delta}.json
  snapshots/db-t0.json
  snapshots/db-t1.json
```

## Mandatory epoch / identity fields

Every provenance interval and both scrape metas MUST include:

```json
{
  "test_run_id": "uuid",
  "source_sha": "exact-git-sha",
  "runtime_sha": "exact-runtime-sha",
  "pod_uid_t0": "uid",
  "pod_uid_t1": "uid",
  "process_start_time_t0": 0,
  "process_start_time_t1": 0,
  "counter_epoch_unchanged": true,
  "writer_count": 1
}
```

Pod restart or counter epoch change during the interval → FAIL. Do not reconstruct deltas across a reset in v1.

## Term provenance schema (`canary-v3-db-term-provenance/v1`)

Counter term example:

```json
{
  "schema": "canary-v3-db-term-provenance/v1",
  "term": "database_acknowledged",
  "value": 750,
  "source_type": "prometheus_counter_delta",
  "series": "auction_monitor_outbox_db_acknowledged_total",
  "labels": {},
  "artifact_path_t0": "db-provenance/metrics/t0.prom.txt",
  "artifact_sha256_t0": "...",
  "artifact_path_t1": "db-provenance/metrics/t1.prom.txt",
  "artifact_sha256_t1": "...",
  "interval_start_utc": "...",
  "interval_end_utc": "...",
  "start_value": 12345,
  "end_value": 13095,
  "delta": 750,
  "test_run_id": "uuid",
  "source_sha": "...",
  "runtime_sha": "...",
  "pod_uid_t0": "...",
  "pod_uid_t1": "...",
  "process_start_time_t0": 0,
  "process_start_time_t1": 0,
  "counter_epoch_unchanged": true,
  "writer_count": 1,
  "proof": {
    "kind": "prometheus_counter_delta",
    "t0_meta_path": "db-provenance/metrics/t0.meta.json",
    "t1_meta_path": "db-provenance/metrics/t1.meta.json"
  }
}
```

`pending_delta` uses `source_type: database_snapshot_delta` and `db-provenance/snapshots/db-t{0,1}.json`.

## Summary schema (`canary-v3-database-equation-terms/v2`)

Summary values are non-authoritative alone. Auditor requires `provenance_root` and recomputes all terms.

## Auditor algorithm

1. Require equation schema v2 + `db-provenance/`.
2. Verify common interval; `t0 < t1`.
3. Verify scrape SHA-256; parse exposition; require all four series.
4. Reject missing series, counter reset (`T1 < T0`), label-set drift, negative delta, interval mismatch, hash mismatch.
5. Reject `pod_uid_t0 != pod_uid_t1`, `process_start_time` drift, `counter_epoch_unchanged != true`, `writer_count != 1`.
6. Recompute each term from artifacts; require `summary value == recomputed delta`.
7. Reject column-absence / circular / overlapping provenance.
8. Verify equation identity.
9. Missing zero-term evidence → FAIL.

## Fail closed codes

```text
missing series
counter reset
label-set drift
interval mismatch
negative delta
artifact hash mismatch
summary value != recomputed delta
column-absence proof
pod_uid_changed
process_start_time_changed
counter_epoch_changed
writer_count_not_one
```

## Tamper tests

Extend `tests/auction-monitor-canary-v3-frozen-root-tamper.test.mjs` and add provenance-specific unit tests covering every fail-closed code above. Source root must remain PASS while clones FAIL.

## Out of scope

- Live one-hour window execution
- Flipping `LIVE_CAPTURE_ACCEPTANCE_READY`
- Aliasing old metric names for PASS
- Reconstructing across counter resets
