# DB Tuning: All 7 Service DBs (Ports 5434–5440)

Target: **sub-20ms** overall latency (ideally **8–20ms** per query), **millions of rows**, raw DB (no pgbouncer). Apply EXPLAIN ANALYZE, indexes (B-tree, GIST, partial, composite), VACUUM, and pg_settings per service.

## Targets (cold tuning, no warm-cache tricks)

- **Latency:** 8–20ms per query in EXPLAIN (ANALYZE); script warns if Execution Time > 20ms (`EXPLAIN_TARGET_MS=20`).
- **Throughput:** Cold run **1.5k–5k+ TPS** per workload (records KNN/TRGM, social, auth, etc.); NOOP shows connection ceiling.
- **Scale:** Tuning must hold at **7–8 figure row counts** (millions to tens of millions); data summary shows per-schema/table rows and sizes.
- **Workers:** `max_parallel_workers=12`, `max_parallel_workers_per_gather=4` (gold + docker-compose); prefer index scans and parallel plans.

**Data transparency:** `apply-tune-and-explain-all-dbs.sh` writes **data-summary-&lt;name&gt;.txt** per DB (schema, table, approx rows, size) so it’s clear how much data each schema has before interpreting EXPLAIN or pgbench.

## Scope

| Port | Service        | Script / schemas        | Reference tuning |
|------|----------------|-------------------------|------------------|
| 5433 | records        | run_pgbench_sweep.sh    | comprehensive-db-tuning.sql, 43-optimize-knn-trgm.sql, 44-optimize-planner.sql |
| 5434 | social         | run_social_pgbench_sweep | service-specific-tuning.sql (social), 04-social-schema*.sql |
| 5435 | listings       | run_listings_pgbench_sweep | service-specific-tuning.sql (listings), optimize-listings-db.sql |
| 5436 | shopping       | run_shopping_pgbench_sweep | service-specific-tuning.sql (shopping) |
| 5437 | auth           | run_auth_pgbench_sweep  | service-specific-tuning.sql (auth), 07-auth-schema*.sql |
| 5438 | auction-monitor | run_auction-monitor_pgbench_sweep | service-specific-tuning.sql (auction-monitor) |
| 5439 | analytics      | run_analytics_pgbench_sweep | service-specific-tuning.sql (analytics) |
| 5440 | python-ai      | run_python-ai_pgbench_sweep | service-specific-tuning.sql (python-ai), 09-python-ai-schema.sql |

The **7 DBs outside port 5433** are: social, listings, shopping, auth, auction-monitor, analytics, python-ai (5434–5440).

## Workflow: EXPLAIN ANALYZE → Tune → Sub-20ms

1. **Run EXPLAIN ANALYZE** on representative queries per service (see each `run_*_pgbench_sweep.sh` for workload).
2. **Identify** sequential scans, high "actual time", missing indexes.
3. **Apply** indexes (B-tree, GIST, partial, composite), then re-run EXPLAIN ANALYZE.
4. **Tune** pg_settings per instance: work_mem, effective_cache_size, random_page_cost, jit=off, plan_cache_mode (see PGBENCH_HARDENING.md).
5. **VACUUM / ANALYZE** after schema or bulk changes; set autovacuum_*_scale_factor per table in `infra/db/service-specific-tuning.sql`.

## Techniques (throw all tricks)

- **Index**: B-tree (default), GIST (e.g. trgm, KNN), **partial** (WHERE hot tenant / active only), **composite** (user_id, created_at DESC).
- **Hot tenant / hot sharding**: Partial indexes on high-traffic user_id or shard key; "heatmap" = pg_stat_user_tables (n_live_tup, n_tup_ins, n_tup_upd) to find hot tables.
- **VACUUM**: Aggressive autovacuum on write-heavy tables (scale_factor 0.05–0.1); manual VACUUM ANALYZE after big loads.
- **pg_settings**: work_mem, effective_cache_size, random_page_cost, cpu_index_tuple_cost, jit=off, statement_timeout, plan_cache_mode (see comprehensive-db-tuning.sql and PGBENCH_HARDENING.md).

## Where tuning lives

- **infra/db/service-specific-tuning.sql** – Per-service indexes, partial/composite, autovacuum.
- **infra/db/comprehensive-db-tuning.sql** – Global and records-specific: worker threads, memory, planner, autovacuum.
- **infra/db/43-optimize-knn-trgm.sql**, **44-optimize-planner.sql** – KNN/trgm and planner for records (5433).
- **infra/db/optimize-listings-db.sql** – Listings-specific optimizations.

Apply service-specific-tuning.sql to each of the 7 DBs (5434–5440); apply comprehensive-db-tuning.sql to records (5433) and optionally to others where shared_buffers/work_mem are appropriate.

## Running EXPLAIN ANALYZE per service

From host (Docker Postgres on localhost):

```bash
# Example: social (5434)
psql -h 127.0.0.1 -p 5434 -U postgres -d postgres -c "EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM social.messages WHERE user_id = '...' ORDER BY created_at DESC LIMIT 50;"

# Listings (5435), shopping (5436), auth (5437), auction-monitor (5438), analytics (5439), python-ai (5440): same pattern with correct schema/table.
```

Use `RUN_PLAN_DUMP=1` in the corresponding `run_*_pgbench_sweep.sh` to capture EXPLAIN ANALYZE for the script’s workload (see PGBENCH_HARDENING.md).

**One-shot: tune and EXPLAIN all 8 DBs (sub-20ms target):** run `./scripts/apply-tune-and-explain-all-dbs.sh`. It applies: (1) gold defaults (tuple cost, parallel 12/4, random_page_cost 0.8), (2) content-hash migrations (set `SKIP_CONTENT_HASH=1` to skip on large tables), (3) records KNN/trigram (43) + VACUUM ANALYZE, (4) service-specific tuning, (5) listings covering index + ANALYZE, (6) one `EXPLAIN (ANALYZE, BUFFERS)` per DB → `bench_logs/explain-all-<timestamp>/*.txt`. **Same 8 DBs as step 8 of run-preflight-scale-and-all-suites.sh.** Optional: `RUN_QUICK_PGBENCH=1` for a fast pgbench -S latency check; `RUN_FULL_PGBENCH=1` to run the same 8 pgbench sweep scripts as preflight (run_pgbench_sweep.sh, run_social_pgbench_sweep.sh, … run_python-ai_pgbench_sweep.sh) with `PGBENCH_MODE=quick` (or `deep`). No pgbouncer; connection pool `max_connections=800` per instance (500–1000; see below). **Parallel sweeps:** `PGBENCH_PARALLEL=1` (default) runs all 8 sweeps at once so total time ≈ one sweep; `PGBENCH_PARALLEL=0` for sequential.

## Little's Law and TPS/latency

**Little's Law:** L = λW (steady state: concurrency = throughput × latency). The scripts use it for reporting:

- **lat_est_ms** = 1000 × clients / tps (physics-based mean latency in ms).
- TPS and pgbench-reported latency are consistent with this; `expected_vs_reality_analysis.txt` validates L = λW.

So when interpreting TPS: higher concurrency with same TPS implies higher latency (L = λW); to improve latency at fixed concurrency, increase TPS (query/plan/index tuning).

## Connection pool (500–1000 per instance)

- **docker-compose:** each Postgres service uses `max_connections=800` (ballpark 500–1000). Reuse connections; pgbench uses one connection per client, so peak clients per DB (e.g. 256) must stay below max_connections.
- When **all 8 pgbench sweeps run in parallel**, each DB runs one sweep (one set of clients); 800 allows headroom. If you run multiple app replicas per DB, ensure sum of pool sizes < max_connections.

## Optional pgbench phase in pipeline

`RUN_PGBENCH=1` in **run-preflight-scale-and-all-suites.sh** runs all pgbench sweeps (records + 7 services) **after** test suites (step 8). **Step 7.5 runs performance tuning once** (gold defaults, indexes, EXPLAIN, data summary, bottleneck check) before step 8 when `RUN_TUNING_ONCE=1` (default). Set `RUN_TUNING_ONCE=0` to skip. Raw DB only (no pgbouncer). **PGBENCH_PARALLEL=1** (default) runs all 8 in parallel. See PGBENCH_HARDENING.md and LOAD_TESTS_CATALOG.md.
