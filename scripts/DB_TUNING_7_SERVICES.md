# DB Tuning: All 7 Service DBs (Ports 5434–5440)

Target: **sub-20ms** overall latency, **millions of rows**, raw DB (no pgbouncer). Apply EXPLAIN ANALYZE, indexes (B-tree, GIST, partial, composite), VACUUM, and pg_settings per service.

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

## Optional pgbench phase in pipeline

`RUN_PGBENCH=1` in **run-preflight-scale-and-all-suites.sh** runs all pgbench sweeps (records + 7 services) before test suites. Raw DB only (no pgbouncer). See PGBENCH_HARDENING.md and LOAD_TESTS_CATALOG.md.
