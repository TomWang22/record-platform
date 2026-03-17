# Cold Tuning and Pgbench

## Cold-first benchmarking

For representative **cold** performance (no warm cache), measure after a Postgres restart:

1. **Restart Postgres** (or the container) so shared_buffers and OS cache are cold.
2. **Apply tuning**: `./scripts/apply-cold-pg-tuning.sh` (or rely on existing gold defaults).
3. **Run pgbench** (e.g. via `run-preflight-scale-and-all-suites.sh` step 8, or `run_pgbench_sweep.sh`).

Hot tuning (prewarm, hot tenant, hot sharding) is secondary; cold behavior is the key baseline.

## PG tuning (raw, no pgbouncer)

- **No pgbouncer**: Benchmarks and tuning target raw Postgres connections. Connection reuse is handled inside the pgbench scripts (same DSN, connection pooling in app layer when applicable).
- **Critical GUCs** (aligned with `run_pgbench_sweep.sh` and `scripts/apply-cold-pg-tuning.sh`):
  - `jit = off` — disable JIT for small queries and consistent latency.
  - `synchronous_commit = off` — disable sync WAL for benchmark TPS (acceptable for non-durability-critical benchmarks).
  - `work_mem`, `effective_cache_size`, `random_page_cost`, `cpu_*` — gold planner defaults (see `infra/db/12-apply-gold-defaults.sql` and `apply-cold-pg-tuning.sh`).

Apply to all 8 instances:

```bash
./scripts/apply-cold-pg-tuning.sh
```

Enforce script (schemas + gold defaults) also applies per-DB tuning; cold script adds `synchronous_commit=off` at database level for raw connections.

## Pgbench: randomized queries and Little's law

- **Randomized queries**: In `run_pgbench_sweep.sh`, the **random** variant uses multiple `-f` files (`bench_random_q1.sql` … `bench_random_q5.sql`). Each pgbench client (VU) picks one of these at random per transaction, so each VU exercises different query shapes and reflects realistic mixed workload.
- **Each schema**: Preflight step 8 runs pgbench sweeps for all 8 schemas (records, social, auth, shopping, listings, analytics, auction_monitor, python_ai). Each uses the same tuning (PGOPTIONS: jit=off, synchronous_commit=off, work_mem, etc.).
- **Little's law**: Latency estimate is computed as `lat_est_ms = 1000 * clients / tps` (physics-based). Used for sanity checks and reporting.

Ensure `PGBENCH_RANDOMIZED=1` (or equivalent) when you want the random multi-file variant.

## Indexes: trigram, KNN, GIST, and dropping unused

- **Trigram / KNN / GIST**: Applied via `infra/db/43-optimize-knn-trgm.sql`, `44-optimize-planner.sql`, and service-specific tuning. These improve fuzzy search and ANN-style lookups.
- **Drop unused or unhelpful indexes**: Identify with `pg_stat_user_indexes` (low `idx_scan`) and `pg_stat_user_tables` (seq_scan vs index_scan). Drop only after confirming they are not used for critical queries or constraints. Hot tenant / hot sharding can keep a small set of targeted indexes; cold path benefits from removing write-heavy indexes that are rarely read.

## Order of operations

1. **Cold**: Restart DB(s).
2. **Tuning**: Run `apply-cold-pg-tuning.sh` (and enforce schemas/tuning if needed).
3. **Seed**: Run `seed-all-eight-databases.sh` with `REALISTIC=1` and desired `ROWS_PER_SCHEMA` (e.g. 1–2M).
4. **Pgbench**: Run full preflight (including step 8) or `run_pgbench_sweep.sh` per schema with randomized variant for real performance signal.
