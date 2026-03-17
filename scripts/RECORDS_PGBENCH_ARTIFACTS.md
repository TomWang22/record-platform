# Records DB pgbench artifacts (tuning north star)

When you run the records pgbench sweep (`./scripts/run_pgbench_sweep.sh`), all outputs go to **`bench_logs/<YYYYMMDD_HHMMSS>/`**. Key artifacts for tuning (5k+ TPS fuzzy-search target):

## 1. Artifacts written by the script

| File | Description |
|------|--------------|
| `query_plan_full_analysis_*.txt` | EXPLAIN (ANALYZE, BUFFERS) for fuzzy search + FTS index check. Enable with `RUN_PLAN_DUMP=1` (default). Right after the plan dump the script runs **ANALYZE records.records; ANALYZE records_hot.records_hot;** so stats are fresh. |
| `data-summary-records.txt` | Table sizes and row counts for `records.records`, `records.records_hot`, `bench.results`; plus `pg_stat_user_tables` for records. |
| `diagnostics-records.log` | Output of `diagnose-performance-regression.sh` (config, function def, index usage). |
| `config_snapshot.txt` | Session/DB config snapshot from the run. |
| `bench_sweep_*.csv` | Full sweep CSV (TPS, latencies, run_id). |

**Optional:** `PGBENCH_RANDOMIZED=1` adds a **random** variant (5 query strings); `REAL_COLD_CACHE=1` runs an eviction read after CHECKPOINT in cold phase. Preflight sets both when running pgbench.

When preflight runs all 8 pgbench sweeps, the **combined log** is `PGBENCH_LOG` (e.g. `/tmp/pgbench-preflight-<timestamp>.log`). The **records-only** output is in the records sweep’s `LOG_DIR` (same as above) when `run_pgbench_sweep.sh` is run alone or as part of step 8.

## 2. SQL you can run (records DB, port 5433)

**Effective Postgres settings (records):**
```sql
SELECT name, setting, unit, context, source
FROM pg_settings
WHERE name IN (
  'max_connections','shared_buffers','effective_cache_size','work_mem',
  'maintenance_work_mem','effective_io_concurrency','random_page_cost',
  'seq_page_cost','jit','synchronous_commit','wal_compression',
  'checkpoint_timeout','checkpoint_completion_target','max_wal_size',
  'min_wal_size','wal_buffers','bgwriter_lru_maxpages','bgwriter_lru_multiplier',
  'autovacuum','autovacuum_max_workers','autovacuum_work_mem',
  'autovacuum_vacuum_scale_factor','autovacuum_analyze_scale_factor',
  'autovacuum_vacuum_cost_limit','autovacuum_vacuum_cost_delay',
  'track_io_timing','shared_preload_libraries'
)
ORDER BY name;
```

**Server version and background writer / checkpointer:**
```sql
SHOW server_version;
SELECT * FROM pg_stat_bgwriter;
SELECT * FROM pg_stat_checkpointer;
```

**Records schema/index and bloat signal (run on records DB, port 5433):**
```sql
-- table/index sizes (schema-qualified)
SELECT c.relname, pg_size_pretty(pg_total_relation_size(c.oid)) AS total
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'records' AND c.relname IN ('records','records_hot')
ORDER BY pg_total_relation_size(c.oid) DESC;

-- index list + sizes for records.records
SELECT i.relname AS index_name, pg_size_pretty(pg_relation_size(i.oid)) AS size,
  ix.indisunique, ix.indisprimary, pg_get_indexdef(i.oid) AS def
FROM pg_class t
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_index ix ON ix.indrelid = t.oid
JOIN pg_class i ON i.oid = ix.indexrelid
WHERE n.nspname = 'records' AND t.relname = 'records'
ORDER BY pg_relation_size(i.oid) DESC;

SELECT relname, n_live_tup, n_dead_tup, last_vacuum, last_autovacuum, last_analyze, last_autoanalyze
FROM pg_stat_user_tables
WHERE relname IN ('records','records_hot');
```

Example (from repo root, Docker Postgres on 5433):
```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 5433 -U postgres -d records -f - <<'SQL'
SELECT name, setting, unit, context, source FROM pg_settings WHERE name IN ('max_connections','shared_buffers', ...) ORDER BY name;
SQL
```

## 3. North star

- **8 DBs in parallel**, no pgbouncer, `max_connections=800`, observability on.
- **Records DB fuzzy-search path:** aim ~5k+ TPS (from ~200–300 baseline).
- Use `query_plan_full_analysis_*.txt` and `diagnostics-records.log` first; then the SQL above for GUCs and schema/index reality.
- **Randomized load:** set **`PGBENCH_RANDOMIZED=1`** to add a `random` variant (5 different query strings per transaction). Preflight sets this when `RUN_PGBENCH=1`. **Real cold/warm:** `COLD_FIRST=1`, `RUN_COLD_CACHE=true`, and **`REAL_COLD_CACHE=1`** (optional evict after CHECKPOINT). After each full EXPLAIN block the script runs **ANALYZE records.records; ANALYZE records_hot.records_hot;** so plans use fresh stats.

## 4. Combined vs records-only logs (preflight step 8)

When you run **preflight** with `RUN_PGBENCH=1`, step 8 runs all 8 pgbench sweeps and tees to **one combined log**:

- **Combined log:** `PGBENCH_LOG` (e.g. `/tmp/pgbench-preflight-<timestamp>.log`) — stdout from all 8 sweeps concatenated.
- **Records-only:** the records sweep writes its own `LOG_DIR` = `bench_logs/<YYYYMMDD_HHMMSS>/` (timestamp from when `run_pgbench_sweep.sh` runs). So **records.log** = the records section inside the combined log, or run records alone: `./scripts/run_pgbench_sweep.sh` and use that run’s `bench_logs/<ts>/` as the records artifact set.

## 5. If you can only send one thing

Send **`diagnostics-records.log`** plus the **single worst `EXPLAIN (ANALYZE, BUFFERS)`** for the pgbench query that’s slow (from `query_plan_full_analysis_*.txt`). That’s usually enough to identify the main limiter.
