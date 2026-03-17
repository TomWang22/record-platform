# pgbench Script Hardening (Reference: run_pgbench_sweep.sh)

This document defines the reference harness used by `scripts/run_pgbench_sweep.sh` (records DB, port 5433) and what all service-specific pgbench scripts should align to. Target: consistent regression detection, TPS highlighting, tuning suggestions, and planner-stability (EXPLAIN ANALYZE, plan_cache_mode, etc.).

## Reference script and TPS target

- **Records (port 5433)**: `scripts/run_pgbench_sweep.sh` — gold reference; RESTORE-GOLD-PERFORMANCE.md.gz documents the target.
- **TPS target**: Tune so the system sustains **1k–5.1k TPS consistently** even when observability (metrics, tracing, logs) is consuming CPU. This is the bar for production readiness; regression tests should flag drops below this range.

## Checklist for all service pgbench scripts

Each `run_*_pgbench_sweep.sh` (social, auth, shopping, python-ai, listings, auction-monitor, analytics) should have:

### 1. Regression and diff mode

- **REG_THRESH_TPS_DROP** (default 0.15): 15% TPS drop vs baseline = regression.
- **REG_THRESH_P95_INCREASE** (default 0.25): 25% p95 increase = regression.
- **RUN_DIFF_MODE** (default false): When true, compare current run to BASELINE_CSV.
- **BASELINE_CSV**: Path to golden CSV for diff (e.g. from a known-good run).

Use the same pattern as `run_pgbench_sweep.sh`: after writing results CSV, if RUN_DIFF_MODE=true and BASELINE_CSV is set, run a small diff (e.g. Python or awk) to flag TPS/p95 regressions.

### 2. TPS highlight and latency

- **Peak TPS summary**: At end of run, print per-variant peak TPS and client count (e.g. "Peak forum_post: 1234 TPS @ 64 clients (lat_est: 51.8 ms)").
- **lat_est_ms**: Store in CSV (Little's Law: 1000*clients/tps). Use for sanity checks and regression.

### 3. Tuning suggestions

- At end of run, print a short "Tuning suggestions" block that points to:
  - This doc and the reference script.
  - EXPLAIN ANALYZE (RUN_PLAN_DUMP) to avoid planner lag/lying.
  - Key GUCs: work_mem, effective_cache_size, random_page_cost, synchronous_commit=off, jit=off.
  - For 7–8 figure row counts: partitioning, VACUUM strategy, index maintenance, and re-running EXPLAIN ANALYZE after stats updates.

### 4. Planner stability (prevent planner lag/lying)

- **RUN_PLAN_DUMP** (default true): Run EXPLAIN ANALYZE on representative queries before/after sweep; log to LOG_DIR.
- **statement_timeout**, **lock_timeout**, **idle_in_transaction_session_timeout**: Prevent runaway queries and stuck transactions.
- **plan_cache_mode=force_generic_plan**: Reduces planning overhead and plan flapping at high concurrency.
- **join_collapse_limit=1**, **from_collapse_limit=1**: Reduces join/from planning variability.
- **deadlock_timeout**: Faster deadlock detection (e.g. 500ms).

Reference script sets these via PGOPTIONS; service scripts should include the same where applicable.

### 5. Harness parity and uniformity first

- **enforce_critical_pgoptions**: All pgbench scripts (records and every service) must call this so **jit=off** and **synchronous_commit=off** are never overridden. Apply uniformity of tuning *before* any other pg_settings so baseline is consistent; then tune other GUCs per service if needed.
- **check_disk_space**: All sweeps (records and every service) run a pre-flight disk check; refuse when host disk >95%, warn when >90%. Skip with `SKIP_DISK_CHECK=true`.
- **wait_for_db_ready**: All sweeps ensure the target DB is reachable and not in recovery before running (port-aware per service).
- **LOG_DIR**: All EXPLAIN and diagnostics under a timestamped LOG_DIR; CSV and plots in a known location.
- **Regression diff**: All service sweeps support `RUN_DIFF_MODE=true` and `BASELINE_CSV=<path>`; when set, a Python diff compares current sweep CSV to baseline and prints REGRESSION lines for TPS/p95 drops (using `REG_THRESH_TPS_DROP`, `REG_THRESH_P95_INCREASE`).

### 6. Scale plan (7–8 figure row counts)

When scaling to millions/tens of millions of rows across all DBs:

- Re-run EXPLAIN ANALYZE after major data loads and ANALYZE.
- Consider partitioning for hot tables (e.g. records, forum.posts, messages).
- Monitor pg_stat_user_tables (n_live_tup, n_dead_tup, last_vacuum, last_analyze).
- Use same regression and TPS targets (1k–5.1k TPS consistently, even with observability overhead) as guardrails; tune work_mem, shared_buffers, and checkpoint/WAL settings per instance.

## Connection pool and observability

- **No pgbouncer**: Benchmarks and production use direct Postgres connections; connection reuse is per-client (pgbench uses one connection per client, reused for the run).
- **Postgres max_connections**: All 8 DBs use **max_connections=800** (within 500–1000 target) in docker-compose; no external pooler.
- **Observability**: Preflight keeps observability **on** (1 pod each: Grafana, Prometheus, OTel, Jaeger) for clean metrics. Set **REDUCE_OBSERVABILITY_FOR_BENCH=1** only if you want to scale otel-collector to 0 during pgbench for maximum TPS.

## Service scripts and ports

| Script | Port | DB / schemas |
|--------|------|--------------|
| run_pgbench_sweep.sh | 5433 | records |
| run_social_pgbench_sweep.sh | 5434 | forum, messages |
| run_auth_pgbench_sweep.sh | 5437 | auth |
| run_listings_pgbench_sweep.sh | 5435 | listings |
| run_shopping_pgbench_sweep.sh | 5436 | shopping |
| run_auction-monitor_pgbench_sweep.sh | 5438 | auction-monitor |
| run_analytics_pgbench_sweep.sh | 5439 | analytics |
| run_python-ai_pgbench_sweep.sh | 5440 | python-ai |

All should expose the same env toggles (REG_*, RUN_DIFF_MODE, BASELINE_CSV, RUN_PLAN_DUMP, timeouts, plan_cache_mode) and end with Peak TPS + tuning suggestions.

## Port 5433 (records) verification and load

- **Reference backup**: `backups/record-platform-postgres-1-all-20260101-223214.sql` (or latest `record-platform-postgres-1-all-*.sql`) is the canonical full dump: records + records_hot, auth, listings, analytics, bench, etc. Restore/load logic prefers this pattern, then any `*.sql`, then `*.dump`.
- **Check whether port 5433 has data**: Run `./scripts/check-records-db.sh`. It reports row count for `records.records` and exits 1 if Postgres is unreachable.
- **Load from backups**: Run `./scripts/check-records-db.sh --load`. If rows &lt; 1M, it tries `record-platform-postgres-1-all-*.sql` first, then any `backups/*.sql`, then `backups/*.dump` via `restore-to-external-docker.sh`, then **load-records-millions.sh** if no suitable backup (inserts up to 2.5M rows in batches).
- **Load millions directly**: Run `TARGET_ROWS=2500000 ./scripts/load-records-millions.sh`. Requires `records.records` table to exist (migrations). Then run the sweep or check-records-db to verify.
- **From run_pgbench_sweep.sh**: Set `CHECK_RECORDS_DB=true` to run the check (and optional load) before step 0. Same logic is used inside the sweep when DB is missing or has &lt; 1M rows.

## Millions of data and meaningful tests

- **Records (port 5433)**: For meaningful benchmarks use 2.4M+ rows. Prefer the reference backup `record-platform-postgres-1-all-*.sql` in `backups/` (full dump with records + records_hot, auth, listings, etc.); `run_pgbench_sweep.sh` and `check-records-db.sh --load` prefer that pattern, then any `*.sql`, then `*.dump`. If none is found, the script continues with current data and warns (no hard exit). Use `check-records-db.sh --load` to verify/load before running the sweep.
- **Other DBs (ports 5434–5440)**: For real pgbench at scale, add **millions of rows** per service; **respect each service’s schema** (do not invent columns or tables). Use migrations and data loaders or backups per schema:
  - **Social (5434)**: forum threads/posts, messages (long body text). **Heavily tuned**: heatmap-style access (hot forums, hot threads), hot tenant/shard patterns; partial indexes and partitioning where appropriate.
  - **Listings (5435)**: catalog items, long descriptions. **Heavily tuned**: hot catalog segments, hot tenant; same heatmap and hot-shard approach.
  - **Shopping (5436)**: orders, line items. **Heavily tuned**: hot tenants, hot time windows; heatmap and hot-shard tuning.
  - **Auth (5437)**: users, sessions, MFA/verification rows; same uniformity and tuning pattern.
  - **Analytics (5439)**, **Auction-monitor (5438)**, **Python-AI (5440)**: event/aggregate tables; populate with bulk inserts or backups; apply hot-tenant/heatmap patterns where the schema has natural “hot” dimensions.
- **Heatmap and hot tenant/shard**: Like records (records_hot.records_hot for the benchmark user), other services should identify hot tenants, hot shards, or hot segments and tune for them: partial indexes (e.g. `WHERE user_id = ?` or `WHERE forum_id IN (hot list)`), partitioning by tenant or time, and EXPLAIN ANALYZE on hot-path queries. Social, shopping, and listings in particular need this heatmap-style tuning and millions of rows to be meaningful.
- **pg_settings (tune like records)**: All service pgbench scripts should use the same PGOPTIONS-style tuning as records: `jit=off`, `synchronous_commit=off`, `work_mem`, `effective_cache_size`, `random_page_cost`, `plan_cache_mode`, `statement_timeout`, `lock_timeout`, `deadlock_timeout`, `join_collapse_limit=1`, `from_collapse_limit=1`. Social and auth sweeps already align; others should match.
- **Cold then warm**: Cold testing is key across the whole layer. All 8 pgbench sweeps support **COLD_FIRST=1**: run cold phase first (pure cold), then warm (warm cache), per client count. Set **RUN_COLD_CACHE=true** to enable the cold phase. Preflight (step 8) exports **COLD_FIRST=1** and **RUN_COLD_CACHE=true** when running pgbench.
- **Pipeline order**: All 8 pgbench sweeps run **at the end** of preflight (step 8, after step 7 test suites) so they do not block or slow earlier steps. Set **RUN_PGBENCH=1** (or **RUN_FULL_LOAD=1**) to run them.

### Single command (preflight + suites + k6 + pgbench)

Execution order: **Steps 1–6** (Colima, scale, TLS, DB/Redis) → **Step 7** (all test suites + k6 if `RUN_K6=1`) → **Step 8** (all 8 pgbench sweeps if `RUN_PGBENCH=1`). Shopping order-number sequence is applied in preflight step 3b4d so checkout does not hit advisory-lock timeouts.

```bash
RUN_FULL_LOAD=1 ./scripts/run-preflight-scale-and-all-suites.sh
```

Optional: `KILL_STALE_FIRST=1` to clear stale pipeline processes; `COLIMA_START=1` if Colima is stopped. Log to file: `2>&1 | tee preflight-full-$(date +%Y%m%d-%H%M%S).log`.
- **NOOP target 30k TPS**: Records sweep uses `NOOP_TARGET_TPS=30000` (default). With `RUN_NOOP_BASELINE=true` the script runs NOOP at 64 clients/64 threads and reports against this target; tune DB/host (shared_buffers, max_connections) to reach it at scale.
- **EXPLAIN ANALYZE**: Run for all key operations; plans are logged to LOG_DIR. Re-run after major data loads and ANALYZE to avoid planner lag.

## Telemetry (perf, strace, htop, valgrind) for latency analysis

- **Not packet capture**: Telemetry here is process/CPU/system-call oriented (perf, strace, htop), not tcpdump/tshark.
- **Records sweep**: Set `RUN_TELEMETRY=true` when running `run_pgbench_sweep.sh`. Outputs go to `LOG_DIR/telemetry/`:
  - **htop-before.txt / htop-after.txt**: Host `ps aux` and `top -b -n 1` snapshots.
  - **pg-ps-before.txt / pg-ps-after.txt**: Postgres process list and `/proc/stat` inside the Docker container (port 5433).
  - **perf-stat.txt**: `perf stat` for one short pgbench run (knn, 8 clients, 10s) if `perf` is installed.
  - **strace-summary.txt**: `strace -c` summary for one short pgbench run (5s) if `strace` is installed.
- **Valgrind**: Too heavy for a full pgbench sweep. Use only for single-query or single-transaction profiling (e.g. run one `psql` call under `valgrind --tool=callgrind` or `valgrind --leak-check=full`). See `scripts/valgrind-memory-leak-test.sh` for HTTP client usage; for DB, run valgrind against a minimal binary that runs one query.

## Data loaders (millions of rows, schema-respecting)

To make pgbench testing **real** across all eight DBs, use the load scripts to populate millions of rows with **realistic, random-but-real-looking data** while **respecting each schema** (types, CHECK constraints, FKs, UNIQUEs).

### Per-DB load scripts

| Script | Port | Tables / targets |
|--------|------|------------------|
| load-records-millions.sh | 5433 | records.records (2.5M default) |
| load-auth-millions.sh | 5437 | auth.users (1M default) |
| load-social-millions.sh | 5434 | forum.posts, forum.comments, messages.groups, messages.messages |
| load-listings-millions.sh | 5435 | listings.listings, listing_views |
| load-shopping-millions.sh | 5436 | shopping_cart, watchlist, recently_viewed, wishlist, purchase_history, search_history |
| load-analytics-millions.sh | 5439 | price_snapshots, search_analytics, user_behavior, trend_snapshots |
| load-auction-monitor-millions.sh | 5438 | auction_results, user_saved_auctions, monitoring_jobs |
| load-python-ai-millions.sh | 5440 | ai.model_metadata, ai.price_predictions, ai.training_data, ai.record_embeddings |

Each script:

- Connects to the correct port and DB (records or service-specific).
- Ensures schema/DB exist; exits with a clear message if migrations are missing.
- Inserts in batches (default 50k–100k per batch) to avoid timeouts and lock pressure.
- Uses realistic values: artist/title names, prices, flairs, conditions, sources, metric types, dates.
- Respects CHECK constraints and UNIQUEs (ON CONFLICT DO NOTHING where needed).
- Honors FK order (e.g. posts before comments, model_metadata before price_predictions).

### Run all loaders

```bash
./scripts/load-all-dbs-millions.sh
```

- Runs load-records-millions.sh, then auth, social, listings, shopping, analytics, auction-monitor, python-ai.
- Set `SKIP_RECORDS=1`, `SKIP_AUTH=1`, etc. to skip a DB.
- Override targets via env: `TARGET_ROWS=500000`, `TARGET_POSTS=800000`, `TARGET_LISTINGS=1000000`, etc.

**Prerequisites**: Docker Compose Postgres on ports 5433–5440; migrations applied (infra/db/*.sql). Then run pgbench sweeps or `run-preflight-scale-and-all-suites.sh` with `RUN_PGBENCH=1`.

### Fast bulk load (staging table) — avoid slow per-batch GIN/index cost

When loading **listings.listings** (or any table with expensive GIN/trigram indexes), row-by-row or small-batch inserts can take **~11+ minutes per 5k rows** because every insert updates the GIN index. To get **10–50x faster** load:

- **Listings**: Set `LOAD_LISTINGS_FAST_STAGING=1` (and ensure the table is below `LISTINGS_SKIP_GIN_DROP_ABOVE`, default 150k rows, or GIN drop is skipped).
  - Script creates an **UNLOGGED** staging table (no indexes), inserts in large batches (default `STAGING_BATCH_SIZE=100000`) into staging, then runs a **single** `INSERT INTO listings.listings SELECT * FROM listings.listings_staging`, then drops staging and recreates GIN indexes once.
  - GIN is dropped before the copy and recreated after; total time is dominated by the one-time index build instead of per-row updates.
- **With Colima/K3s**: `LOAD_SAFE_FOR_COLIMA=1` now enables `LOAD_LISTINGS_FAST_STAGING=1` by default for listings so full loads finish in minutes instead of hours.
- **Social (forum.posts)**: Use `SOCIAL_DROP_GIN_DURING_LOAD=1` to drop GIN on title/content during load, then recreate after (see load-social-millions.sh).
