# Data model, data lake, tuning, and cold-start (pgbench)

This doc ties together: **data model / data model object / data lake** (long-lived data), **tuning** (triggers, dual-write, indexes), **1M rows per schema** for pgbench, and **cold** behaviour (restart Postgres, cache hit, pg_settings, EXPLAIN ANALYZE).

---

## Data model and data lake

- **Data model:** Per-service schemas (records, auth, listings, shopping, forum, messages, analytics, auction_monitor, ai). Each schema owns its tables; cross-DB references are by ID only (no FK across instances).
- **Data model object:** Application entities map to tables (e.g. records.records, listings.listings, shopping.shopping_cart). Proto/gRPC and app code are the object layer; SQL and migrations are the canonical schema.
- **Data lake (long-lived):** Analytics, price history, and trend data are long-lived. Policy: **1M rows per schema** cap outside port 5433 (see docs/DATA_GOVERNANCE_AND_SCHEMA_CAPS.md). Port 5433 (records) can exceed 1M. Archival and cold storage should be considered before hitting caps.

---

## 1M rows per schema for pgbench

- **Target:** At least **1 million rows per schema** (where applicable) so pgbench and load tests run against realistic size. Cold behaviour (restart Postgres) and cache-hit ratios are meaningful at that scale.
- **How to load:** Records (5433): scripts/load-records-csv-5433.sh with chunks. Social (5434), Listings (5435), Shopping (5436), Auth (5437), etc.: scripts/seed-all-dbs.sh with env vars set to 1M+ per schema (stay within 1M per schema for non-records per governance). Apply tuning (service-specific-tuning.sql, comprehensive-db-tuning.sql) before loading.
- **Cold start (raw):** For cold pgbench runs, restart Postgres before the run or use **COLD_POSTGRES_RESTART=1** when the preflight/pgbench pipeline supports it (step 8 in scripts/run-preflight-scale-and-all-suites.sh).

---

## Tuning: triggers and dual-write

- **Triggers:** Use for audit, derived columns, or consistency within a single DB. Document in schema comments or docs/SCHEMA_TABLE_BREAKDOWN.md.
- **Dual-write:** When the same event must appear in two DBs, the application performs two writes; triggers do not cross instances. See docs/SCHEMA_DESIGN_EXTENSIONS.md and service code.

---

## Diagnostics: pg_settings, EXPLAIN ANALYZE, indexes, cache hit

- **pg_settings:** Per instance, run SELECT on pg_settings (shared_buffers, work_mem, effective_cache_size, etc.) and store in run artifacts or a companion to docs/CURRENT_DB_SCHEMA_REPORT.md.
- **EXPLAIN (ANALYZE, BUFFERS):** Preflight step 8 runs EXPLAIN for all 8 DBs/schemas; output in bench_logs/preflight-<timestamp>. Use to verify plans and index usage for hot and cold runs.
- **Indexes used:** pg_indexes / pg_stat_user_indexes per schema; combine with EXPLAIN to confirm index scans.
- **Cache hit (including cold):** pg_stat_database (blks_hit, blks_read) for buffer cache hit ratio. Cold = after restart (low hit at first); warm runs should show high hit ratio.

---

## Related

- docs/DATA_GOVERNANCE_AND_SCHEMA_CAPS.md
- docs/COLD_TUNING_AND_PGBENCH.md
- scripts/seed-all-dbs.sh
- scripts/run-preflight-scale-and-all-suites.sh
- docs/SCHEMA_TABLE_BREAKDOWN.md
- docs/EXTERNAL_DB_SCHEMA_BREAKDOWN.md
