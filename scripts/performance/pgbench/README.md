# pgbench W1 / W2 / W3 harness

**PGBENCH_EXECUTION_BLOCKED**

This directory is a schema-and-template freeze for Phase 2. It is not an HTTP benchmark.

Do not run these scripts until **all** of:

1. artifact exists, parses, `schema == record-platform-outbox-publisher-parity/v1`, `status == PARITY_PASS`
2. `canonical_owner_count == 11`, `parity_pass_count == 11`, `unknowns == 0`, every row `status == PASS`
3. supplemental `auth.auth_outbox` `parity_required == false`
4. `execution_authorized == false` and `track_c_acceptance_pass == false`
5. `pgbench_execution_authorized == true` (explicit later GO — currently `false`)
6. `scripts/performance/run-pgbench-matrix.mjs` is the only entrypoint

Missing, malformed, or stale (`AUDIT_DRAFT`) evidence must `PGBENCH_EXECUTION_BLOCKED` / exit 2. Never default-allow.

`node scripts/performance/run-pgbench-matrix.mjs` must exit 2 with `PGBENCH_EXECUTION_BLOCKED` until those gates pass.

Do **not** use `infra/db/pgbench-stubs/*.sql.stub` (Track B `SELECT 1` DRY_RUN). That program is separate and must not be treated as W1/W2/W3.

## Workloads (when unblocked)

| file | purpose |
|---|---|
| `<service>/domain-only.sql` | W1 — domain mutation only |
| `<service>/domain-plus-outbox.sql` | W2 — domain + `INSERT outbox_events` same TX |
| `<service>/publisher-db-path.sql` | W3 — `FOR UPDATE SKIP LOCKED` claim + mark; Kafka **not** in pgbench |

W3 simulates broker ack **outside** the database. pgbench measures claim / lock / mark / commit cost only.

## Layout (created after parity green)

```
scripts/performance/pgbench/
  common/
    seed.sql
    cleanup.sql
    capture-db-stats.sql
  auth|media|messaging|notification|records|shopping|trust|listings|analytics|auction-monitor|ai/
    domain-only.sql
    domain-plus-outbox.sql
    publisher-db-path.sql
```

## Matrix (when unblocked)

- clients: 8, 16, 32, 64, 128, 256
- threads: 1, 2, 4, 8, 16 (never exceed clients)
- distributions: UNIFORM, ZIPFIAN_HOTSET
- modes: PER_OWNER_CEILING, ALL_OWNERS_CONCURRENT
- workloads: W1, W2, W3, WMIX
- warmup_seconds: 30
- measured_seconds: 120
- repetitions: 3
- publisher_batch_sizes: 1, 10, 25, 50
- unknowns: 0

Reports land in `reports/performance/pgbench/<run_id>/` per `report-schema.json`.
