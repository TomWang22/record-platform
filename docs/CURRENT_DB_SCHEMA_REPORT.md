# Current DB schema report (inspection only)

Generated: 2026-03-12T22:49:23Z — run `./scripts/inspect-external-db-schemas.sh docs/CURRENT_DB_SCHEMA_REPORT.md` to refresh.
Host: 127.0.0.1

**Note:** "(no user tables)" under DB `postgres` or schema `public` is **expected** — user data lives in named schemas (e.g. forum, messages, listings, shopping, auth, auction_monitor, analytics, ai).

## Port 5433 — records (record-platform-postgres-1)

**Databases:** postgres records 

### DB `postgres`

**Schemas:** public 

  (no user tables — expected for default DB `postgres` / schema `public`; app uses named schemas above)

### DB `records`

**Schemas:** analytics auth bench catalog listings public records 

**Tables (approx. row count from planner):**

| Schema.Table | ~rows |
|--------------|-------|
| analytics.price_snapshots | 0 |
| auth.users | 0 |
| bench.results | 70 |
| catalog.data_lake | 0 |
| catalog.data_model | 0 |
| catalog.data_object | 0 |
| listings.auctions | 0 |
| listings.oauth_tokens | 0 |
| listings.search_history | 85 |
| listings.user_settings | 0 |
| listings.watchlist | 0 |
| records.records | 278 |

**Table definitions (columns):**

- **`analytics.price_snapshots|id|bigint`**:
  - `analytics.price_snapshots|id|bigint` analytics.price_snapshots|id|bigint
- **`analytics.price_snapshots|snap_date|date`**:
  - `analytics.price_snapshots|snap_date|date` analytics.price_snapshots|snap_date|date
- **`analytics.price_snapshots|artist|text`**:
  - `analytics.price_snapshots|artist|text` analytics.price_snapshots|artist|text
- **`analytics.price_snapshots|name|text`**:
  - `analytics.price_snapshots|name|text` analytics.price_snapshots|name|text
- **`analytics.price_snapshots|format|text`**:
  - `analytics.price_snapshots|format|text` analytics.price_snapshots|format|text
- **`analytics.price_snapshots|median_price|numeric`**:
  - `analytics.price_snapshots|median_price|numeric` analytics.price_snapshots|median_price|numeric
- **`analytics.price_snapshots|sample_count|integer`**:
  - `analytics.price_snapshots|sample_count|integer` analytics.price_snapshots|sample_count|integer
- **`auth.users|id|uuid`**:
  - `auth.users|id|uuid` auth.users|id|uuid
- **`auth.users|email|USER-DEFINED`**:
  - `auth.users|email|USER-DEFINED` auth.users|email|USER-DEFINED
- **`auth.users|password_hash|text`**:
  - `auth.users|password_hash|text` auth.users|password_hash|text
- **`auth.users|settings|jsonb`**:
  - `auth.users|settings|jsonb` auth.users|settings|jsonb
- **`auth.users|created_at|timestamp with time zone`**:
  - `auth.users|created_at|timestamp with time zone` auth.users|created_at|timestamp with time zone
- **`bench.results|id|bigint`**:
  - `bench.results|id|bigint` bench.results|id|bigint
- **`bench.results|ts_utc|timestamp with time zone`**:
  - `bench.results|ts_utc|timestamp with time zone` bench.results|ts_utc|timestamp with time zone
- **`bench.results|variant|text`**:
  - `bench.results|variant|text` bench.results|variant|text
- **`bench.results|phase|text`**:
  - `bench.results|phase|text` bench.results|phase|text
- **`bench.results|clients|integer`**:
  - `bench.results|clients|integer` bench.results|clients|integer
- **`bench.results|threads|integer`**:
  - `bench.results|threads|integer` bench.results|threads|integer
- **`bench.results|duration_s|integer`**:
  - `bench.results|duration_s|integer` bench.results|duration_s|integer
- **`bench.results|limit_rows|integer`**:
  - `bench.results|limit_rows|integer` bench.results|limit_rows|integer
- **`bench.results|tps|numeric`**:
  - `bench.results|tps|numeric` bench.results|tps|numeric
- **`bench.results|lat_avg_ms|numeric`**:
  - `bench.results|lat_avg_ms|numeric` bench.results|lat_avg_ms|numeric
- **`bench.results|lat_std_ms|numeric`**:
  - `bench.results|lat_std_ms|numeric` bench.results|lat_std_ms|numeric
- **`bench.results|lat_est_ms|numeric`**:
  - `bench.results|lat_est_ms|numeric` bench.results|lat_est_ms|numeric
- **`bench.results|p50_ms|numeric`**:
  - `bench.results|p50_ms|numeric` bench.results|p50_ms|numeric
- **`bench.results|p95_ms|numeric`**:
  - `bench.results|p95_ms|numeric` bench.results|p95_ms|numeric
- **`bench.results|p99_ms|numeric`**:
  - `bench.results|p99_ms|numeric` bench.results|p99_ms|numeric
- **`bench.results|p999_ms|numeric`**:
  - `bench.results|p999_ms|numeric` bench.results|p999_ms|numeric
- **`bench.results|p9999_ms|numeric`**:
  - `bench.results|p9999_ms|numeric` bench.results|p9999_ms|numeric
- **`bench.results|p99999_ms|numeric`**:
  - `bench.results|p99999_ms|numeric` bench.results|p99999_ms|numeric
- **`bench.results|p999999_ms|numeric`**:
  - `bench.results|p999999_ms|numeric` bench.results|p999999_ms|numeric
- **`bench.results|p100_ms|numeric`**:
  - `bench.results|p100_ms|numeric` bench.results|p100_ms|numeric
- **`bench.results|notes|text`**:
  - `bench.results|notes|text` bench.results|notes|text
- **`bench.results|git_rev|text`**:
  - `bench.results|git_rev|text` bench.results|git_rev|text
- **`bench.results|git_branch|text`**:
  - `bench.results|git_branch|text` bench.results|git_branch|text
- **`bench.results|host|text`**:
  - `bench.results|host|text` bench.results|host|text
- **`bench.results|server_version|text`**:
  - `bench.results|server_version|text` bench.results|server_version|text
- **`bench.results|track_io|boolean`**:
  - `bench.results|track_io|boolean` bench.results|track_io|boolean
- **`bench.results|delta_blks_hit|bigint`**:
  - `bench.results|delta_blks_hit|bigint` bench.results|delta_blks_hit|bigint
- **`bench.results|delta_blks_read|bigint`**:
  - `bench.results|delta_blks_read|bigint` bench.results|delta_blks_read|bigint
- **`bench.results|delta_blk_read_ms|numeric`**:
  - `bench.results|delta_blk_read_ms|numeric` bench.results|delta_blk_read_ms|numeric
- **`bench.results|delta_blk_write_ms|numeric`**:
  - `bench.results|delta_blk_write_ms|numeric` bench.results|delta_blk_write_ms|numeric
- **`bench.results|delta_xact_commit|bigint`**:
  - `bench.results|delta_xact_commit|bigint` bench.results|delta_xact_commit|bigint
- **`bench.results|delta_tup_returned|bigint`**:
  - `bench.results|delta_tup_returned|bigint` bench.results|delta_tup_returned|bigint
- **`bench.results|delta_tup_fetched|bigint`**:
  - `bench.results|delta_tup_fetched|bigint` bench.results|delta_tup_fetched|bigint
- **`bench.results|delta_stmt_total_ms|numeric`**:
  - `bench.results|delta_stmt_total_ms|numeric` bench.results|delta_stmt_total_ms|numeric
- **`bench.results|delta_stmt_shared_hit|bigint`**:
  - `bench.results|delta_stmt_shared_hit|bigint` bench.results|delta_stmt_shared_hit|bigint
- **`bench.results|delta_stmt_shared_read|bigint`**:
  - `bench.results|delta_stmt_shared_read|bigint` bench.results|delta_stmt_shared_read|bigint
- **`bench.results|delta_stmt_shared_dirtied|bigint`**:
  - `bench.results|delta_stmt_shared_dirtied|bigint` bench.results|delta_stmt_shared_dirtied|bigint
- **`bench.results|delta_stmt_shared_written|bigint`**:
  - `bench.results|delta_stmt_shared_written|bigint` bench.results|delta_stmt_shared_written|bigint
- **`bench.results|delta_stmt_temp_read|bigint`**:
  - `bench.results|delta_stmt_temp_read|bigint` bench.results|delta_stmt_temp_read|bigint
- **`bench.results|delta_stmt_temp_written|bigint`**:
  - `bench.results|delta_stmt_temp_written|bigint` bench.results|delta_stmt_temp_written|bigint
- **`bench.results|delta_io_read_ms|numeric`**:
  - `bench.results|delta_io_read_ms|numeric` bench.results|delta_io_read_ms|numeric
- **`bench.results|delta_io_write_ms|numeric`**:
  - `bench.results|delta_io_write_ms|numeric` bench.results|delta_io_write_ms|numeric
- **`bench.results|delta_io_extend_ms|numeric`**:
  - `bench.results|delta_io_extend_ms|numeric` bench.results|delta_io_extend_ms|numeric
- **`bench.results|delta_io_fsync_ms|numeric`**:
  - `bench.results|delta_io_fsync_ms|numeric` bench.results|delta_io_fsync_ms|numeric
- **`bench.results|io_total_ms|numeric`**:
  - `bench.results|io_total_ms|numeric` bench.results|io_total_ms|numeric
- **`bench.results|active_sessions|numeric`**:
  - `bench.results|active_sessions|numeric` bench.results|active_sessions|numeric
- **`bench.results|cpu_share_pct|numeric`**:
  - `bench.results|cpu_share_pct|numeric` bench.results|cpu_share_pct|numeric
- **`bench.results|ok_xacts|bigint`**:
  - `bench.results|ok_xacts|bigint` bench.results|ok_xacts|bigint
- **`bench.results|fail_xacts|bigint`**:
  - `bench.results|fail_xacts|bigint` bench.results|fail_xacts|bigint
- **`bench.results|err_pct|numeric`**:
  - `bench.results|err_pct|numeric` bench.results|err_pct|numeric
- **`bench.results|delta_wal_records|bigint`**:
  - `bench.results|delta_wal_records|bigint` bench.results|delta_wal_records|bigint
- **`bench.results|delta_wal_fpi|bigint`**:
  - `bench.results|delta_wal_fpi|bigint` bench.results|delta_wal_fpi|bigint
- **`bench.results|delta_wal_bytes|numeric`**:
  - `bench.results|delta_wal_bytes|numeric` bench.results|delta_wal_bytes|numeric
- **`bench.results|delta_ckpt_write_ms|numeric`**:
  - `bench.results|delta_ckpt_write_ms|numeric` bench.results|delta_ckpt_write_ms|numeric
- **`bench.results|delta_ckpt_sync_ms|numeric`**:
  - `bench.results|delta_ckpt_sync_ms|numeric` bench.results|delta_ckpt_sync_ms|numeric
- **`bench.results|delta_buf_checkpoint|bigint`**:
  - `bench.results|delta_buf_checkpoint|bigint` bench.results|delta_buf_checkpoint|bigint
- **`bench.results|delta_buf_backend|bigint`**:
  - `bench.results|delta_buf_backend|bigint` bench.results|delta_buf_backend|bigint
- **`bench.results|delta_buf_alloc|bigint`**:
  - `bench.results|delta_buf_alloc|bigint` bench.results|delta_buf_alloc|bigint
- **`bench.results|hit_ratio_pct|numeric`**:
  - `bench.results|hit_ratio_pct|numeric` bench.results|hit_ratio_pct|numeric
- **`bench.results|run_id|text`**:
  - `bench.results|run_id|text` bench.results|run_id|text
- **`bench.results|p9999999_ms|numeric`**:
  - `bench.results|p9999999_ms|numeric` bench.results|p9999999_ms|numeric
- **`catalog.data_lake|id|integer`**:
  - `catalog.data_lake|id|integer` catalog.data_lake|id|integer
- **`catalog.data_lake|name|text`**:
  - `catalog.data_lake|name|text` catalog.data_lake|name|text
- **`catalog.data_lake|description|text`**:
  - `catalog.data_lake|description|text` catalog.data_lake|description|text
- **`catalog.data_model|id|integer`**:
  - `catalog.data_model|id|integer` catalog.data_model|id|integer
- **`catalog.data_model|data_lake_id|integer`**:
  - `catalog.data_model|data_lake_id|integer` catalog.data_model|data_lake_id|integer
- **`catalog.data_model|name|text`**:
  - `catalog.data_model|name|text` catalog.data_model|name|text
- **`catalog.data_model|schema_name|text`**:
  - `catalog.data_model|schema_name|text` catalog.data_model|schema_name|text
- **`catalog.data_model|description|text`**:
  - `catalog.data_model|description|text` catalog.data_model|description|text
- **`catalog.data_object|id|integer`**:
  - `catalog.data_object|id|integer` catalog.data_object|id|integer
- **`catalog.data_object|data_model_id|integer`**:
  - `catalog.data_object|data_model_id|integer` catalog.data_object|data_model_id|integer
- **`catalog.data_object|schema_name|text`**:
  - `catalog.data_object|schema_name|text` catalog.data_object|schema_name|text
- **`catalog.data_object|object_name|text`**:
  - `catalog.data_object|object_name|text` catalog.data_object|object_name|text
- **`catalog.data_object|object_type|text`**:
  - `catalog.data_object|object_type|text` catalog.data_object|object_type|text
- **`catalog.data_object|description|text`**:
  - `catalog.data_object|description|text` catalog.data_object|description|text
- **`listings.auctions|id|bigint`**:
  - `listings.auctions|id|bigint` listings.auctions|id|bigint
- **`listings.auctions|source|text`**:
  - `listings.auctions|source|text` listings.auctions|source|text
- **`listings.auctions|item_id|text`**:
  - `listings.auctions|item_id|text` listings.auctions|item_id|text
- **`listings.auctions|title|text`**:
  - `listings.auctions|title|text` listings.auctions|title|text
- **`listings.auctions|price|numeric`**:
  - `listings.auctions|price|numeric` listings.auctions|price|numeric
- **`listings.auctions|currency|text`**:
  - `listings.auctions|currency|text` listings.auctions|currency|text
- **`listings.auctions|shipping|numeric`**:
  - `listings.auctions|shipping|numeric` listings.auctions|shipping|numeric
- **`listings.auctions|ends_at|timestamp with time zone`**:
  - `listings.auctions|ends_at|timestamp with time zone` listings.auctions|ends_at|timestamp with time zone
- **`listings.auctions|url|text`**:
  - `listings.auctions|url|text` listings.auctions|url|text
- **`listings.auctions|fetched_at|timestamp with time zone`**:
  - `listings.auctions|fetched_at|timestamp with time zone` listings.auctions|fetched_at|timestamp with time zone
- **`listings.oauth_tokens|user_id|uuid`**:
  - `listings.oauth_tokens|user_id|uuid` listings.oauth_tokens|user_id|uuid
- **`listings.oauth_tokens|service|text`**:
  - `listings.oauth_tokens|service|text` listings.oauth_tokens|service|text
- **`listings.oauth_tokens|oauth_token|text`**:
  - `listings.oauth_tokens|oauth_token|text` listings.oauth_tokens|oauth_token|text
- **`listings.oauth_tokens|oauth_token_secret|text`**:
  - `listings.oauth_tokens|oauth_token_secret|text` listings.oauth_tokens|oauth_token_secret|text
- **`listings.search_history|id|bigint`**:
  - `listings.search_history|id|bigint` listings.search_history|id|bigint
- **`listings.search_history|user_id|uuid`**:
  - `listings.search_history|user_id|uuid` listings.search_history|user_id|uuid
- **`listings.search_history|source|text`**:
  - `listings.search_history|source|text` listings.search_history|source|text
- **`listings.search_history|q|text`**:
  - `listings.search_history|q|text` listings.search_history|q|text
- **`listings.search_history|results|integer`**:
  - `listings.search_history|results|integer` listings.search_history|results|integer
- **`listings.search_history|created_at|timestamp with time zone`**:
  - `listings.search_history|created_at|timestamp with time zone` listings.search_history|created_at|timestamp with time zone
- **`listings.user_settings|user_id|uuid`**:
  - `listings.user_settings|user_id|uuid` listings.user_settings|user_id|uuid
- **`listings.user_settings|country_code|text`**:
  - `listings.user_settings|country_code|text` listings.user_settings|country_code|text
- **`listings.user_settings|currency|text`**:
  - `listings.user_settings|currency|text` listings.user_settings|currency|text
- **`listings.user_settings|fee_rate|numeric`**:
  - `listings.user_settings|fee_rate|numeric` listings.user_settings|fee_rate|numeric
- **`listings.user_settings|duty_rate|numeric`**:
  - `listings.user_settings|duty_rate|numeric` listings.user_settings|duty_rate|numeric
- **`listings.watchlist|id|bigint`**:
  - `listings.watchlist|id|bigint` listings.watchlist|id|bigint
- **`listings.watchlist|user_id|uuid`**:
  - `listings.watchlist|user_id|uuid` listings.watchlist|user_id|uuid
- **`listings.watchlist|source|text`**:
  - `listings.watchlist|source|text` listings.watchlist|source|text
- **`listings.watchlist|query|text`**:
  - `listings.watchlist|query|text` listings.watchlist|query|text
- **`listings.watchlist|created_at|timestamp with time zone`**:
  - `listings.watchlist|created_at|timestamp with time zone` listings.watchlist|created_at|timestamp with time zone
- **`public.pg_stat_statements|userid|oid`**:
  - `public.pg_stat_statements|userid|oid` public.pg_stat_statements|userid|oid
- **`public.pg_stat_statements|dbid|oid`**:
  - `public.pg_stat_statements|dbid|oid` public.pg_stat_statements|dbid|oid
- **`public.pg_stat_statements|toplevel|boolean`**:
  - `public.pg_stat_statements|toplevel|boolean` public.pg_stat_statements|toplevel|boolean
- **`public.pg_stat_statements|queryid|bigint`**:
  - `public.pg_stat_statements|queryid|bigint` public.pg_stat_statements|queryid|bigint
- **`public.pg_stat_statements|query|text`**:
  - `public.pg_stat_statements|query|text` public.pg_stat_statements|query|text
- **`public.pg_stat_statements|plans|bigint`**:
  - `public.pg_stat_statements|plans|bigint` public.pg_stat_statements|plans|bigint
- **`public.pg_stat_statements|total_plan_time|double precision`**:
  - `public.pg_stat_statements|total_plan_time|double precision` public.pg_stat_statements|total_plan_time|double precision
- **`public.pg_stat_statements|min_plan_time|double precision`**:
  - `public.pg_stat_statements|min_plan_time|double precision` public.pg_stat_statements|min_plan_time|double precision
- **`public.pg_stat_statements|max_plan_time|double precision`**:
  - `public.pg_stat_statements|max_plan_time|double precision` public.pg_stat_statements|max_plan_time|double precision
- **`public.pg_stat_statements|mean_plan_time|double precision`**:
  - `public.pg_stat_statements|mean_plan_time|double precision` public.pg_stat_statements|mean_plan_time|double precision
- **`public.pg_stat_statements|stddev_plan_time|double precision`**:
  - `public.pg_stat_statements|stddev_plan_time|double precision` public.pg_stat_statements|stddev_plan_time|double precision
- **`public.pg_stat_statements|calls|bigint`**:
  - `public.pg_stat_statements|calls|bigint` public.pg_stat_statements|calls|bigint
- **`public.pg_stat_statements|total_exec_time|double precision`**:
  - `public.pg_stat_statements|total_exec_time|double precision` public.pg_stat_statements|total_exec_time|double precision
- **`public.pg_stat_statements|min_exec_time|double precision`**:
  - `public.pg_stat_statements|min_exec_time|double precision` public.pg_stat_statements|min_exec_time|double precision
- **`public.pg_stat_statements|max_exec_time|double precision`**:
  - `public.pg_stat_statements|max_exec_time|double precision` public.pg_stat_statements|max_exec_time|double precision
- **`public.pg_stat_statements|mean_exec_time|double precision`**:
  - `public.pg_stat_statements|mean_exec_time|double precision` public.pg_stat_statements|mean_exec_time|double precision
- **`public.pg_stat_statements|stddev_exec_time|double precision`**:
  - `public.pg_stat_statements|stddev_exec_time|double precision` public.pg_stat_statements|stddev_exec_time|double precision
- **`public.pg_stat_statements|rows|bigint`**:
  - `public.pg_stat_statements|rows|bigint` public.pg_stat_statements|rows|bigint
- **`public.pg_stat_statements|shared_blks_hit|bigint`**:
  - `public.pg_stat_statements|shared_blks_hit|bigint` public.pg_stat_statements|shared_blks_hit|bigint
- **`public.pg_stat_statements|shared_blks_read|bigint`**:
  - `public.pg_stat_statements|shared_blks_read|bigint` public.pg_stat_statements|shared_blks_read|bigint
- **`public.pg_stat_statements|shared_blks_dirtied|bigint`**:
  - `public.pg_stat_statements|shared_blks_dirtied|bigint` public.pg_stat_statements|shared_blks_dirtied|bigint
- **`public.pg_stat_statements|shared_blks_written|bigint`**:
  - `public.pg_stat_statements|shared_blks_written|bigint` public.pg_stat_statements|shared_blks_written|bigint
- **`public.pg_stat_statements|local_blks_hit|bigint`**:
  - `public.pg_stat_statements|local_blks_hit|bigint` public.pg_stat_statements|local_blks_hit|bigint
- **`public.pg_stat_statements|local_blks_read|bigint`**:
  - `public.pg_stat_statements|local_blks_read|bigint` public.pg_stat_statements|local_blks_read|bigint
- **`public.pg_stat_statements|local_blks_dirtied|bigint`**:
  - `public.pg_stat_statements|local_blks_dirtied|bigint` public.pg_stat_statements|local_blks_dirtied|bigint
- **`public.pg_stat_statements|local_blks_written|bigint`**:
  - `public.pg_stat_statements|local_blks_written|bigint` public.pg_stat_statements|local_blks_written|bigint
- **`public.pg_stat_statements|temp_blks_read|bigint`**:
  - `public.pg_stat_statements|temp_blks_read|bigint` public.pg_stat_statements|temp_blks_read|bigint
- **`public.pg_stat_statements|temp_blks_written|bigint`**:
  - `public.pg_stat_statements|temp_blks_written|bigint` public.pg_stat_statements|temp_blks_written|bigint
- **`public.pg_stat_statements|blk_read_time|double precision`**:
  - `public.pg_stat_statements|blk_read_time|double precision` public.pg_stat_statements|blk_read_time|double precision
- **`public.pg_stat_statements|blk_write_time|double precision`**:
  - `public.pg_stat_statements|blk_write_time|double precision` public.pg_stat_statements|blk_write_time|double precision
- **`public.pg_stat_statements|temp_blk_read_time|double precision`**:
  - `public.pg_stat_statements|temp_blk_read_time|double precision` public.pg_stat_statements|temp_blk_read_time|double precision
- **`public.pg_stat_statements|temp_blk_write_time|double precision`**:
  - `public.pg_stat_statements|temp_blk_write_time|double precision` public.pg_stat_statements|temp_blk_write_time|double precision
- **`public.pg_stat_statements|wal_records|bigint`**:
  - `public.pg_stat_statements|wal_records|bigint` public.pg_stat_statements|wal_records|bigint
- **`public.pg_stat_statements|wal_fpi|bigint`**:
  - `public.pg_stat_statements|wal_fpi|bigint` public.pg_stat_statements|wal_fpi|bigint
- **`public.pg_stat_statements|wal_bytes|numeric`**:
  - `public.pg_stat_statements|wal_bytes|numeric` public.pg_stat_statements|wal_bytes|numeric
- **`public.pg_stat_statements|jit_functions|bigint`**:
  - `public.pg_stat_statements|jit_functions|bigint` public.pg_stat_statements|jit_functions|bigint
- **`public.pg_stat_statements|jit_generation_time|double precision`**:
  - `public.pg_stat_statements|jit_generation_time|double precision` public.pg_stat_statements|jit_generation_time|double precision
- **`public.pg_stat_statements|jit_inlining_count|bigint`**:
  - `public.pg_stat_statements|jit_inlining_count|bigint` public.pg_stat_statements|jit_inlining_count|bigint
- **`public.pg_stat_statements|jit_inlining_time|double precision`**:
  - `public.pg_stat_statements|jit_inlining_time|double precision` public.pg_stat_statements|jit_inlining_time|double precision
- **`public.pg_stat_statements|jit_optimization_count|bigint`**:
  - `public.pg_stat_statements|jit_optimization_count|bigint` public.pg_stat_statements|jit_optimization_count|bigint
- **`public.pg_stat_statements|jit_optimization_time|double precision`**:
  - `public.pg_stat_statements|jit_optimization_time|double precision` public.pg_stat_statements|jit_optimization_time|double precision
- **`public.pg_stat_statements|jit_emission_count|bigint`**:
  - `public.pg_stat_statements|jit_emission_count|bigint` public.pg_stat_statements|jit_emission_count|bigint
- **`public.pg_stat_statements|jit_emission_time|double precision`**:
  - `public.pg_stat_statements|jit_emission_time|double precision` public.pg_stat_statements|jit_emission_time|double precision
- **`public.pg_stat_statements_info|dealloc|bigint`**:
  - `public.pg_stat_statements_info|dealloc|bigint` public.pg_stat_statements_info|dealloc|bigint
- **`public.pg_stat_statements_info|stats_reset|timestamp with time zone`**:
  - `public.pg_stat_statements_info|stats_reset|timestamp with time zone` public.pg_stat_statements_info|stats_reset|timestamp with time zone
- **`records.records|id|uuid`**:
  - `records.records|id|uuid` records.records|id|uuid
- **`records.records|user_id|uuid`**:
  - `records.records|user_id|uuid` records.records|user_id|uuid
- **`records.records|artist|character varying(256)`**:
  - `records.records|artist|character varying(256)` records.records|artist|character varying(256)
- **`records.records|name|character varying(256)`**:
  - `records.records|name|character varying(256)` records.records|name|character varying(256)
- **`records.records|format|character varying(64)`**:
  - `records.records|format|character varying(64)` records.records|format|character varying(64)
- **`records.records|catalog_number|character varying(64)`**:
  - `records.records|catalog_number|character varying(64)` records.records|catalog_number|character varying(64)
- **`records.records|record_grade|character varying(16)`**:
  - `records.records|record_grade|character varying(16)` records.records|record_grade|character varying(16)
- **`records.records|sleeve_grade|character varying(16)`**:
  - `records.records|sleeve_grade|character varying(16)` records.records|sleeve_grade|character varying(16)
- **`records.records|has_insert|boolean`**:
  - `records.records|has_insert|boolean` records.records|has_insert|boolean
- **`records.records|has_booklet|boolean`**:
  - `records.records|has_booklet|boolean` records.records|has_booklet|boolean
- **`records.records|has_obi_strip|boolean`**:
  - `records.records|has_obi_strip|boolean` records.records|has_obi_strip|boolean
- **`records.records|has_factory_sleeve|boolean`**:
  - `records.records|has_factory_sleeve|boolean` records.records|has_factory_sleeve|boolean
- **`records.records|is_promo|boolean`**:
  - `records.records|is_promo|boolean` records.records|is_promo|boolean
- **`records.records|notes|text`**:
  - `records.records|notes|text` records.records|notes|text
- **`records.records|purchased_at|date`**:
  - `records.records|purchased_at|date` records.records|purchased_at|date
- **`records.records|price_paid|numeric`**:
  - `records.records|price_paid|numeric` records.records|price_paid|numeric
- **`records.records|created_at|timestamp with time zone`**:
  - `records.records|created_at|timestamp with time zone` records.records|created_at|timestamp with time zone
- **`records.records|updated_at|timestamp with time zone`**:
  - `records.records|updated_at|timestamp with time zone` records.records|updated_at|timestamp with time zone
- **`records.records|insert_grade|character varying(16)`**:
  - `records.records|insert_grade|character varying(16)` records.records|insert_grade|character varying(16)
- **`records.records|booklet_grade|character varying(16)`**:
  - `records.records|booklet_grade|character varying(16)` records.records|booklet_grade|character varying(16)
- **`records.records|obi_strip_grade|character varying(16)`**:
  - `records.records|obi_strip_grade|character varying(16)` records.records|obi_strip_grade|character varying(16)
- **`records.records|factory_sleeve_grade|character varying(16)`**:
  - `records.records|factory_sleeve_grade|character varying(16)` records.records|factory_sleeve_grade|character varying(16)
- **`records.records|release_year|integer`**:
  - `records.records|release_year|integer` records.records|release_year|integer
- **`records.records|release_date|timestamp with time zone`**:
  - `records.records|release_date|timestamp with time zone` records.records|release_date|timestamp with time zone
- **`records.records|pressing_year|integer`**:
  - `records.records|pressing_year|integer` records.records|pressing_year|integer
- **`records.records|label|character varying(128)`**:
  - `records.records|label|character varying(128)` records.records|label|character varying(128)
- **`records.records|label_code|character varying(64)`**:
  - `records.records|label_code|character varying(64)` records.records|label_code|character varying(64)
- **`records.records|search_norm|text`**:
  - `records.records|search_norm|text` records.records|search_norm|text
- **`records.records|search_tsv|tsvector`**:
  - `records.records|search_tsv|tsvector` records.records|search_tsv|tsvector

## Port 5434 — social (record-platform-postgres-social-1)

**Databases:** postgres social 

### DB `postgres`

**Schemas:** public 

  (no user tables — expected for default DB `postgres` / schema `public`; app uses named schemas above)

### DB `social`

**Schemas:** forum messages public 

**Tables (approx. row count from planner):**

| Schema.Table | ~rows |
|--------------|-------|
| forum.comment_attachments | 62 |
| forum.comment_votes | 64 |
| forum.comments | 126 |
| forum.post_attachments | 62 |
| forum.post_votes | 58 |
| forum.posts | 193 |
| messages.group_bans | 0 |
| messages.group_members | 94 |
| messages.groups | 94 |
| messages.message_attachments | 62 |
| messages.message_reads | 32 |
| messages.messages | 345 |
| messages.user_archived_threads | 32 |
| messages.user_deleted_threads | 32 |

**Table definitions (columns):**

- **`forum.comment_attachments|id|uuid`**:
  - `forum.comment_attachments|id|uuid` forum.comment_attachments|id|uuid
- **`forum.comment_attachments|comment_id|uuid`**:
  - `forum.comment_attachments|comment_id|uuid` forum.comment_attachments|comment_id|uuid
- **`forum.comment_attachments|file_url|text`**:
  - `forum.comment_attachments|file_url|text` forum.comment_attachments|file_url|text
- **`forum.comment_attachments|file_path|text`**:
  - `forum.comment_attachments|file_path|text` forum.comment_attachments|file_path|text
- **`forum.comment_attachments|thumbnail_url|text`**:
  - `forum.comment_attachments|thumbnail_url|text` forum.comment_attachments|thumbnail_url|text
- **`forum.comment_attachments|file_name|character varying(512)`**:
  - `forum.comment_attachments|file_name|character varying(512)` forum.comment_attachments|file_name|character varying(512)
- **`forum.comment_attachments|file_size|bigint`**:
  - `forum.comment_attachments|file_size|bigint` forum.comment_attachments|file_size|bigint
- **`forum.comment_attachments|mime_type|character varying(128)`**:
  - `forum.comment_attachments|mime_type|character varying(128)` forum.comment_attachments|mime_type|character varying(128)
- **`forum.comment_attachments|file_type|character varying(32)`**:
  - `forum.comment_attachments|file_type|character varying(32)` forum.comment_attachments|file_type|character varying(32)
- **`forum.comment_attachments|width|integer`**:
  - `forum.comment_attachments|width|integer` forum.comment_attachments|width|integer
- **`forum.comment_attachments|height|integer`**:
  - `forum.comment_attachments|height|integer` forum.comment_attachments|height|integer
- **`forum.comment_attachments|duration|integer`**:
  - `forum.comment_attachments|duration|integer` forum.comment_attachments|duration|integer
- **`forum.comment_attachments|display_order|integer`**:
  - `forum.comment_attachments|display_order|integer` forum.comment_attachments|display_order|integer
- **`forum.comment_attachments|created_at|timestamp with time zone`**:
  - `forum.comment_attachments|created_at|timestamp with time zone` forum.comment_attachments|created_at|timestamp with time zone
- **`forum.comment_votes|id|uuid`**:
  - `forum.comment_votes|id|uuid` forum.comment_votes|id|uuid
- **`forum.comment_votes|comment_id|uuid`**:
  - `forum.comment_votes|comment_id|uuid` forum.comment_votes|comment_id|uuid
- **`forum.comment_votes|user_id|uuid`**:
  - `forum.comment_votes|user_id|uuid` forum.comment_votes|user_id|uuid
- **`forum.comment_votes|vote_type|character varying(8)`**:
  - `forum.comment_votes|vote_type|character varying(8)` forum.comment_votes|vote_type|character varying(8)
- **`forum.comment_votes|created_at|timestamp with time zone`**:
  - `forum.comment_votes|created_at|timestamp with time zone` forum.comment_votes|created_at|timestamp with time zone
- **`forum.comments|id|uuid`**:
  - `forum.comments|id|uuid` forum.comments|id|uuid
- **`forum.comments|post_id|uuid`**:
  - `forum.comments|post_id|uuid` forum.comments|post_id|uuid
- **`forum.comments|user_id|uuid`**:
  - `forum.comments|user_id|uuid` forum.comments|user_id|uuid
- **`forum.comments|parent_id|uuid`**:
  - `forum.comments|parent_id|uuid` forum.comments|parent_id|uuid
- **`forum.comments|content|text`**:
  - `forum.comments|content|text` forum.comments|content|text
- **`forum.comments|upvotes|integer`**:
  - `forum.comments|upvotes|integer` forum.comments|upvotes|integer
- **`forum.comments|downvotes|integer`**:
  - `forum.comments|downvotes|integer` forum.comments|downvotes|integer
- **`forum.comments|created_at|timestamp with time zone`**:
  - `forum.comments|created_at|timestamp with time zone` forum.comments|created_at|timestamp with time zone
- **`forum.comments|updated_at|timestamp with time zone`**:
  - `forum.comments|updated_at|timestamp with time zone` forum.comments|updated_at|timestamp with time zone
- **`forum.post_attachments|id|uuid`**:
  - `forum.post_attachments|id|uuid` forum.post_attachments|id|uuid
- **`forum.post_attachments|post_id|uuid`**:
  - `forum.post_attachments|post_id|uuid` forum.post_attachments|post_id|uuid
- **`forum.post_attachments|file_url|text`**:
  - `forum.post_attachments|file_url|text` forum.post_attachments|file_url|text
- **`forum.post_attachments|file_path|text`**:
  - `forum.post_attachments|file_path|text` forum.post_attachments|file_path|text
- **`forum.post_attachments|thumbnail_url|text`**:
  - `forum.post_attachments|thumbnail_url|text` forum.post_attachments|thumbnail_url|text
- **`forum.post_attachments|file_name|character varying(512)`**:
  - `forum.post_attachments|file_name|character varying(512)` forum.post_attachments|file_name|character varying(512)
- **`forum.post_attachments|file_size|bigint`**:
  - `forum.post_attachments|file_size|bigint` forum.post_attachments|file_size|bigint
- **`forum.post_attachments|mime_type|character varying(128)`**:
  - `forum.post_attachments|mime_type|character varying(128)` forum.post_attachments|mime_type|character varying(128)
- **`forum.post_attachments|file_type|character varying(32)`**:
  - `forum.post_attachments|file_type|character varying(32)` forum.post_attachments|file_type|character varying(32)
- **`forum.post_attachments|width|integer`**:
  - `forum.post_attachments|width|integer` forum.post_attachments|width|integer
- **`forum.post_attachments|height|integer`**:
  - `forum.post_attachments|height|integer` forum.post_attachments|height|integer
- **`forum.post_attachments|duration|integer`**:
  - `forum.post_attachments|duration|integer` forum.post_attachments|duration|integer
- **`forum.post_attachments|display_order|integer`**:
  - `forum.post_attachments|display_order|integer` forum.post_attachments|display_order|integer
- **`forum.post_attachments|created_at|timestamp with time zone`**:
  - `forum.post_attachments|created_at|timestamp with time zone` forum.post_attachments|created_at|timestamp with time zone
- **`forum.post_votes|id|uuid`**:
  - `forum.post_votes|id|uuid` forum.post_votes|id|uuid
- **`forum.post_votes|post_id|uuid`**:
  - `forum.post_votes|post_id|uuid` forum.post_votes|post_id|uuid
- **`forum.post_votes|user_id|uuid`**:
  - `forum.post_votes|user_id|uuid` forum.post_votes|user_id|uuid
- **`forum.post_votes|vote_type|character varying(8)`**:
  - `forum.post_votes|vote_type|character varying(8)` forum.post_votes|vote_type|character varying(8)
- **`forum.post_votes|created_at|timestamp with time zone`**:
  - `forum.post_votes|created_at|timestamp with time zone` forum.post_votes|created_at|timestamp with time zone
- **`forum.posts|id|uuid`**:
  - `forum.posts|id|uuid` forum.posts|id|uuid
- **`forum.posts|user_id|uuid`**:
  - `forum.posts|user_id|uuid` forum.posts|user_id|uuid
- **`forum.posts|title|character varying(512)`**:
  - `forum.posts|title|character varying(512)` forum.posts|title|character varying(512)
- **`forum.posts|content|text`**:
  - `forum.posts|content|text` forum.posts|content|text
- **`forum.posts|flair|character varying(64)`**:
  - `forum.posts|flair|character varying(64)` forum.posts|flair|character varying(64)
- **`forum.posts|upload_type|character varying(32)`**:
  - `forum.posts|upload_type|character varying(32)` forum.posts|upload_type|character varying(32)
- **`forum.posts|upvotes|integer`**:
  - `forum.posts|upvotes|integer` forum.posts|upvotes|integer
- **`forum.posts|downvotes|integer`**:
  - `forum.posts|downvotes|integer` forum.posts|downvotes|integer
- **`forum.posts|comment_count|integer`**:
  - `forum.posts|comment_count|integer` forum.posts|comment_count|integer
- **`forum.posts|is_pinned|boolean`**:
  - `forum.posts|is_pinned|boolean` forum.posts|is_pinned|boolean
- **`forum.posts|is_locked|boolean`**:
  - `forum.posts|is_locked|boolean` forum.posts|is_locked|boolean
- **`forum.posts|created_at|timestamp with time zone`**:
  - `forum.posts|created_at|timestamp with time zone` forum.posts|created_at|timestamp with time zone
- **`forum.posts|updated_at|timestamp with time zone`**:
  - `forum.posts|updated_at|timestamp with time zone` forum.posts|updated_at|timestamp with time zone
- **`messages.group_bans|id|uuid`**:
  - `messages.group_bans|id|uuid` messages.group_bans|id|uuid
- **`messages.group_bans|group_id|uuid`**:
  - `messages.group_bans|group_id|uuid` messages.group_bans|group_id|uuid
- **`messages.group_bans|user_id|uuid`**:
  - `messages.group_bans|user_id|uuid` messages.group_bans|user_id|uuid
- **`messages.group_bans|banned_by|uuid`**:
  - `messages.group_bans|banned_by|uuid` messages.group_bans|banned_by|uuid
- **`messages.group_bans|reason|text`**:
  - `messages.group_bans|reason|text` messages.group_bans|reason|text
- **`messages.group_bans|expires_at|timestamp with time zone`**:
  - `messages.group_bans|expires_at|timestamp with time zone` messages.group_bans|expires_at|timestamp with time zone
- **`messages.group_bans|created_at|timestamp with time zone`**:
  - `messages.group_bans|created_at|timestamp with time zone` messages.group_bans|created_at|timestamp with time zone
- **`messages.group_members|id|uuid`**:
  - `messages.group_members|id|uuid` messages.group_members|id|uuid
- **`messages.group_members|group_id|uuid`**:
  - `messages.group_members|group_id|uuid` messages.group_members|group_id|uuid
- **`messages.group_members|user_id|uuid`**:
  - `messages.group_members|user_id|uuid` messages.group_members|user_id|uuid
- **`messages.group_members|role|character varying(16)`**:
  - `messages.group_members|role|character varying(16)` messages.group_members|role|character varying(16)
- **`messages.group_members|joined_at|timestamp with time zone`**:
  - `messages.group_members|joined_at|timestamp with time zone` messages.group_members|joined_at|timestamp with time zone
- **`messages.group_members|left_at|timestamp with time zone`**:
  - `messages.group_members|left_at|timestamp with time zone` messages.group_members|left_at|timestamp with time zone
- **`messages.groups|id|uuid`**:
  - `messages.groups|id|uuid` messages.groups|id|uuid
- **`messages.groups|name|character varying(256)`**:
  - `messages.groups|name|character varying(256)` messages.groups|name|character varying(256)
- **`messages.groups|description|text`**:
  - `messages.groups|description|text` messages.groups|description|text
- **`messages.groups|created_by|uuid`**:
  - `messages.groups|created_by|uuid` messages.groups|created_by|uuid
- **`messages.groups|created_at|timestamp with time zone`**:
  - `messages.groups|created_at|timestamp with time zone` messages.groups|created_at|timestamp with time zone
- **`messages.groups|updated_at|timestamp with time zone`**:
  - `messages.groups|updated_at|timestamp with time zone` messages.groups|updated_at|timestamp with time zone
- **`messages.groups|archived|boolean`**:
  - `messages.groups|archived|boolean` messages.groups|archived|boolean
- **`messages.message_attachments|id|uuid`**:
  - `messages.message_attachments|id|uuid` messages.message_attachments|id|uuid
- **`messages.message_attachments|message_id|uuid`**:
  - `messages.message_attachments|message_id|uuid` messages.message_attachments|message_id|uuid
- **`messages.message_attachments|file_url|text`**:
  - `messages.message_attachments|file_url|text` messages.message_attachments|file_url|text
- **`messages.message_attachments|file_path|text`**:
  - `messages.message_attachments|file_path|text` messages.message_attachments|file_path|text
- **`messages.message_attachments|thumbnail_url|text`**:
  - `messages.message_attachments|thumbnail_url|text` messages.message_attachments|thumbnail_url|text
- **`messages.message_attachments|file_name|character varying(512)`**:
  - `messages.message_attachments|file_name|character varying(512)` messages.message_attachments|file_name|character varying(512)
- **`messages.message_attachments|file_size|bigint`**:
  - `messages.message_attachments|file_size|bigint` messages.message_attachments|file_size|bigint
- **`messages.message_attachments|mime_type|character varying(128)`**:
  - `messages.message_attachments|mime_type|character varying(128)` messages.message_attachments|mime_type|character varying(128)
- **`messages.message_attachments|file_type|character varying(32)`**:
  - `messages.message_attachments|file_type|character varying(32)` messages.message_attachments|file_type|character varying(32)
- **`messages.message_attachments|width|integer`**:
  - `messages.message_attachments|width|integer` messages.message_attachments|width|integer
- **`messages.message_attachments|height|integer`**:
  - `messages.message_attachments|height|integer` messages.message_attachments|height|integer
- **`messages.message_attachments|duration|integer`**:
  - `messages.message_attachments|duration|integer` messages.message_attachments|duration|integer
- **`messages.message_attachments|display_order|integer`**:
  - `messages.message_attachments|display_order|integer` messages.message_attachments|display_order|integer
- **`messages.message_attachments|created_at|timestamp with time zone`**:
  - `messages.message_attachments|created_at|timestamp with time zone` messages.message_attachments|created_at|timestamp with time zone
- **`messages.message_reads|id|uuid`**:
  - `messages.message_reads|id|uuid` messages.message_reads|id|uuid
- **`messages.message_reads|message_id|uuid`**:
  - `messages.message_reads|message_id|uuid` messages.message_reads|message_id|uuid
- **`messages.message_reads|user_id|uuid`**:
  - `messages.message_reads|user_id|uuid` messages.message_reads|user_id|uuid
- **`messages.message_reads|read_at|timestamp with time zone`**:
  - `messages.message_reads|read_at|timestamp with time zone` messages.message_reads|read_at|timestamp with time zone
- **`messages.message_reads|read_by_sender|boolean`**:
  - `messages.message_reads|read_by_sender|boolean` messages.message_reads|read_by_sender|boolean
- **`messages.messages|id|uuid`**:
  - `messages.messages|id|uuid` messages.messages|id|uuid
- **`messages.messages|sender_id|uuid`**:
  - `messages.messages|sender_id|uuid` messages.messages|sender_id|uuid
- **`messages.messages|recipient_id|uuid`**:
  - `messages.messages|recipient_id|uuid` messages.messages|recipient_id|uuid
- **`messages.messages|group_id|uuid`**:
  - `messages.messages|group_id|uuid` messages.messages|group_id|uuid
- **`messages.messages|parent_message_id|uuid`**:
  - `messages.messages|parent_message_id|uuid` messages.messages|parent_message_id|uuid
- **`messages.messages|thread_id|uuid`**:
  - `messages.messages|thread_id|uuid` messages.messages|thread_id|uuid
- **`messages.messages|message_type|character varying(32)`**:
  - `messages.messages|message_type|character varying(32)` messages.messages|message_type|character varying(32)
- **`messages.messages|subject|character varying(512)`**:
  - `messages.messages|subject|character varying(512)` messages.messages|subject|character varying(512)
- **`messages.messages|content|text`**:
  - `messages.messages|content|text` messages.messages|content|text
- **`messages.messages|is_read|boolean`**:
  - `messages.messages|is_read|boolean` messages.messages|is_read|boolean
- **`messages.messages|sender_display_name|character varying(128)`**:
  - `messages.messages|sender_display_name|character varying(128)` messages.messages|sender_display_name|character varying(128)
- **`messages.messages|created_at|timestamp with time zone`**:
  - `messages.messages|created_at|timestamp with time zone` messages.messages|created_at|timestamp with time zone
- **`messages.messages|updated_at|timestamp with time zone`**:
  - `messages.messages|updated_at|timestamp with time zone` messages.messages|updated_at|timestamp with time zone
- **`messages.messages|recalled_at|timestamp with time zone`**:
  - `messages.messages|recalled_at|timestamp with time zone` messages.messages|recalled_at|timestamp with time zone
- **`messages.messages|archived|boolean`**:
  - `messages.messages|archived|boolean` messages.messages|archived|boolean
- **`messages.user_archived_threads|id|uuid`**:
  - `messages.user_archived_threads|id|uuid` messages.user_archived_threads|id|uuid
- **`messages.user_archived_threads|user_id|uuid`**:
  - `messages.user_archived_threads|user_id|uuid` messages.user_archived_threads|user_id|uuid
- **`messages.user_archived_threads|thread_id|uuid`**:
  - `messages.user_archived_threads|thread_id|uuid` messages.user_archived_threads|thread_id|uuid
- **`messages.user_archived_threads|archived_at|timestamp with time zone`**:
  - `messages.user_archived_threads|archived_at|timestamp with time zone` messages.user_archived_threads|archived_at|timestamp with time zone
- **`messages.user_deleted_threads|id|uuid`**:
  - `messages.user_deleted_threads|id|uuid` messages.user_deleted_threads|id|uuid
- **`messages.user_deleted_threads|user_id|uuid`**:
  - `messages.user_deleted_threads|user_id|uuid` messages.user_deleted_threads|user_id|uuid
- **`messages.user_deleted_threads|thread_id|uuid`**:
  - `messages.user_deleted_threads|thread_id|uuid` messages.user_deleted_threads|thread_id|uuid
- **`messages.user_deleted_threads|deleted_at|timestamp with time zone`**:
  - `messages.user_deleted_threads|deleted_at|timestamp with time zone` messages.user_deleted_threads|deleted_at|timestamp with time zone

## Port 5435 — listings (record-platform-postgres-listings-1)

**Databases:** listings postgres 

### DB `listings`

**Schemas:** feedback listings public 

**Tables (approx. row count from planner):**

| Schema.Table | ~rows |
|--------------|-------|
| feedback.collection_stats | 0 |
| feedback.reviews | 0 |
| feedback.user_activity | 0 |
| feedback.user_profiles | 0 |
| listings.auction_details | 62 |
| listings.bids | 124 |
| listings.listing_images | 124 |
| listings.listing_reports | 0 |
| listings.listing_shipping_options | 0 |
| listings.listing_videos | 0 |
| listings.listing_views | 0 |
| listings.listings | 257 |
| listings.offers | 124 |
| listings.ratings | 55 |
| listings.seller_availability | 0 |
| listings.user_settings | 54 |
| listings.watchlist | 62 |

**Table definitions (columns):**

- **`feedback.collection_stats|user_id|uuid`**:
  - `feedback.collection_stats|user_id|uuid` feedback.collection_stats|user_id|uuid
- **`feedback.collection_stats|record_count|integer`**:
  - `feedback.collection_stats|record_count|integer` feedback.collection_stats|record_count|integer
- **`feedback.collection_stats|visible|boolean`**:
  - `feedback.collection_stats|visible|boolean` feedback.collection_stats|visible|boolean
- **`feedback.collection_stats|updated_at|timestamp with time zone`**:
  - `feedback.collection_stats|updated_at|timestamp with time zone` feedback.collection_stats|updated_at|timestamp with time zone
- **`feedback.reviews|id|uuid`**:
  - `feedback.reviews|id|uuid` feedback.reviews|id|uuid
- **`feedback.reviews|reviewer_id|uuid`**:
  - `feedback.reviews|reviewer_id|uuid` feedback.reviews|reviewer_id|uuid
- **`feedback.reviews|reviewee_id|uuid`**:
  - `feedback.reviews|reviewee_id|uuid` feedback.reviews|reviewee_id|uuid
- **`feedback.reviews|role|character varying(16)`**:
  - `feedback.reviews|role|character varying(16)` feedback.reviews|role|character varying(16)
- **`feedback.reviews|transaction_id|uuid`**:
  - `feedback.reviews|transaction_id|uuid` feedback.reviews|transaction_id|uuid
- **`feedback.reviews|rating|smallint`**:
  - `feedback.reviews|rating|smallint` feedback.reviews|rating|smallint
- **`feedback.reviews|comment|text`**:
  - `feedback.reviews|comment|text` feedback.reviews|comment|text
- **`feedback.reviews|created_at|timestamp with time zone`**:
  - `feedback.reviews|created_at|timestamp with time zone` feedback.reviews|created_at|timestamp with time zone
- **`feedback.user_activity|id|bigint`**:
  - `feedback.user_activity|id|bigint` feedback.user_activity|id|bigint
- **`feedback.user_activity|user_id|uuid`**:
  - `feedback.user_activity|user_id|uuid` feedback.user_activity|user_id|uuid
- **`feedback.user_activity|activity_type|character varying(64)`**:
  - `feedback.user_activity|activity_type|character varying(64)` feedback.user_activity|activity_type|character varying(64)
- **`feedback.user_activity|payload|jsonb`**:
  - `feedback.user_activity|payload|jsonb` feedback.user_activity|payload|jsonb
- **`feedback.user_activity|created_at|timestamp with time zone`**:
  - `feedback.user_activity|created_at|timestamp with time zone` feedback.user_activity|created_at|timestamp with time zone
- **`feedback.user_profiles|user_id|uuid`**:
  - `feedback.user_profiles|user_id|uuid` feedback.user_profiles|user_id|uuid
- **`feedback.user_profiles|display_name|character varying(128)`**:
  - `feedback.user_profiles|display_name|character varying(128)` feedback.user_profiles|display_name|character varying(128)
- **`feedback.user_profiles|bio|text`**:
  - `feedback.user_profiles|bio|text` feedback.user_profiles|bio|text
- **`feedback.user_profiles|collection_visible|boolean`**:
  - `feedback.user_profiles|collection_visible|boolean` feedback.user_profiles|collection_visible|boolean
- **`feedback.user_profiles|created_at|timestamp with time zone`**:
  - `feedback.user_profiles|created_at|timestamp with time zone` feedback.user_profiles|created_at|timestamp with time zone
- **`feedback.user_profiles|updated_at|timestamp with time zone`**:
  - `feedback.user_profiles|updated_at|timestamp with time zone` feedback.user_profiles|updated_at|timestamp with time zone
- **`listings.active_auctions|id|uuid`**:
  - `listings.active_auctions|id|uuid` listings.active_auctions|id|uuid
- **`listings.active_auctions|title|character varying(512)`**:
  - `listings.active_auctions|title|character varying(512)` listings.active_auctions|title|character varying(512)
- **`listings.active_auctions|seller_id|uuid`**:
  - `listings.active_auctions|seller_id|uuid` listings.active_auctions|seller_id|uuid
- **`listings.active_auctions|current_bid|numeric`**:
  - `listings.active_auctions|current_bid|numeric` listings.active_auctions|current_bid|numeric
- **`listings.active_auctions|starting_bid|numeric`**:
  - `listings.active_auctions|starting_bid|numeric` listings.active_auctions|starting_bid|numeric
- **`listings.active_auctions|end_time|timestamp with time zone`**:
  - `listings.active_auctions|end_time|timestamp with time zone` listings.active_auctions|end_time|timestamp with time zone
- **`listings.active_auctions|bid_count|integer`**:
  - `listings.active_auctions|bid_count|integer` listings.active_auctions|bid_count|integer
- **`listings.active_auctions|hours_remaining|numeric`**:
  - `listings.active_auctions|hours_remaining|numeric` listings.active_auctions|hours_remaining|numeric
- **`listings.active_auctions|status|text`**:
  - `listings.active_auctions|status|text` listings.active_auctions|status|text
- **`listings.auction_details|id|uuid`**:
  - `listings.auction_details|id|uuid` listings.auction_details|id|uuid
- **`listings.auction_details|listing_id|uuid`**:
  - `listings.auction_details|listing_id|uuid` listings.auction_details|listing_id|uuid
- **`listings.auction_details|starting_bid|numeric`**:
  - `listings.auction_details|starting_bid|numeric` listings.auction_details|starting_bid|numeric
- **`listings.auction_details|current_bid|numeric`**:
  - `listings.auction_details|current_bid|numeric` listings.auction_details|current_bid|numeric
- **`listings.auction_details|current_bidder|uuid`**:
  - `listings.auction_details|current_bidder|uuid` listings.auction_details|current_bidder|uuid
- **`listings.auction_details|reserve_price|numeric`**:
  - `listings.auction_details|reserve_price|numeric` listings.auction_details|reserve_price|numeric
- **`listings.auction_details|bid_increment|numeric`**:
  - `listings.auction_details|bid_increment|numeric` listings.auction_details|bid_increment|numeric
- **`listings.auction_details|start_time|timestamp with time zone`**:
  - `listings.auction_details|start_time|timestamp with time zone` listings.auction_details|start_time|timestamp with time zone
- **`listings.auction_details|end_time|timestamp with time zone`**:
  - `listings.auction_details|end_time|timestamp with time zone` listings.auction_details|end_time|timestamp with time zone
- **`listings.auction_details|bid_count|integer`**:
  - `listings.auction_details|bid_count|integer` listings.auction_details|bid_count|integer
- **`listings.auction_details|created_at|timestamp with time zone`**:
  - `listings.auction_details|created_at|timestamp with time zone` listings.auction_details|created_at|timestamp with time zone
- **`listings.auction_details|updated_at|timestamp with time zone`**:
  - `listings.auction_details|updated_at|timestamp with time zone` listings.auction_details|updated_at|timestamp with time zone
- **`listings.bids|id|uuid`**:
  - `listings.bids|id|uuid` listings.bids|id|uuid
- **`listings.bids|listing_id|uuid`**:
  - `listings.bids|listing_id|uuid` listings.bids|listing_id|uuid
- **`listings.bids|user_id|uuid`**:
  - `listings.bids|user_id|uuid` listings.bids|user_id|uuid
- **`listings.bids|bid_amount|numeric`**:
  - `listings.bids|bid_amount|numeric` listings.bids|bid_amount|numeric
- **`listings.bids|is_winning|boolean`**:
  - `listings.bids|is_winning|boolean` listings.bids|is_winning|boolean
- **`listings.bids|created_at|timestamp with time zone`**:
  - `listings.bids|created_at|timestamp with time zone` listings.bids|created_at|timestamp with time zone
- **`listings.listing_images|id|uuid`**:
  - `listings.listing_images|id|uuid` listings.listing_images|id|uuid
- **`listings.listing_images|listing_id|uuid`**:
  - `listings.listing_images|listing_id|uuid` listings.listing_images|listing_id|uuid
- **`listings.listing_images|image_url|text`**:
  - `listings.listing_images|image_url|text` listings.listing_images|image_url|text
- **`listings.listing_images|image_path|text`**:
  - `listings.listing_images|image_path|text` listings.listing_images|image_path|text
- **`listings.listing_images|thumbnail_url|text`**:
  - `listings.listing_images|thumbnail_url|text` listings.listing_images|thumbnail_url|text
- **`listings.listing_images|display_order|integer`**:
  - `listings.listing_images|display_order|integer` listings.listing_images|display_order|integer
- **`listings.listing_images|is_primary|boolean`**:
  - `listings.listing_images|is_primary|boolean` listings.listing_images|is_primary|boolean
- **`listings.listing_images|file_size|bigint`**:
  - `listings.listing_images|file_size|bigint` listings.listing_images|file_size|bigint
- **`listings.listing_images|mime_type|character varying(128)`**:
  - `listings.listing_images|mime_type|character varying(128)` listings.listing_images|mime_type|character varying(128)
- **`listings.listing_images|width|integer`**:
  - `listings.listing_images|width|integer` listings.listing_images|width|integer
- **`listings.listing_images|height|integer`**:
  - `listings.listing_images|height|integer` listings.listing_images|height|integer
- **`listings.listing_images|created_at|timestamp with time zone`**:
  - `listings.listing_images|created_at|timestamp with time zone` listings.listing_images|created_at|timestamp with time zone
- **`listings.listing_reports|id|uuid`**:
  - `listings.listing_reports|id|uuid` listings.listing_reports|id|uuid
- **`listings.listing_reports|listing_id|uuid`**:
  - `listings.listing_reports|listing_id|uuid` listings.listing_reports|listing_id|uuid
- **`listings.listing_reports|reporter_id|uuid`**:
  - `listings.listing_reports|reporter_id|uuid` listings.listing_reports|reporter_id|uuid
- **`listings.listing_reports|reason_code|character varying(64)`**:
  - `listings.listing_reports|reason_code|character varying(64)` listings.listing_reports|reason_code|character varying(64)
- **`listings.listing_reports|reason_text|text`**:
  - `listings.listing_reports|reason_text|text` listings.listing_reports|reason_text|text
- **`listings.listing_reports|status|character varying(32)`**:
  - `listings.listing_reports|status|character varying(32)` listings.listing_reports|status|character varying(32)
- **`listings.listing_reports|message_to_lister_id|uuid`**:
  - `listings.listing_reports|message_to_lister_id|uuid` listings.listing_reports|message_to_lister_id|uuid
- **`listings.listing_reports|reviewed_at|timestamp with time zone`**:
  - `listings.listing_reports|reviewed_at|timestamp with time zone` listings.listing_reports|reviewed_at|timestamp with time zone
- **`listings.listing_reports|reviewed_by|uuid`**:
  - `listings.listing_reports|reviewed_by|uuid` listings.listing_reports|reviewed_by|uuid
- **`listings.listing_reports|created_at|timestamp with time zone`**:
  - `listings.listing_reports|created_at|timestamp with time zone` listings.listing_reports|created_at|timestamp with time zone
- **`listings.listing_reports|updated_at|timestamp with time zone`**:
  - `listings.listing_reports|updated_at|timestamp with time zone` listings.listing_reports|updated_at|timestamp with time zone
- **`listings.listing_reports|complaint_sent_at|timestamp with time zone`**:
  - `listings.listing_reports|complaint_sent_at|timestamp with time zone` listings.listing_reports|complaint_sent_at|timestamp with time zone
- **`listings.listing_shipping_options|id|uuid`**:
  - `listings.listing_shipping_options|id|uuid` listings.listing_shipping_options|id|uuid
- **`listings.listing_shipping_options|listing_id|uuid`**:
  - `listings.listing_shipping_options|listing_id|uuid` listings.listing_shipping_options|listing_id|uuid
- **`listings.listing_shipping_options|label|character varying(128)`**:
  - `listings.listing_shipping_options|label|character varying(128)` listings.listing_shipping_options|label|character varying(128)
- **`listings.listing_shipping_options|cost|numeric`**:
  - `listings.listing_shipping_options|cost|numeric` listings.listing_shipping_options|cost|numeric
- **`listings.listing_shipping_options|method|character varying(128)`**:
  - `listings.listing_shipping_options|method|character varying(128)` listings.listing_shipping_options|method|character varying(128)
- **`listings.listing_shipping_options|sort_order|integer`**:
  - `listings.listing_shipping_options|sort_order|integer` listings.listing_shipping_options|sort_order|integer
- **`listings.listing_shipping_options|created_at|timestamp with time zone`**:
  - `listings.listing_shipping_options|created_at|timestamp with time zone` listings.listing_shipping_options|created_at|timestamp with time zone
- **`listings.listing_videos|id|uuid`**:
  - `listings.listing_videos|id|uuid` listings.listing_videos|id|uuid
- **`listings.listing_videos|listing_id|uuid`**:
  - `listings.listing_videos|listing_id|uuid` listings.listing_videos|listing_id|uuid
- **`listings.listing_videos|video_url|text`**:
  - `listings.listing_videos|video_url|text` listings.listing_videos|video_url|text
- **`listings.listing_videos|thumbnail_url|text`**:
  - `listings.listing_videos|thumbnail_url|text` listings.listing_videos|thumbnail_url|text
- **`listings.listing_videos|display_order|integer`**:
  - `listings.listing_videos|display_order|integer` listings.listing_videos|display_order|integer
- **`listings.listing_videos|duration_secs|integer`**:
  - `listings.listing_videos|duration_secs|integer` listings.listing_videos|duration_secs|integer
- **`listings.listing_videos|mime_type|character varying(128)`**:
  - `listings.listing_videos|mime_type|character varying(128)` listings.listing_videos|mime_type|character varying(128)
- **`listings.listing_videos|file_size|bigint`**:
  - `listings.listing_videos|file_size|bigint` listings.listing_videos|file_size|bigint
- **`listings.listing_videos|created_at|timestamp with time zone`**:
  - `listings.listing_videos|created_at|timestamp with time zone` listings.listing_videos|created_at|timestamp with time zone
- **`listings.listing_views|id|uuid`**:
  - `listings.listing_views|id|uuid` listings.listing_views|id|uuid
- **`listings.listing_views|listing_id|uuid`**:
  - `listings.listing_views|listing_id|uuid` listings.listing_views|listing_id|uuid
- **`listings.listing_views|user_id|uuid`**:
  - `listings.listing_views|user_id|uuid` listings.listing_views|user_id|uuid
- **`listings.listing_views|ip_address|inet`**:
  - `listings.listing_views|ip_address|inet` listings.listing_views|ip_address|inet
- **`listings.listing_views|user_agent|text`**:
  - `listings.listing_views|user_agent|text` listings.listing_views|user_agent|text
- **`listings.listing_views|viewed_at|timestamp with time zone`**:
  - `listings.listing_views|viewed_at|timestamp with time zone` listings.listing_views|viewed_at|timestamp with time zone
- **`listings.listings|id|uuid`**:
  - `listings.listings|id|uuid` listings.listings|id|uuid
- **`listings.listings|user_id|uuid`**:
  - `listings.listings|user_id|uuid` listings.listings|user_id|uuid
- **`listings.listings|title|character varying(512)`**:
  - `listings.listings|title|character varying(512)` listings.listings|title|character varying(512)
- **`listings.listings|description|text`**:
  - `listings.listings|description|text` listings.listings|description|text
- **`listings.listings|price|numeric`**:
  - `listings.listings|price|numeric` listings.listings|price|numeric
- **`listings.listings|currency|character varying(3)`**:
  - `listings.listings|currency|character varying(3)` listings.listings|currency|character varying(3)
- **`listings.listings|listing_type|character varying(32)`**:
  - `listings.listings|listing_type|character varying(32)` listings.listings|listing_type|character varying(32)
- **`listings.listings|condition|character varying(64)`**:
  - `listings.listings|condition|character varying(64)` listings.listings|condition|character varying(64)
- **`listings.listings|catalog_id|character varying(128)`**:
  - `listings.listings|catalog_id|character varying(128)` listings.listings|catalog_id|character varying(128)
- **`listings.listings|category|character varying(128)`**:
  - `listings.listings|category|character varying(128)` listings.listings|category|character varying(128)
- **`listings.listings|location|character varying(256)`**:
  - `listings.listings|location|character varying(256)` listings.listings|location|character varying(256)
- **`listings.listings|shipping_cost|numeric`**:
  - `listings.listings|shipping_cost|numeric` listings.listings|shipping_cost|numeric
- **`listings.listings|shipping_method|character varying(128)`**:
  - `listings.listings|shipping_method|character varying(128)` listings.listings|shipping_method|character varying(128)
- **`listings.listings|is_active|boolean`**:
  - `listings.listings|is_active|boolean` listings.listings|is_active|boolean
- **`listings.listings|is_featured|boolean`**:
  - `listings.listings|is_featured|boolean` listings.listings|is_featured|boolean
- **`listings.listings|view_count|integer`**:
  - `listings.listings|view_count|integer` listings.listings|view_count|integer
- **`listings.listings|watch_count|integer`**:
  - `listings.listings|watch_count|integer` listings.listings|watch_count|integer
- **`listings.listings|created_at|timestamp with time zone`**:
  - `listings.listings|created_at|timestamp with time zone` listings.listings|created_at|timestamp with time zone
- **`listings.listings|updated_at|timestamp with time zone`**:
  - `listings.listings|updated_at|timestamp with time zone` listings.listings|updated_at|timestamp with time zone
- **`listings.listings|expires_at|timestamp with time zone`**:
  - `listings.listings|expires_at|timestamp with time zone` listings.listings|expires_at|timestamp with time zone
- **`listings.listings|sold_at|timestamp with time zone`**:
  - `listings.listings|sold_at|timestamp with time zone` listings.listings|sold_at|timestamp with time zone
- **`listings.listings|sold_to|uuid`**:
  - `listings.listings|sold_to|uuid` listings.listings|sold_to|uuid
- **`listings.listings|seller_rating|numeric`**:
  - `listings.listings|seller_rating|numeric` listings.listings|seller_rating|numeric
- **`listings.listings|seller_rating_count|integer`**:
  - `listings.listings|seller_rating_count|integer` listings.listings|seller_rating_count|integer
- **`listings.listings|discount_price|numeric`**:
  - `listings.listings|discount_price|numeric` listings.listings|discount_price|numeric
- **`listings.listings|sale_ends_at|timestamp with time zone`**:
  - `listings.listings|sale_ends_at|timestamp with time zone` listings.listings|sale_ends_at|timestamp with time zone
- **`listings.listings|bundle_id|uuid`**:
  - `listings.listings|bundle_id|uuid` listings.listings|bundle_id|uuid
- **`listings.listings|shipping_type|character varying(32)`**:
  - `listings.listings|shipping_type|character varying(32)` listings.listings|shipping_type|character varying(32)
- **`listings.listings|seller_country|character(2)`**:
  - `listings.listings|seller_country|character(2)` listings.listings|seller_country|character(2)
- **`listings.listings|promotion_type|character varying(32)`**:
  - `listings.listings|promotion_type|character varying(32)` listings.listings|promotion_type|character varying(32)
- **`listings.listings|promotion_ends_at|timestamp with time zone`**:
  - `listings.listings|promotion_ends_at|timestamp with time zone` listings.listings|promotion_ends_at|timestamp with time zone
- **`listings.listings|returned_at|timestamp with time zone`**:
  - `listings.listings|returned_at|timestamp with time zone` listings.listings|returned_at|timestamp with time zone
- **`listings.listings|returned_from_order_id|uuid`**:
  - `listings.listings|returned_from_order_id|uuid` listings.listings|returned_from_order_id|uuid
- **`listings.listings|ended_at|timestamp with time zone`**:
  - `listings.listings|ended_at|timestamp with time zone` listings.listings|ended_at|timestamp with time zone
- **`listings.listings|obo_until|timestamp with time zone`**:
  - `listings.listings|obo_until|timestamp with time zone` listings.listings|obo_until|timestamp with time zone
- **`listings.listings|stock_quantity|integer`**:
  - `listings.listings|stock_quantity|integer` listings.listings|stock_quantity|integer
- **`listings.listings|visible_until|timestamp with time zone`**:
  - `listings.listings|visible_until|timestamp with time zone` listings.listings|visible_until|timestamp with time zone
- **`listings.listings|duration_days|integer`**:
  - `listings.listings|duration_days|integer` listings.listings|duration_days|integer
- **`listings.listings|visible_from|timestamp with time zone`**:
  - `listings.listings|visible_from|timestamp with time zone` listings.listings|visible_from|timestamp with time zone
- **`listings.listings|media_type|character varying(32)`**:
  - `listings.listings|media_type|character varying(32)` listings.listings|media_type|character varying(32)
- **`listings.listings|has_obi|boolean`**:
  - `listings.listings|has_obi|boolean` listings.listings|has_obi|boolean
- **`listings.listings|label_type|character varying(128)`**:
  - `listings.listings|label_type|character varying(128)` listings.listings|label_type|character varying(128)
- **`listings.listings|popularity_score|integer`**:
  - `listings.listings|popularity_score|integer` listings.listings|popularity_score|integer
- **`listings.offers|id|uuid`**:
  - `listings.offers|id|uuid` listings.offers|id|uuid
- **`listings.offers|listing_id|uuid`**:
  - `listings.offers|listing_id|uuid` listings.offers|listing_id|uuid
- **`listings.offers|user_id|uuid`**:
  - `listings.offers|user_id|uuid` listings.offers|user_id|uuid
- **`listings.offers|offer_amount|numeric`**:
  - `listings.offers|offer_amount|numeric` listings.offers|offer_amount|numeric
- **`listings.offers|message|text`**:
  - `listings.offers|message|text` listings.offers|message|text
- **`listings.offers|status|character varying(32)`**:
  - `listings.offers|status|character varying(32)` listings.offers|status|character varying(32)
- **`listings.offers|expires_at|timestamp with time zone`**:
  - `listings.offers|expires_at|timestamp with time zone` listings.offers|expires_at|timestamp with time zone
- **`listings.offers|responded_at|timestamp with time zone`**:
  - `listings.offers|responded_at|timestamp with time zone` listings.offers|responded_at|timestamp with time zone
- **`listings.offers|counter_offer|numeric`**:
  - `listings.offers|counter_offer|numeric` listings.offers|counter_offer|numeric
- **`listings.offers|created_at|timestamp with time zone`**:
  - `listings.offers|created_at|timestamp with time zone` listings.offers|created_at|timestamp with time zone
- **`listings.offers|updated_at|timestamp with time zone`**:
  - `listings.offers|updated_at|timestamp with time zone` listings.offers|updated_at|timestamp with time zone
- **`listings.ratings|id|uuid`**:
  - `listings.ratings|id|uuid` listings.ratings|id|uuid
- **`listings.ratings|listing_id|uuid`**:
  - `listings.ratings|listing_id|uuid` listings.ratings|listing_id|uuid
- **`listings.ratings|user_id|uuid`**:
  - `listings.ratings|user_id|uuid` listings.ratings|user_id|uuid
- **`listings.ratings|seller_id|uuid`**:
  - `listings.ratings|seller_id|uuid` listings.ratings|seller_id|uuid
- **`listings.ratings|rating|integer`**:
  - `listings.ratings|rating|integer` listings.ratings|rating|integer
- **`listings.ratings|review_text|text`**:
  - `listings.ratings|review_text|text` listings.ratings|review_text|text
- **`listings.ratings|transaction_id|uuid`**:
  - `listings.ratings|transaction_id|uuid` listings.ratings|transaction_id|uuid
- **`listings.ratings|created_at|timestamp with time zone`**:
  - `listings.ratings|created_at|timestamp with time zone` listings.ratings|created_at|timestamp with time zone
- **`listings.ratings|updated_at|timestamp with time zone`**:
  - `listings.ratings|updated_at|timestamp with time zone` listings.ratings|updated_at|timestamp with time zone
- **`listings.seller_availability|id|uuid`**:
  - `listings.seller_availability|id|uuid` listings.seller_availability|id|uuid
- **`listings.seller_availability|user_id|uuid`**:
  - `listings.seller_availability|user_id|uuid` listings.seller_availability|user_id|uuid
- **`listings.seller_availability|is_available|boolean`**:
  - `listings.seller_availability|is_available|boolean` listings.seller_availability|is_available|boolean
- **`listings.seller_availability|preferred_hours|text`**:
  - `listings.seller_availability|preferred_hours|text` listings.seller_availability|preferred_hours|text
- **`listings.seller_availability|unavailable_until|timestamp with time zone`**:
  - `listings.seller_availability|unavailable_until|timestamp with time zone` listings.seller_availability|unavailable_until|timestamp with time zone
- **`listings.seller_availability|message|text`**:
  - `listings.seller_availability|message|text` listings.seller_availability|message|text
- **`listings.seller_availability|updated_at|timestamp with time zone`**:
  - `listings.seller_availability|updated_at|timestamp with time zone` listings.seller_availability|updated_at|timestamp with time zone
- **`listings.user_settings|user_id|uuid`**:
  - `listings.user_settings|user_id|uuid` listings.user_settings|user_id|uuid
- **`listings.user_settings|country_code|text`**:
  - `listings.user_settings|country_code|text` listings.user_settings|country_code|text
- **`listings.user_settings|currency|text`**:
  - `listings.user_settings|currency|text` listings.user_settings|currency|text
- **`listings.user_settings|fee_rate|numeric`**:
  - `listings.user_settings|fee_rate|numeric` listings.user_settings|fee_rate|numeric
- **`listings.user_settings|duty_rate|numeric`**:
  - `listings.user_settings|duty_rate|numeric` listings.user_settings|duty_rate|numeric
- **`listings.user_settings|timezone|character varying(64)`**:
  - `listings.user_settings|timezone|character varying(64)` listings.user_settings|timezone|character varying(64)
- **`listings.user_settings|auction_deadline_reminder|boolean`**:
  - `listings.user_settings|auction_deadline_reminder|boolean` listings.user_settings|auction_deadline_reminder|boolean
- **`listings.user_settings|auction_deadline_hours_before|integer`**:
  - `listings.user_settings|auction_deadline_hours_before|integer` listings.user_settings|auction_deadline_hours_before|integer
- **`listings.user_settings|preferred_auction_end_time|time without time zone`**:
  - `listings.user_settings|preferred_auction_end_time|time without time zone` listings.user_settings|preferred_auction_end_time|time without time zone
- **`listings.user_settings|items_per_page|integer`**:
  - `listings.user_settings|items_per_page|integer` listings.user_settings|items_per_page|integer
- **`listings.user_settings|display_style|character varying(20)`**:
  - `listings.user_settings|display_style|character varying(20)` listings.user_settings|display_style|character varying(20)
- **`listings.visible_listings|id|uuid`**:
  - `listings.visible_listings|id|uuid` listings.visible_listings|id|uuid
- **`listings.visible_listings|user_id|uuid`**:
  - `listings.visible_listings|user_id|uuid` listings.visible_listings|user_id|uuid
- **`listings.visible_listings|title|character varying(512)`**:
  - `listings.visible_listings|title|character varying(512)` listings.visible_listings|title|character varying(512)
- **`listings.visible_listings|description|text`**:
  - `listings.visible_listings|description|text` listings.visible_listings|description|text
- **`listings.visible_listings|price|numeric`**:
  - `listings.visible_listings|price|numeric` listings.visible_listings|price|numeric
- **`listings.visible_listings|currency|character varying(3)`**:
  - `listings.visible_listings|currency|character varying(3)` listings.visible_listings|currency|character varying(3)
- **`listings.visible_listings|listing_type|character varying(32)`**:
  - `listings.visible_listings|listing_type|character varying(32)` listings.visible_listings|listing_type|character varying(32)
- **`listings.visible_listings|condition|character varying(64)`**:
  - `listings.visible_listings|condition|character varying(64)` listings.visible_listings|condition|character varying(64)
- **`listings.visible_listings|catalog_id|character varying(128)`**:
  - `listings.visible_listings|catalog_id|character varying(128)` listings.visible_listings|catalog_id|character varying(128)
- **`listings.visible_listings|category|character varying(128)`**:
  - `listings.visible_listings|category|character varying(128)` listings.visible_listings|category|character varying(128)
- **`listings.visible_listings|location|character varying(256)`**:
  - `listings.visible_listings|location|character varying(256)` listings.visible_listings|location|character varying(256)
- **`listings.visible_listings|shipping_cost|numeric`**:
  - `listings.visible_listings|shipping_cost|numeric` listings.visible_listings|shipping_cost|numeric
- **`listings.visible_listings|shipping_method|character varying(128)`**:
  - `listings.visible_listings|shipping_method|character varying(128)` listings.visible_listings|shipping_method|character varying(128)
- **`listings.visible_listings|is_active|boolean`**:
  - `listings.visible_listings|is_active|boolean` listings.visible_listings|is_active|boolean
- **`listings.visible_listings|is_featured|boolean`**:
  - `listings.visible_listings|is_featured|boolean` listings.visible_listings|is_featured|boolean
- **`listings.visible_listings|view_count|integer`**:
  - `listings.visible_listings|view_count|integer` listings.visible_listings|view_count|integer
- **`listings.visible_listings|watch_count|integer`**:
  - `listings.visible_listings|watch_count|integer` listings.visible_listings|watch_count|integer
- **`listings.visible_listings|created_at|timestamp with time zone`**:
  - `listings.visible_listings|created_at|timestamp with time zone` listings.visible_listings|created_at|timestamp with time zone
- **`listings.visible_listings|updated_at|timestamp with time zone`**:
  - `listings.visible_listings|updated_at|timestamp with time zone` listings.visible_listings|updated_at|timestamp with time zone
- **`listings.visible_listings|expires_at|timestamp with time zone`**:
  - `listings.visible_listings|expires_at|timestamp with time zone` listings.visible_listings|expires_at|timestamp with time zone
- **`listings.visible_listings|sold_at|timestamp with time zone`**:
  - `listings.visible_listings|sold_at|timestamp with time zone` listings.visible_listings|sold_at|timestamp with time zone
- **`listings.visible_listings|sold_to|uuid`**:
  - `listings.visible_listings|sold_to|uuid` listings.visible_listings|sold_to|uuid
- **`listings.visible_listings|seller_rating|numeric`**:
  - `listings.visible_listings|seller_rating|numeric` listings.visible_listings|seller_rating|numeric
- **`listings.visible_listings|seller_rating_count|integer`**:
  - `listings.visible_listings|seller_rating_count|integer` listings.visible_listings|seller_rating_count|integer
- **`listings.visible_listings|discount_price|numeric`**:
  - `listings.visible_listings|discount_price|numeric` listings.visible_listings|discount_price|numeric
- **`listings.visible_listings|sale_ends_at|timestamp with time zone`**:
  - `listings.visible_listings|sale_ends_at|timestamp with time zone` listings.visible_listings|sale_ends_at|timestamp with time zone
- **`listings.visible_listings|bundle_id|uuid`**:
  - `listings.visible_listings|bundle_id|uuid` listings.visible_listings|bundle_id|uuid
- **`listings.visible_listings|shipping_type|character varying(32)`**:
  - `listings.visible_listings|shipping_type|character varying(32)` listings.visible_listings|shipping_type|character varying(32)
- **`listings.visible_listings|seller_country|character(2)`**:
  - `listings.visible_listings|seller_country|character(2)` listings.visible_listings|seller_country|character(2)
- **`listings.visible_listings|promotion_type|character varying(32)`**:
  - `listings.visible_listings|promotion_type|character varying(32)` listings.visible_listings|promotion_type|character varying(32)
- **`listings.visible_listings|promotion_ends_at|timestamp with time zone`**:
  - `listings.visible_listings|promotion_ends_at|timestamp with time zone` listings.visible_listings|promotion_ends_at|timestamp with time zone
- **`listings.visible_listings|returned_at|timestamp with time zone`**:
  - `listings.visible_listings|returned_at|timestamp with time zone` listings.visible_listings|returned_at|timestamp with time zone
- **`listings.visible_listings|returned_from_order_id|uuid`**:
  - `listings.visible_listings|returned_from_order_id|uuid` listings.visible_listings|returned_from_order_id|uuid
- **`listings.visible_listings|ended_at|timestamp with time zone`**:
  - `listings.visible_listings|ended_at|timestamp with time zone` listings.visible_listings|ended_at|timestamp with time zone
- **`listings.visible_listings|obo_until|timestamp with time zone`**:
  - `listings.visible_listings|obo_until|timestamp with time zone` listings.visible_listings|obo_until|timestamp with time zone
- **`listings.visible_listings|stock_quantity|integer`**:
  - `listings.visible_listings|stock_quantity|integer` listings.visible_listings|stock_quantity|integer
- **`listings.visible_listings|visible_until|timestamp with time zone`**:
  - `listings.visible_listings|visible_until|timestamp with time zone` listings.visible_listings|visible_until|timestamp with time zone
- **`listings.visible_listings|duration_days|integer`**:
  - `listings.visible_listings|duration_days|integer` listings.visible_listings|duration_days|integer
- **`listings.visible_listings|visible_from|timestamp with time zone`**:
  - `listings.visible_listings|visible_from|timestamp with time zone` listings.visible_listings|visible_from|timestamp with time zone
- **`listings.watchlist|id|uuid`**:
  - `listings.watchlist|id|uuid` listings.watchlist|id|uuid
- **`listings.watchlist|user_id|uuid`**:
  - `listings.watchlist|user_id|uuid` listings.watchlist|user_id|uuid
- **`listings.watchlist|listing_id|uuid`**:
  - `listings.watchlist|listing_id|uuid` listings.watchlist|listing_id|uuid
- **`listings.watchlist|created_at|timestamp with time zone`**:
  - `listings.watchlist|created_at|timestamp with time zone` listings.watchlist|created_at|timestamp with time zone

### DB `postgres`

**Schemas:** public 

  (no user tables — expected for default DB `postgres` / schema `public`; app uses named schemas above)

## Port 5436 — shopping (record-platform-postgres-shopping-1)

**Databases:** postgres shopping 

### DB `postgres`

**Schemas:** public 

  (no user tables — expected for default DB `postgres` / schema `public`; app uses named schemas above)

### DB `shopping`

**Schemas:** feedback public shopping 

**Tables (approx. row count from planner):**

| Schema.Table | ~rows |
|--------------|-------|
| feedback.collection_stats | 0 |
| feedback.reviews | 0 |
| feedback.user_activity | 0 |
| feedback.user_profiles | 0 |
| shopping.bundle_shipping_offers | 0 |
| shopping.cache_metadata | 0 |
| shopping.cart_session | 0 |
| shopping.discount_codes | 0 |
| shopping.notifications | 0 |
| shopping.orders | 148 |
| shopping.price_alerts | 0 |
| shopping.purchase_history | 73 |
| shopping.recently_viewed | 62 |
| shopping.returns | 6 |
| shopping.saved_searches | 0 |
| shopping.search_history | 119 |
| shopping.shipments | 148 |
| shopping.shopping_cart | 0 |
| shopping.watchlist | 62 |
| shopping.wishlist | 62 |

**Table definitions (columns):**

- **`feedback.collection_stats|user_id|uuid`**:
  - `feedback.collection_stats|user_id|uuid` feedback.collection_stats|user_id|uuid
- **`feedback.collection_stats|record_count|integer`**:
  - `feedback.collection_stats|record_count|integer` feedback.collection_stats|record_count|integer
- **`feedback.collection_stats|visible|boolean`**:
  - `feedback.collection_stats|visible|boolean` feedback.collection_stats|visible|boolean
- **`feedback.collection_stats|updated_at|timestamp with time zone`**:
  - `feedback.collection_stats|updated_at|timestamp with time zone` feedback.collection_stats|updated_at|timestamp with time zone
- **`feedback.reviews|id|uuid`**:
  - `feedback.reviews|id|uuid` feedback.reviews|id|uuid
- **`feedback.reviews|reviewer_id|uuid`**:
  - `feedback.reviews|reviewer_id|uuid` feedback.reviews|reviewer_id|uuid
- **`feedback.reviews|reviewee_id|uuid`**:
  - `feedback.reviews|reviewee_id|uuid` feedback.reviews|reviewee_id|uuid
- **`feedback.reviews|role|character varying(16)`**:
  - `feedback.reviews|role|character varying(16)` feedback.reviews|role|character varying(16)
- **`feedback.reviews|transaction_id|uuid`**:
  - `feedback.reviews|transaction_id|uuid` feedback.reviews|transaction_id|uuid
- **`feedback.reviews|rating|smallint`**:
  - `feedback.reviews|rating|smallint` feedback.reviews|rating|smallint
- **`feedback.reviews|comment|text`**:
  - `feedback.reviews|comment|text` feedback.reviews|comment|text
- **`feedback.reviews|created_at|timestamp with time zone`**:
  - `feedback.reviews|created_at|timestamp with time zone` feedback.reviews|created_at|timestamp with time zone
- **`feedback.user_activity|id|bigint`**:
  - `feedback.user_activity|id|bigint` feedback.user_activity|id|bigint
- **`feedback.user_activity|user_id|uuid`**:
  - `feedback.user_activity|user_id|uuid` feedback.user_activity|user_id|uuid
- **`feedback.user_activity|activity_type|character varying(64)`**:
  - `feedback.user_activity|activity_type|character varying(64)` feedback.user_activity|activity_type|character varying(64)
- **`feedback.user_activity|payload|jsonb`**:
  - `feedback.user_activity|payload|jsonb` feedback.user_activity|payload|jsonb
- **`feedback.user_activity|created_at|timestamp with time zone`**:
  - `feedback.user_activity|created_at|timestamp with time zone` feedback.user_activity|created_at|timestamp with time zone
- **`feedback.user_profiles|user_id|uuid`**:
  - `feedback.user_profiles|user_id|uuid` feedback.user_profiles|user_id|uuid
- **`feedback.user_profiles|display_name|character varying(128)`**:
  - `feedback.user_profiles|display_name|character varying(128)` feedback.user_profiles|display_name|character varying(128)
- **`feedback.user_profiles|bio|text`**:
  - `feedback.user_profiles|bio|text` feedback.user_profiles|bio|text
- **`feedback.user_profiles|collection_visible|boolean`**:
  - `feedback.user_profiles|collection_visible|boolean` feedback.user_profiles|collection_visible|boolean
- **`feedback.user_profiles|created_at|timestamp with time zone`**:
  - `feedback.user_profiles|created_at|timestamp with time zone` feedback.user_profiles|created_at|timestamp with time zone
- **`feedback.user_profiles|updated_at|timestamp with time zone`**:
  - `feedback.user_profiles|updated_at|timestamp with time zone` feedback.user_profiles|updated_at|timestamp with time zone
- **`shopping.bundle_shipping_offers|id|uuid`**:
  - `shopping.bundle_shipping_offers|id|uuid` shopping.bundle_shipping_offers|id|uuid
- **`shopping.bundle_shipping_offers|seller_id|uuid`**:
  - `shopping.bundle_shipping_offers|seller_id|uuid` shopping.bundle_shipping_offers|seller_id|uuid
- **`shopping.bundle_shipping_offers|rule_type|character varying(32)`**:
  - `shopping.bundle_shipping_offers|rule_type|character varying(32)` shopping.bundle_shipping_offers|rule_type|character varying(32)
- **`shopping.bundle_shipping_offers|min_items|integer`**:
  - `shopping.bundle_shipping_offers|min_items|integer` shopping.bundle_shipping_offers|min_items|integer
- **`shopping.bundle_shipping_offers|shipping_discount|character varying(32)`**:
  - `shopping.bundle_shipping_offers|shipping_discount|character varying(32)` shopping.bundle_shipping_offers|shipping_discount|character varying(32)
- **`shopping.bundle_shipping_offers|fixed_amount|numeric`**:
  - `shopping.bundle_shipping_offers|fixed_amount|numeric` shopping.bundle_shipping_offers|fixed_amount|numeric
- **`shopping.bundle_shipping_offers|currency|character varying(3)`**:
  - `shopping.bundle_shipping_offers|currency|character varying(3)` shopping.bundle_shipping_offers|currency|character varying(3)
- **`shopping.bundle_shipping_offers|created_at|timestamp with time zone`**:
  - `shopping.bundle_shipping_offers|created_at|timestamp with time zone` shopping.bundle_shipping_offers|created_at|timestamp with time zone
- **`shopping.bundle_shipping_offers|updated_at|timestamp with time zone`**:
  - `shopping.bundle_shipping_offers|updated_at|timestamp with time zone` shopping.bundle_shipping_offers|updated_at|timestamp with time zone
- **`shopping.cache_metadata|id|uuid`**:
  - `shopping.cache_metadata|id|uuid` shopping.cache_metadata|id|uuid
- **`shopping.cache_metadata|user_id|uuid`**:
  - `shopping.cache_metadata|user_id|uuid` shopping.cache_metadata|user_id|uuid
- **`shopping.cache_metadata|cache_key|text`**:
  - `shopping.cache_metadata|cache_key|text` shopping.cache_metadata|cache_key|text
- **`shopping.cache_metadata|cache_type|text`**:
  - `shopping.cache_metadata|cache_type|text` shopping.cache_metadata|cache_type|text
- **`shopping.cache_metadata|access_count|integer`**:
  - `shopping.cache_metadata|access_count|integer` shopping.cache_metadata|access_count|integer
- **`shopping.cache_metadata|last_access|timestamp with time zone`**:
  - `shopping.cache_metadata|last_access|timestamp with time zone` shopping.cache_metadata|last_access|timestamp with time zone
- **`shopping.cache_metadata|metadata|jsonb`**:
  - `shopping.cache_metadata|metadata|jsonb` shopping.cache_metadata|metadata|jsonb
- **`shopping.cart_lines_with_total|id|uuid`**:
  - `shopping.cart_lines_with_total|id|uuid` shopping.cart_lines_with_total|id|uuid
- **`shopping.cart_lines_with_total|user_id|uuid`**:
  - `shopping.cart_lines_with_total|user_id|uuid` shopping.cart_lines_with_total|user_id|uuid
- **`shopping.cart_lines_with_total|listing_id|uuid`**:
  - `shopping.cart_lines_with_total|listing_id|uuid` shopping.cart_lines_with_total|listing_id|uuid
- **`shopping.cart_lines_with_total|item_type|text`**:
  - `shopping.cart_lines_with_total|item_type|text` shopping.cart_lines_with_total|item_type|text
- **`shopping.cart_lines_with_total|item_id|uuid`**:
  - `shopping.cart_lines_with_total|item_id|uuid` shopping.cart_lines_with_total|item_id|uuid
- **`shopping.cart_lines_with_total|quantity|integer`**:
  - `shopping.cart_lines_with_total|quantity|integer` shopping.cart_lines_with_total|quantity|integer
- **`shopping.cart_lines_with_total|price|numeric`**:
  - `shopping.cart_lines_with_total|price|numeric` shopping.cart_lines_with_total|price|numeric
- **`shopping.cart_lines_with_total|line_total|numeric`**:
  - `shopping.cart_lines_with_total|line_total|numeric` shopping.cart_lines_with_total|line_total|numeric
- **`shopping.cart_lines_with_total|metadata|jsonb`**:
  - `shopping.cart_lines_with_total|metadata|jsonb` shopping.cart_lines_with_total|metadata|jsonb
- **`shopping.cart_lines_with_total|created_at|timestamp with time zone`**:
  - `shopping.cart_lines_with_total|created_at|timestamp with time zone` shopping.cart_lines_with_total|created_at|timestamp with time zone
- **`shopping.cart_lines_with_total|updated_at|timestamp with time zone`**:
  - `shopping.cart_lines_with_total|updated_at|timestamp with time zone` shopping.cart_lines_with_total|updated_at|timestamp with time zone
- **`shopping.cart_session|user_id|uuid`**:
  - `shopping.cart_session|user_id|uuid` shopping.cart_session|user_id|uuid
- **`shopping.cart_session|ship_to_country|character(2)`**:
  - `shopping.cart_session|ship_to_country|character(2)` shopping.cart_session|ship_to_country|character(2)
- **`shopping.cart_session|updated_at|timestamp with time zone`**:
  - `shopping.cart_session|updated_at|timestamp with time zone` shopping.cart_session|updated_at|timestamp with time zone
- **`shopping.cart_summary|user_id|uuid`**:
  - `shopping.cart_summary|user_id|uuid` shopping.cart_summary|user_id|uuid
- **`shopping.cart_summary|line_count|integer`**:
  - `shopping.cart_summary|line_count|integer` shopping.cart_summary|line_count|integer
- **`shopping.cart_summary|subtotal|numeric`**:
  - `shopping.cart_summary|subtotal|numeric` shopping.cart_summary|subtotal|numeric
- **`shopping.discount_codes|id|uuid`**:
  - `shopping.discount_codes|id|uuid` shopping.discount_codes|id|uuid
- **`shopping.discount_codes|code|character varying(64)`**:
  - `shopping.discount_codes|code|character varying(64)` shopping.discount_codes|code|character varying(64)
- **`shopping.discount_codes|type|character varying(16)`**:
  - `shopping.discount_codes|type|character varying(16)` shopping.discount_codes|type|character varying(16)
- **`shopping.discount_codes|value|numeric`**:
  - `shopping.discount_codes|value|numeric` shopping.discount_codes|value|numeric
- **`shopping.discount_codes|min_order|numeric`**:
  - `shopping.discount_codes|min_order|numeric` shopping.discount_codes|min_order|numeric
- **`shopping.discount_codes|currency|character varying(3)`**:
  - `shopping.discount_codes|currency|character varying(3)` shopping.discount_codes|currency|character varying(3)
- **`shopping.discount_codes|valid_from|timestamp with time zone`**:
  - `shopping.discount_codes|valid_from|timestamp with time zone` shopping.discount_codes|valid_from|timestamp with time zone
- **`shopping.discount_codes|valid_until|timestamp with time zone`**:
  - `shopping.discount_codes|valid_until|timestamp with time zone` shopping.discount_codes|valid_until|timestamp with time zone
- **`shopping.discount_codes|usage_limit|integer`**:
  - `shopping.discount_codes|usage_limit|integer` shopping.discount_codes|usage_limit|integer
- **`shopping.discount_codes|usage_count|integer`**:
  - `shopping.discount_codes|usage_count|integer` shopping.discount_codes|usage_count|integer
- **`shopping.discount_codes|created_at|timestamp with time zone`**:
  - `shopping.discount_codes|created_at|timestamp with time zone` shopping.discount_codes|created_at|timestamp with time zone
- **`shopping.notifications|id|uuid`**:
  - `shopping.notifications|id|uuid` shopping.notifications|id|uuid
- **`shopping.notifications|user_id|uuid`**:
  - `shopping.notifications|user_id|uuid` shopping.notifications|user_id|uuid
- **`shopping.notifications|type|character varying(64)`**:
  - `shopping.notifications|type|character varying(64)` shopping.notifications|type|character varying(64)
- **`shopping.notifications|title|character varying(256)`**:
  - `shopping.notifications|title|character varying(256)` shopping.notifications|title|character varying(256)
- **`shopping.notifications|body|text`**:
  - `shopping.notifications|body|text` shopping.notifications|body|text
- **`shopping.notifications|payload|jsonb`**:
  - `shopping.notifications|payload|jsonb` shopping.notifications|payload|jsonb
- **`shopping.notifications|read_at|timestamp with time zone`**:
  - `shopping.notifications|read_at|timestamp with time zone` shopping.notifications|read_at|timestamp with time zone
- **`shopping.notifications|created_at|timestamp with time zone`**:
  - `shopping.notifications|created_at|timestamp with time zone` shopping.notifications|created_at|timestamp with time zone
- **`shopping.orders|id|uuid`**:
  - `shopping.orders|id|uuid` shopping.orders|id|uuid
- **`shopping.orders|user_id|uuid`**:
  - `shopping.orders|user_id|uuid` shopping.orders|user_id|uuid
- **`shopping.orders|order_number|character varying(64)`**:
  - `shopping.orders|order_number|character varying(64)` shopping.orders|order_number|character varying(64)
- **`shopping.orders|status|text`**:
  - `shopping.orders|status|text` shopping.orders|status|text
- **`shopping.orders|payment_status|text`**:
  - `shopping.orders|payment_status|text` shopping.orders|payment_status|text
- **`shopping.orders|payment_method|text`**:
  - `shopping.orders|payment_method|text` shopping.orders|payment_method|text
- **`shopping.orders|payment_transaction_id|text`**:
  - `shopping.orders|payment_transaction_id|text` shopping.orders|payment_transaction_id|text
- **`shopping.orders|subtotal|numeric`**:
  - `shopping.orders|subtotal|numeric` shopping.orders|subtotal|numeric
- **`shopping.orders|shipping_cost|numeric`**:
  - `shopping.orders|shipping_cost|numeric` shopping.orders|shipping_cost|numeric
- **`shopping.orders|tax|numeric`**:
  - `shopping.orders|tax|numeric` shopping.orders|tax|numeric
- **`shopping.orders|total|numeric`**:
  - `shopping.orders|total|numeric` shopping.orders|total|numeric
- **`shopping.orders|currency|text`**:
  - `shopping.orders|currency|text` shopping.orders|currency|text
- **`shopping.orders|shipping_address|jsonb`**:
  - `shopping.orders|shipping_address|jsonb` shopping.orders|shipping_address|jsonb
- **`shopping.orders|billing_address|jsonb`**:
  - `shopping.orders|billing_address|jsonb` shopping.orders|billing_address|jsonb
- **`shopping.orders|notes|text`**:
  - `shopping.orders|notes|text` shopping.orders|notes|text
- **`shopping.orders|metadata|jsonb`**:
  - `shopping.orders|metadata|jsonb` shopping.orders|metadata|jsonb
- **`shopping.orders|created_at|timestamp with time zone`**:
  - `shopping.orders|created_at|timestamp with time zone` shopping.orders|created_at|timestamp with time zone
- **`shopping.orders|updated_at|timestamp with time zone`**:
  - `shopping.orders|updated_at|timestamp with time zone` shopping.orders|updated_at|timestamp with time zone
- **`shopping.orders|completed_at|timestamp with time zone`**:
  - `shopping.orders|completed_at|timestamp with time zone` shopping.orders|completed_at|timestamp with time zone
- **`shopping.orders|cancelled_at|timestamp with time zone`**:
  - `shopping.orders|cancelled_at|timestamp with time zone` shopping.orders|cancelled_at|timestamp with time zone
- **`shopping.orders|ship_to_country|character(2)`**:
  - `shopping.orders|ship_to_country|character(2)` shopping.orders|ship_to_country|character(2)
- **`shopping.price_alerts|id|uuid`**:
  - `shopping.price_alerts|id|uuid` shopping.price_alerts|id|uuid
- **`shopping.price_alerts|user_id|uuid`**:
  - `shopping.price_alerts|user_id|uuid` shopping.price_alerts|user_id|uuid
- **`shopping.price_alerts|listing_id|uuid`**:
  - `shopping.price_alerts|listing_id|uuid` shopping.price_alerts|listing_id|uuid
- **`shopping.price_alerts|target_price|numeric`**:
  - `shopping.price_alerts|target_price|numeric` shopping.price_alerts|target_price|numeric
- **`shopping.price_alerts|currency|character varying(3)`**:
  - `shopping.price_alerts|currency|character varying(3)` shopping.price_alerts|currency|character varying(3)
- **`shopping.price_alerts|notified_at|timestamp with time zone`**:
  - `shopping.price_alerts|notified_at|timestamp with time zone` shopping.price_alerts|notified_at|timestamp with time zone
- **`shopping.price_alerts|created_at|timestamp with time zone`**:
  - `shopping.price_alerts|created_at|timestamp with time zone` shopping.price_alerts|created_at|timestamp with time zone
- **`shopping.purchase_history|id|uuid`**:
  - `shopping.purchase_history|id|uuid` shopping.purchase_history|id|uuid
- **`shopping.purchase_history|user_id|uuid`**:
  - `shopping.purchase_history|user_id|uuid` shopping.purchase_history|user_id|uuid
- **`shopping.purchase_history|order_id|uuid`**:
  - `shopping.purchase_history|order_id|uuid` shopping.purchase_history|order_id|uuid
- **`shopping.purchase_history|listing_id|uuid`**:
  - `shopping.purchase_history|listing_id|uuid` shopping.purchase_history|listing_id|uuid
- **`shopping.purchase_history|item_type|text`**:
  - `shopping.purchase_history|item_type|text` shopping.purchase_history|item_type|text
- **`shopping.purchase_history|item_id|uuid`**:
  - `shopping.purchase_history|item_id|uuid` shopping.purchase_history|item_id|uuid
- **`shopping.purchase_history|quantity|integer`**:
  - `shopping.purchase_history|quantity|integer` shopping.purchase_history|quantity|integer
- **`shopping.purchase_history|price_paid|numeric`**:
  - `shopping.purchase_history|price_paid|numeric` shopping.purchase_history|price_paid|numeric
- **`shopping.purchase_history|currency|text`**:
  - `shopping.purchase_history|currency|text` shopping.purchase_history|currency|text
- **`shopping.purchase_history|purchase_type|text`**:
  - `shopping.purchase_history|purchase_type|text` shopping.purchase_history|purchase_type|text
- **`shopping.purchase_history|status|text`**:
  - `shopping.purchase_history|status|text` shopping.purchase_history|status|text
- **`shopping.purchase_history|purchased_at|timestamp with time zone`**:
  - `shopping.purchase_history|purchased_at|timestamp with time zone` shopping.purchase_history|purchased_at|timestamp with time zone
- **`shopping.purchase_history|metadata|jsonb`**:
  - `shopping.purchase_history|metadata|jsonb` shopping.purchase_history|metadata|jsonb
- **`shopping.purchase_history|resellable|boolean`**:
  - `shopping.purchase_history|resellable|boolean` shopping.purchase_history|resellable|boolean
- **`shopping.recently_viewed|id|uuid`**:
  - `shopping.recently_viewed|id|uuid` shopping.recently_viewed|id|uuid
- **`shopping.recently_viewed|user_id|uuid`**:
  - `shopping.recently_viewed|user_id|uuid` shopping.recently_viewed|user_id|uuid
- **`shopping.recently_viewed|item_type|text`**:
  - `shopping.recently_viewed|item_type|text` shopping.recently_viewed|item_type|text
- **`shopping.recently_viewed|item_id|uuid`**:
  - `shopping.recently_viewed|item_id|uuid` shopping.recently_viewed|item_id|uuid
- **`shopping.recently_viewed|viewed_at|timestamp with time zone`**:
  - `shopping.recently_viewed|viewed_at|timestamp with time zone` shopping.recently_viewed|viewed_at|timestamp with time zone
- **`shopping.recently_viewed|metadata|jsonb`**:
  - `shopping.recently_viewed|metadata|jsonb` shopping.recently_viewed|metadata|jsonb
- **`shopping.returns|id|uuid`**:
  - `shopping.returns|id|uuid` shopping.returns|id|uuid
- **`shopping.returns|order_id|uuid`**:
  - `shopping.returns|order_id|uuid` shopping.returns|order_id|uuid
- **`shopping.returns|purchase_id|uuid`**:
  - `shopping.returns|purchase_id|uuid` shopping.returns|purchase_id|uuid
- **`shopping.returns|requested_by|uuid`**:
  - `shopping.returns|requested_by|uuid` shopping.returns|requested_by|uuid
- **`shopping.returns|status|character varying(32)`**:
  - `shopping.returns|status|character varying(32)` shopping.returns|status|character varying(32)
- **`shopping.returns|reason|text`**:
  - `shopping.returns|reason|text` shopping.returns|reason|text
- **`shopping.returns|requested_at|timestamp with time zone`**:
  - `shopping.returns|requested_at|timestamp with time zone` shopping.returns|requested_at|timestamp with time zone
- **`shopping.returns|responded_at|timestamp with time zone`**:
  - `shopping.returns|responded_at|timestamp with time zone` shopping.returns|responded_at|timestamp with time zone
- **`shopping.returns|received_at|timestamp with time zone`**:
  - `shopping.returns|received_at|timestamp with time zone` shopping.returns|received_at|timestamp with time zone
- **`shopping.returns|refunded_at|timestamp with time zone`**:
  - `shopping.returns|refunded_at|timestamp with time zone` shopping.returns|refunded_at|timestamp with time zone
- **`shopping.returns|created_at|timestamp with time zone`**:
  - `shopping.returns|created_at|timestamp with time zone` shopping.returns|created_at|timestamp with time zone
- **`shopping.returns|updated_at|timestamp with time zone`**:
  - `shopping.returns|updated_at|timestamp with time zone` shopping.returns|updated_at|timestamp with time zone
- **`shopping.saved_searches|id|uuid`**:
  - `shopping.saved_searches|id|uuid` shopping.saved_searches|id|uuid
- **`shopping.saved_searches|user_id|uuid`**:
  - `shopping.saved_searches|user_id|uuid` shopping.saved_searches|user_id|uuid
- **`shopping.saved_searches|name|character varying(128)`**:
  - `shopping.saved_searches|name|character varying(128)` shopping.saved_searches|name|character varying(128)
- **`shopping.saved_searches|query|text`**:
  - `shopping.saved_searches|query|text` shopping.saved_searches|query|text
- **`shopping.saved_searches|filters|jsonb`**:
  - `shopping.saved_searches|filters|jsonb` shopping.saved_searches|filters|jsonb
- **`shopping.saved_searches|notify_on_new|boolean`**:
  - `shopping.saved_searches|notify_on_new|boolean` shopping.saved_searches|notify_on_new|boolean
- **`shopping.saved_searches|last_run_at|timestamp with time zone`**:
  - `shopping.saved_searches|last_run_at|timestamp with time zone` shopping.saved_searches|last_run_at|timestamp with time zone
- **`shopping.saved_searches|last_result_count|integer`**:
  - `shopping.saved_searches|last_result_count|integer` shopping.saved_searches|last_result_count|integer
- **`shopping.saved_searches|created_at|timestamp with time zone`**:
  - `shopping.saved_searches|created_at|timestamp with time zone` shopping.saved_searches|created_at|timestamp with time zone
- **`shopping.saved_searches|updated_at|timestamp with time zone`**:
  - `shopping.saved_searches|updated_at|timestamp with time zone` shopping.saved_searches|updated_at|timestamp with time zone
- **`shopping.search_history|id|uuid`**:
  - `shopping.search_history|id|uuid` shopping.search_history|id|uuid
- **`shopping.search_history|user_id|uuid`**:
  - `shopping.search_history|user_id|uuid` shopping.search_history|user_id|uuid
- **`shopping.search_history|query|text`**:
  - `shopping.search_history|query|text` shopping.search_history|query|text
- **`shopping.search_history|query_type|text`**:
  - `shopping.search_history|query_type|text` shopping.search_history|query_type|text
- **`shopping.search_history|filters|jsonb`**:
  - `shopping.search_history|filters|jsonb` shopping.search_history|filters|jsonb
- **`shopping.search_history|result_count|integer`**:
  - `shopping.search_history|result_count|integer` shopping.search_history|result_count|integer
- **`shopping.search_history|clicked_item|uuid`**:
  - `shopping.search_history|clicked_item|uuid` shopping.search_history|clicked_item|uuid
- **`shopping.search_history|searched_at|timestamp with time zone`**:
  - `shopping.search_history|searched_at|timestamp with time zone` shopping.search_history|searched_at|timestamp with time zone
- **`shopping.shipments|id|uuid`**:
  - `shopping.shipments|id|uuid` shopping.shipments|id|uuid
- **`shopping.shipments|order_id|uuid`**:
  - `shopping.shipments|order_id|uuid` shopping.shipments|order_id|uuid
- **`shopping.shipments|tracking_number|character varying(64)`**:
  - `shopping.shipments|tracking_number|character varying(64)` shopping.shipments|tracking_number|character varying(64)
- **`shopping.shipments|carrier|character varying(64)`**:
  - `shopping.shipments|carrier|character varying(64)` shopping.shipments|carrier|character varying(64)
- **`shopping.shipments|status|character varying(32)`**:
  - `shopping.shipments|status|character varying(32)` shopping.shipments|status|character varying(32)
- **`shopping.shipments|shipped_at|timestamp with time zone`**:
  - `shopping.shipments|shipped_at|timestamp with time zone` shopping.shipments|shipped_at|timestamp with time zone
- **`shopping.shipments|delivered_at|timestamp with time zone`**:
  - `shopping.shipments|delivered_at|timestamp with time zone` shopping.shipments|delivered_at|timestamp with time zone
- **`shopping.shipments|created_at|timestamp with time zone`**:
  - `shopping.shipments|created_at|timestamp with time zone` shopping.shipments|created_at|timestamp with time zone
- **`shopping.shipments|updated_at|timestamp with time zone`**:
  - `shopping.shipments|updated_at|timestamp with time zone` shopping.shipments|updated_at|timestamp with time zone
- **`shopping.shopping_cart|id|uuid`**:
  - `shopping.shopping_cart|id|uuid` shopping.shopping_cart|id|uuid
- **`shopping.shopping_cart|user_id|uuid`**:
  - `shopping.shopping_cart|user_id|uuid` shopping.shopping_cart|user_id|uuid
- **`shopping.shopping_cart|listing_id|uuid`**:
  - `shopping.shopping_cart|listing_id|uuid` shopping.shopping_cart|listing_id|uuid
- **`shopping.shopping_cart|item_type|text`**:
  - `shopping.shopping_cart|item_type|text` shopping.shopping_cart|item_type|text
- **`shopping.shopping_cart|item_id|uuid`**:
  - `shopping.shopping_cart|item_id|uuid` shopping.shopping_cart|item_id|uuid
- **`shopping.shopping_cart|quantity|integer`**:
  - `shopping.shopping_cart|quantity|integer` shopping.shopping_cart|quantity|integer
- **`shopping.shopping_cart|price|numeric`**:
  - `shopping.shopping_cart|price|numeric` shopping.shopping_cart|price|numeric
- **`shopping.shopping_cart|metadata|jsonb`**:
  - `shopping.shopping_cart|metadata|jsonb` shopping.shopping_cart|metadata|jsonb
- **`shopping.shopping_cart|created_at|timestamp with time zone`**:
  - `shopping.shopping_cart|created_at|timestamp with time zone` shopping.shopping_cart|created_at|timestamp with time zone
- **`shopping.shopping_cart|updated_at|timestamp with time zone`**:
  - `shopping.shopping_cart|updated_at|timestamp with time zone` shopping.shopping_cart|updated_at|timestamp with time zone
- **`shopping.shopping_cart|notes|text`**:
  - `shopping.shopping_cart|notes|text` shopping.shopping_cart|notes|text
- **`shopping.watchlist|id|uuid`**:
  - `shopping.watchlist|id|uuid` shopping.watchlist|id|uuid
- **`shopping.watchlist|user_id|uuid`**:
  - `shopping.watchlist|user_id|uuid` shopping.watchlist|user_id|uuid
- **`shopping.watchlist|listing_id|uuid`**:
  - `shopping.watchlist|listing_id|uuid` shopping.watchlist|listing_id|uuid
- **`shopping.watchlist|item_type|text`**:
  - `shopping.watchlist|item_type|text` shopping.watchlist|item_type|text
- **`shopping.watchlist|item_id|uuid`**:
  - `shopping.watchlist|item_id|uuid` shopping.watchlist|item_id|uuid
- **`shopping.watchlist|notify_on|ARRAY`**:
  - `shopping.watchlist|notify_on|ARRAY` shopping.watchlist|notify_on|ARRAY
- **`shopping.watchlist|metadata|jsonb`**:
  - `shopping.watchlist|metadata|jsonb` shopping.watchlist|metadata|jsonb
- **`shopping.watchlist|created_at|timestamp with time zone`**:
  - `shopping.watchlist|created_at|timestamp with time zone` shopping.watchlist|created_at|timestamp with time zone
- **`shopping.watchlist|updated_at|timestamp with time zone`**:
  - `shopping.watchlist|updated_at|timestamp with time zone` shopping.watchlist|updated_at|timestamp with time zone
- **`shopping.watchlist|artist|character varying(256)`**:
  - `shopping.watchlist|artist|character varying(256)` shopping.watchlist|artist|character varying(256)
- **`shopping.watchlist|name|character varying(256)`**:
  - `shopping.watchlist|name|character varying(256)` shopping.watchlist|name|character varying(256)
- **`shopping.watchlist|format|character varying(64)`**:
  - `shopping.watchlist|format|character varying(64)` shopping.watchlist|format|character varying(64)
- **`shopping.watchlist|catalog_number|character varying(64)`**:
  - `shopping.watchlist|catalog_number|character varying(64)` shopping.watchlist|catalog_number|character varying(64)
- **`shopping.watchlist|record_grade|character varying(16)`**:
  - `shopping.watchlist|record_grade|character varying(16)` shopping.watchlist|record_grade|character varying(16)
- **`shopping.watchlist|sleeve_grade|character varying(16)`**:
  - `shopping.watchlist|sleeve_grade|character varying(16)` shopping.watchlist|sleeve_grade|character varying(16)
- **`shopping.watchlist|label|character varying(128)`**:
  - `shopping.watchlist|label|character varying(128)` shopping.watchlist|label|character varying(128)
- **`shopping.watchlist|label_code|character varying(64)`**:
  - `shopping.watchlist|label_code|character varying(64)` shopping.watchlist|label_code|character varying(64)
- **`shopping.watchlist|release_year|integer`**:
  - `shopping.watchlist|release_year|integer` shopping.watchlist|release_year|integer
- **`shopping.wishlist|id|uuid`**:
  - `shopping.wishlist|id|uuid` shopping.wishlist|id|uuid
- **`shopping.wishlist|user_id|uuid`**:
  - `shopping.wishlist|user_id|uuid` shopping.wishlist|user_id|uuid
- **`shopping.wishlist|listing_id|uuid`**:
  - `shopping.wishlist|listing_id|uuid` shopping.wishlist|listing_id|uuid
- **`shopping.wishlist|item_type|text`**:
  - `shopping.wishlist|item_type|text` shopping.wishlist|item_type|text
- **`shopping.wishlist|item_id|uuid`**:
  - `shopping.wishlist|item_id|uuid` shopping.wishlist|item_id|uuid
- **`shopping.wishlist|priority|integer`**:
  - `shopping.wishlist|priority|integer` shopping.wishlist|priority|integer
- **`shopping.wishlist|notes|text`**:
  - `shopping.wishlist|notes|text` shopping.wishlist|notes|text
- **`shopping.wishlist|metadata|jsonb`**:
  - `shopping.wishlist|metadata|jsonb` shopping.wishlist|metadata|jsonb
- **`shopping.wishlist|created_at|timestamp with time zone`**:
  - `shopping.wishlist|created_at|timestamp with time zone` shopping.wishlist|created_at|timestamp with time zone
- **`shopping.wishlist|updated_at|timestamp with time zone`**:
  - `shopping.wishlist|updated_at|timestamp with time zone` shopping.wishlist|updated_at|timestamp with time zone
- **`shopping.wishlist|artist|character varying(256)`**:
  - `shopping.wishlist|artist|character varying(256)` shopping.wishlist|artist|character varying(256)
- **`shopping.wishlist|name|character varying(256)`**:
  - `shopping.wishlist|name|character varying(256)` shopping.wishlist|name|character varying(256)
- **`shopping.wishlist|format|character varying(64)`**:
  - `shopping.wishlist|format|character varying(64)` shopping.wishlist|format|character varying(64)
- **`shopping.wishlist|catalog_number|character varying(64)`**:
  - `shopping.wishlist|catalog_number|character varying(64)` shopping.wishlist|catalog_number|character varying(64)
- **`shopping.wishlist|record_grade|character varying(16)`**:
  - `shopping.wishlist|record_grade|character varying(16)` shopping.wishlist|record_grade|character varying(16)
- **`shopping.wishlist|sleeve_grade|character varying(16)`**:
  - `shopping.wishlist|sleeve_grade|character varying(16)` shopping.wishlist|sleeve_grade|character varying(16)
- **`shopping.wishlist|label|character varying(128)`**:
  - `shopping.wishlist|label|character varying(128)` shopping.wishlist|label|character varying(128)
- **`shopping.wishlist|label_code|character varying(64)`**:
  - `shopping.wishlist|label_code|character varying(64)` shopping.wishlist|label_code|character varying(64)
- **`shopping.wishlist|release_year|integer`**:
  - `shopping.wishlist|release_year|integer` shopping.wishlist|release_year|integer

## Port 5437 — auth (record-platform-postgres-auth-1)

**Databases:** auth postgres 

### DB `auth`

**Schemas:** auth public 

**Tables (approx. row count from planner):**

| Schema.Table | ~rows |
|--------------|-------|
| auth.mfa_settings | 63 |
| auth.oauth_providers | 0 |
| auth.passkey_challenges | 0 |
| auth.passkeys | 0 |
| auth.sessions | 0 |
| auth.user_addresses | 0 |
| auth.users | 329 |
| auth.verification_codes | 126 |

**Table definitions (columns):**

- **`auth.mfa_settings|id|uuid`**:
  - `auth.mfa_settings|id|uuid` auth.mfa_settings|id|uuid
- **`auth.mfa_settings|user_id|uuid`**:
  - `auth.mfa_settings|user_id|uuid` auth.mfa_settings|user_id|uuid
- **`auth.mfa_settings|totp_secret|text`**:
  - `auth.mfa_settings|totp_secret|text` auth.mfa_settings|totp_secret|text
- **`auth.mfa_settings|backup_codes|ARRAY`**:
  - `auth.mfa_settings|backup_codes|ARRAY` auth.mfa_settings|backup_codes|ARRAY
- **`auth.mfa_settings|enabled|boolean`**:
  - `auth.mfa_settings|enabled|boolean` auth.mfa_settings|enabled|boolean
- **`auth.mfa_settings|created_at|timestamp with time zone`**:
  - `auth.mfa_settings|created_at|timestamp with time zone` auth.mfa_settings|created_at|timestamp with time zone
- **`auth.mfa_settings|updated_at|timestamp with time zone`**:
  - `auth.mfa_settings|updated_at|timestamp with time zone` auth.mfa_settings|updated_at|timestamp with time zone
- **`auth.oauth_providers|id|uuid`**:
  - `auth.oauth_providers|id|uuid` auth.oauth_providers|id|uuid
- **`auth.oauth_providers|user_id|uuid`**:
  - `auth.oauth_providers|user_id|uuid` auth.oauth_providers|user_id|uuid
- **`auth.oauth_providers|provider|text`**:
  - `auth.oauth_providers|provider|text` auth.oauth_providers|provider|text
- **`auth.oauth_providers|provider_user_id|text`**:
  - `auth.oauth_providers|provider_user_id|text` auth.oauth_providers|provider_user_id|text
- **`auth.oauth_providers|email|text`**:
  - `auth.oauth_providers|email|text` auth.oauth_providers|email|text
- **`auth.oauth_providers|profile_data|jsonb`**:
  - `auth.oauth_providers|profile_data|jsonb` auth.oauth_providers|profile_data|jsonb
- **`auth.oauth_providers|created_at|timestamp with time zone`**:
  - `auth.oauth_providers|created_at|timestamp with time zone` auth.oauth_providers|created_at|timestamp with time zone
- **`auth.oauth_providers|updated_at|timestamp with time zone`**:
  - `auth.oauth_providers|updated_at|timestamp with time zone` auth.oauth_providers|updated_at|timestamp with time zone
- **`auth.passkey_challenges|id|uuid`**:
  - `auth.passkey_challenges|id|uuid` auth.passkey_challenges|id|uuid
- **`auth.passkey_challenges|user_id|uuid`**:
  - `auth.passkey_challenges|user_id|uuid` auth.passkey_challenges|user_id|uuid
- **`auth.passkey_challenges|challenge|text`**:
  - `auth.passkey_challenges|challenge|text` auth.passkey_challenges|challenge|text
- **`auth.passkey_challenges|type|text`**:
  - `auth.passkey_challenges|type|text` auth.passkey_challenges|type|text
- **`auth.passkey_challenges|expires_at|timestamp with time zone`**:
  - `auth.passkey_challenges|expires_at|timestamp with time zone` auth.passkey_challenges|expires_at|timestamp with time zone
- **`auth.passkey_challenges|created_at|timestamp with time zone`**:
  - `auth.passkey_challenges|created_at|timestamp with time zone` auth.passkey_challenges|created_at|timestamp with time zone
- **`auth.passkeys|id|uuid`**:
  - `auth.passkeys|id|uuid` auth.passkeys|id|uuid
- **`auth.passkeys|user_id|uuid`**:
  - `auth.passkeys|user_id|uuid` auth.passkeys|user_id|uuid
- **`auth.passkeys|credential_id|text`**:
  - `auth.passkeys|credential_id|text` auth.passkeys|credential_id|text
- **`auth.passkeys|public_key|text`**:
  - `auth.passkeys|public_key|text` auth.passkeys|public_key|text
- **`auth.passkeys|counter|bigint`**:
  - `auth.passkeys|counter|bigint` auth.passkeys|counter|bigint
- **`auth.passkeys|device_name|text`**:
  - `auth.passkeys|device_name|text` auth.passkeys|device_name|text
- **`auth.passkeys|device_type|text`**:
  - `auth.passkeys|device_type|text` auth.passkeys|device_type|text
- **`auth.passkeys|last_used_at|timestamp with time zone`**:
  - `auth.passkeys|last_used_at|timestamp with time zone` auth.passkeys|last_used_at|timestamp with time zone
- **`auth.passkeys|created_at|timestamp with time zone`**:
  - `auth.passkeys|created_at|timestamp with time zone` auth.passkeys|created_at|timestamp with time zone
- **`auth.sessions|id|uuid`**:
  - `auth.sessions|id|uuid` auth.sessions|id|uuid
- **`auth.sessions|user_id|uuid`**:
  - `auth.sessions|user_id|uuid` auth.sessions|user_id|uuid
- **`auth.sessions|expires_at|timestamp with time zone`**:
  - `auth.sessions|expires_at|timestamp with time zone` auth.sessions|expires_at|timestamp with time zone
- **`auth.sessions|created_at|timestamp with time zone`**:
  - `auth.sessions|created_at|timestamp with time zone` auth.sessions|created_at|timestamp with time zone
- **`auth.user_addresses|id|uuid`**:
  - `auth.user_addresses|id|uuid` auth.user_addresses|id|uuid
- **`auth.user_addresses|user_id|uuid`**:
  - `auth.user_addresses|user_id|uuid` auth.user_addresses|user_id|uuid
- **`auth.user_addresses|label|character varying(64)`**:
  - `auth.user_addresses|label|character varying(64)` auth.user_addresses|label|character varying(64)
- **`auth.user_addresses|country_code|character(2)`**:
  - `auth.user_addresses|country_code|character(2)` auth.user_addresses|country_code|character(2)
- **`auth.user_addresses|region|character varying(128)`**:
  - `auth.user_addresses|region|character varying(128)` auth.user_addresses|region|character varying(128)
- **`auth.user_addresses|postal_code|character varying(32)`**:
  - `auth.user_addresses|postal_code|character varying(32)` auth.user_addresses|postal_code|character varying(32)
- **`auth.user_addresses|address_line1|character varying(256)`**:
  - `auth.user_addresses|address_line1|character varying(256)` auth.user_addresses|address_line1|character varying(256)
- **`auth.user_addresses|address_line2|character varying(256)`**:
  - `auth.user_addresses|address_line2|character varying(256)` auth.user_addresses|address_line2|character varying(256)
- **`auth.user_addresses|city|character varying(128)`**:
  - `auth.user_addresses|city|character varying(128)` auth.user_addresses|city|character varying(128)
- **`auth.user_addresses|is_default|boolean`**:
  - `auth.user_addresses|is_default|boolean` auth.user_addresses|is_default|boolean
- **`auth.user_addresses|created_at|timestamp with time zone`**:
  - `auth.user_addresses|created_at|timestamp with time zone` auth.user_addresses|created_at|timestamp with time zone
- **`auth.user_addresses|updated_at|timestamp with time zone`**:
  - `auth.user_addresses|updated_at|timestamp with time zone` auth.user_addresses|updated_at|timestamp with time zone
- **`auth.users|id|uuid`**:
  - `auth.users|id|uuid` auth.users|id|uuid
- **`auth.users|email|USER-DEFINED`**:
  - `auth.users|email|USER-DEFINED` auth.users|email|USER-DEFINED
- **`auth.users|password_hash|text`**:
  - `auth.users|password_hash|text` auth.users|password_hash|text
- **`auth.users|settings|jsonb`**:
  - `auth.users|settings|jsonb` auth.users|settings|jsonb
- **`auth.users|created_at|timestamp with time zone`**:
  - `auth.users|created_at|timestamp with time zone` auth.users|created_at|timestamp with time zone
- **`auth.users|phone|text`**:
  - `auth.users|phone|text` auth.users|phone|text
- **`auth.users|email_verified|boolean`**:
  - `auth.users|email_verified|boolean` auth.users|email_verified|boolean
- **`auth.users|phone_verified|boolean`**:
  - `auth.users|phone_verified|boolean` auth.users|phone_verified|boolean
- **`auth.users|mfa_enabled|boolean`**:
  - `auth.users|mfa_enabled|boolean` auth.users|mfa_enabled|boolean
- **`auth.users|updated_at|timestamp with time zone`**:
  - `auth.users|updated_at|timestamp with time zone` auth.users|updated_at|timestamp with time zone
- **`auth.users|default_address_id|uuid`**:
  - `auth.users|default_address_id|uuid` auth.users|default_address_id|uuid
- **`auth.verification_codes|id|uuid`**:
  - `auth.verification_codes|id|uuid` auth.verification_codes|id|uuid
- **`auth.verification_codes|user_id|uuid`**:
  - `auth.verification_codes|user_id|uuid` auth.verification_codes|user_id|uuid
- **`auth.verification_codes|type|text`**:
  - `auth.verification_codes|type|text` auth.verification_codes|type|text
- **`auth.verification_codes|target|text`**:
  - `auth.verification_codes|target|text` auth.verification_codes|target|text
- **`auth.verification_codes|code|text`**:
  - `auth.verification_codes|code|text` auth.verification_codes|code|text
- **`auth.verification_codes|expires_at|timestamp with time zone`**:
  - `auth.verification_codes|expires_at|timestamp with time zone` auth.verification_codes|expires_at|timestamp with time zone
- **`auth.verification_codes|used|boolean`**:
  - `auth.verification_codes|used|boolean` auth.verification_codes|used|boolean
- **`auth.verification_codes|created_at|timestamp with time zone`**:
  - `auth.verification_codes|created_at|timestamp with time zone` auth.verification_codes|created_at|timestamp with time zone

### DB `postgres`

**Schemas:** public 

  (no user tables — expected for default DB `postgres` / schema `public`; app uses named schemas above)

## Port 5438 — auction_monitor (DB: postgres) (record-platform-postgres-auction-monitor-1)

**Databases:** postgres 

### DB `postgres`

**Schemas:** auction_monitor public 

**Tables (approx. row count from planner):**

| Schema.Table | ~rows |
|--------------|-------|
| auction_monitor.auction_results | 0 |
| auction_monitor.data_quality_metrics | 0 |
| auction_monitor.monitoring_jobs | 0 |
| auction_monitor.normalized_listings | 0 |
| auction_monitor.platform_health | 0 |
| auction_monitor.price_history | 0 |
| auction_monitor.raw_listings | 0 |
| auction_monitor.user_saved_auctions | 0 |
| auction_monitor.user_watches | 0 |
| auction_monitor.watch_matches | 0 |

**Table definitions (columns):**

- **`auction_monitor.auction_results|id|uuid`**:
  - `auction_monitor.auction_results|id|uuid` auction_monitor.auction_results|id|uuid
- **`auction_monitor.auction_results|source|text`**:
  - `auction_monitor.auction_results|source|text` auction_monitor.auction_results|source|text
- **`auction_monitor.auction_results|external_id|text`**:
  - `auction_monitor.auction_results|external_id|text` auction_monitor.auction_results|external_id|text
- **`auction_monitor.auction_results|record_id|uuid`**:
  - `auction_monitor.auction_results|record_id|uuid` auction_monitor.auction_results|record_id|uuid
- **`auction_monitor.auction_results|title|text`**:
  - `auction_monitor.auction_results|title|text` auction_monitor.auction_results|title|text
- **`auction_monitor.auction_results|artist|text`**:
  - `auction_monitor.auction_results|artist|text` auction_monitor.auction_results|artist|text
- **`auction_monitor.auction_results|label|text`**:
  - `auction_monitor.auction_results|label|text` auction_monitor.auction_results|label|text
- **`auction_monitor.auction_results|catalog_number|text`**:
  - `auction_monitor.auction_results|catalog_number|text` auction_monitor.auction_results|catalog_number|text
- **`auction_monitor.auction_results|format|text`**:
  - `auction_monitor.auction_results|format|text` auction_monitor.auction_results|format|text
- **`auction_monitor.auction_results|condition_record|text`**:
  - `auction_monitor.auction_results|condition_record|text` auction_monitor.auction_results|condition_record|text
- **`auction_monitor.auction_results|condition_sleeve|text`**:
  - `auction_monitor.auction_results|condition_sleeve|text` auction_monitor.auction_results|condition_sleeve|text
- **`auction_monitor.auction_results|price|numeric`**:
  - `auction_monitor.auction_results|price|numeric` auction_monitor.auction_results|price|numeric
- **`auction_monitor.auction_results|currency|text`**:
  - `auction_monitor.auction_results|currency|text` auction_monitor.auction_results|currency|text
- **`auction_monitor.auction_results|shipping_cost|numeric`**:
  - `auction_monitor.auction_results|shipping_cost|numeric` auction_monitor.auction_results|shipping_cost|numeric
- **`auction_monitor.auction_results|total_cost|numeric`**:
  - `auction_monitor.auction_results|total_cost|numeric` auction_monitor.auction_results|total_cost|numeric
- **`auction_monitor.auction_results|sold_at|timestamp with time zone`**:
  - `auction_monitor.auction_results|sold_at|timestamp with time zone` auction_monitor.auction_results|sold_at|timestamp with time zone
- **`auction_monitor.auction_results|auction_url|text`**:
  - `auction_monitor.auction_results|auction_url|text` auction_monitor.auction_results|auction_url|text
- **`auction_monitor.auction_results|image_url|text`**:
  - `auction_monitor.auction_results|image_url|text` auction_monitor.auction_results|image_url|text
- **`auction_monitor.auction_results|notes|text`**:
  - `auction_monitor.auction_results|notes|text` auction_monitor.auction_results|notes|text
- **`auction_monitor.auction_results|created_at|timestamp with time zone`**:
  - `auction_monitor.auction_results|created_at|timestamp with time zone` auction_monitor.auction_results|created_at|timestamp with time zone
- **`auction_monitor.auction_results|updated_at|timestamp with time zone`**:
  - `auction_monitor.auction_results|updated_at|timestamp with time zone` auction_monitor.auction_results|updated_at|timestamp with time zone
- **`auction_monitor.data_quality_metrics|id|uuid`**:
  - `auction_monitor.data_quality_metrics|id|uuid` auction_monitor.data_quality_metrics|id|uuid
- **`auction_monitor.data_quality_metrics|platform|character varying(50)`**:
  - `auction_monitor.data_quality_metrics|platform|character varying(50)` auction_monitor.data_quality_metrics|platform|character varying(50)
- **`auction_monitor.data_quality_metrics|metric_date|date`**:
  - `auction_monitor.data_quality_metrics|metric_date|date` auction_monitor.data_quality_metrics|metric_date|date
- **`auction_monitor.data_quality_metrics|total_listings|integer`**:
  - `auction_monitor.data_quality_metrics|total_listings|integer` auction_monitor.data_quality_metrics|total_listings|integer
- **`auction_monitor.data_quality_metrics|validated_listings|integer`**:
  - `auction_monitor.data_quality_metrics|validated_listings|integer` auction_monitor.data_quality_metrics|validated_listings|integer
- **`auction_monitor.data_quality_metrics|failed_validations|integer`**:
  - `auction_monitor.data_quality_metrics|failed_validations|integer` auction_monitor.data_quality_metrics|failed_validations|integer
- **`auction_monitor.data_quality_metrics|avg_confidence_score|numeric`**:
  - `auction_monitor.data_quality_metrics|avg_confidence_score|numeric` auction_monitor.data_quality_metrics|avg_confidence_score|numeric
- **`auction_monitor.data_quality_metrics|avg_completeness_score|numeric`**:
  - `auction_monitor.data_quality_metrics|avg_completeness_score|numeric` auction_monitor.data_quality_metrics|avg_completeness_score|numeric
- **`auction_monitor.data_quality_metrics|duplicate_count|integer`**:
  - `auction_monitor.data_quality_metrics|duplicate_count|integer` auction_monitor.data_quality_metrics|duplicate_count|integer
- **`auction_monitor.data_quality_metrics|enrichment_rate|numeric`**:
  - `auction_monitor.data_quality_metrics|enrichment_rate|numeric` auction_monitor.data_quality_metrics|enrichment_rate|numeric
- **`auction_monitor.data_quality_metrics|created_at|timestamp with time zone`**:
  - `auction_monitor.data_quality_metrics|created_at|timestamp with time zone` auction_monitor.data_quality_metrics|created_at|timestamp with time zone
- **`auction_monitor.monitoring_jobs|id|uuid`**:
  - `auction_monitor.monitoring_jobs|id|uuid` auction_monitor.monitoring_jobs|id|uuid
- **`auction_monitor.monitoring_jobs|user_id|uuid`**:
  - `auction_monitor.monitoring_jobs|user_id|uuid` auction_monitor.monitoring_jobs|user_id|uuid
- **`auction_monitor.monitoring_jobs|source|text`**:
  - `auction_monitor.monitoring_jobs|source|text` auction_monitor.monitoring_jobs|source|text
- **`auction_monitor.monitoring_jobs|query|text`**:
  - `auction_monitor.monitoring_jobs|query|text` auction_monitor.monitoring_jobs|query|text
- **`auction_monitor.monitoring_jobs|active|boolean`**:
  - `auction_monitor.monitoring_jobs|active|boolean` auction_monitor.monitoring_jobs|active|boolean
- **`auction_monitor.monitoring_jobs|last_run_at|timestamp with time zone`**:
  - `auction_monitor.monitoring_jobs|last_run_at|timestamp with time zone` auction_monitor.monitoring_jobs|last_run_at|timestamp with time zone
- **`auction_monitor.monitoring_jobs|last_result_count|integer`**:
  - `auction_monitor.monitoring_jobs|last_result_count|integer` auction_monitor.monitoring_jobs|last_result_count|integer
- **`auction_monitor.monitoring_jobs|created_at|timestamp with time zone`**:
  - `auction_monitor.monitoring_jobs|created_at|timestamp with time zone` auction_monitor.monitoring_jobs|created_at|timestamp with time zone
- **`auction_monitor.monitoring_jobs|updated_at|timestamp with time zone`**:
  - `auction_monitor.monitoring_jobs|updated_at|timestamp with time zone` auction_monitor.monitoring_jobs|updated_at|timestamp with time zone
- **`auction_monitor.normalized_listings|id|uuid`**:
  - `auction_monitor.normalized_listings|id|uuid` auction_monitor.normalized_listings|id|uuid
- **`auction_monitor.normalized_listings|raw_listing_id|uuid`**:
  - `auction_monitor.normalized_listings|raw_listing_id|uuid` auction_monitor.normalized_listings|raw_listing_id|uuid
- **`auction_monitor.normalized_listings|platform|character varying(50)`**:
  - `auction_monitor.normalized_listings|platform|character varying(50)` auction_monitor.normalized_listings|platform|character varying(50)
- **`auction_monitor.normalized_listings|external_id|character varying(255)`**:
  - `auction_monitor.normalized_listings|external_id|character varying(255)` auction_monitor.normalized_listings|external_id|character varying(255)
- **`auction_monitor.normalized_listings|url|text`**:
  - `auction_monitor.normalized_listings|url|text` auction_monitor.normalized_listings|url|text
- **`auction_monitor.normalized_listings|title|text`**:
  - `auction_monitor.normalized_listings|title|text` auction_monitor.normalized_listings|title|text
- **`auction_monitor.normalized_listings|description|text`**:
  - `auction_monitor.normalized_listings|description|text` auction_monitor.normalized_listings|description|text
- **`auction_monitor.normalized_listings|current_price|numeric`**:
  - `auction_monitor.normalized_listings|current_price|numeric` auction_monitor.normalized_listings|current_price|numeric
- **`auction_monitor.normalized_listings|currency|character varying(3)`**:
  - `auction_monitor.normalized_listings|currency|character varying(3)` auction_monitor.normalized_listings|currency|character varying(3)
- **`auction_monitor.normalized_listings|condition|character varying(50)`**:
  - `auction_monitor.normalized_listings|condition|character varying(50)` auction_monitor.normalized_listings|condition|character varying(50)
- **`auction_monitor.normalized_listings|format|character varying(50)`**:
  - `auction_monitor.normalized_listings|format|character varying(50)` auction_monitor.normalized_listings|format|character varying(50)
- **`auction_monitor.normalized_listings|artist|character varying(255)`**:
  - `auction_monitor.normalized_listings|artist|character varying(255)` auction_monitor.normalized_listings|artist|character varying(255)
- **`auction_monitor.normalized_listings|album|character varying(255)`**:
  - `auction_monitor.normalized_listings|album|character varying(255)` auction_monitor.normalized_listings|album|character varying(255)
- **`auction_monitor.normalized_listings|catalog_number|character varying(100)`**:
  - `auction_monitor.normalized_listings|catalog_number|character varying(100)` auction_monitor.normalized_listings|catalog_number|character varying(100)
- **`auction_monitor.normalized_listings|label|character varying(255)`**:
  - `auction_monitor.normalized_listings|label|character varying(255)` auction_monitor.normalized_listings|label|character varying(255)
- **`auction_monitor.normalized_listings|year|integer`**:
  - `auction_monitor.normalized_listings|year|integer` auction_monitor.normalized_listings|year|integer
- **`auction_monitor.normalized_listings|seller_id|character varying(255)`**:
  - `auction_monitor.normalized_listings|seller_id|character varying(255)` auction_monitor.normalized_listings|seller_id|character varying(255)
- **`auction_monitor.normalized_listings|seller_name|character varying(255)`**:
  - `auction_monitor.normalized_listings|seller_name|character varying(255)` auction_monitor.normalized_listings|seller_name|character varying(255)
- **`auction_monitor.normalized_listings|seller_feedback_score|integer`**:
  - `auction_monitor.normalized_listings|seller_feedback_score|integer` auction_monitor.normalized_listings|seller_feedback_score|integer
- **`auction_monitor.normalized_listings|seller_location|character varying(255)`**:
  - `auction_monitor.normalized_listings|seller_location|character varying(255)` auction_monitor.normalized_listings|seller_location|character varying(255)
- **`auction_monitor.normalized_listings|listing_type|character varying(50)`**:
  - `auction_monitor.normalized_listings|listing_type|character varying(50)` auction_monitor.normalized_listings|listing_type|character varying(50)
- **`auction_monitor.normalized_listings|starting_price|numeric`**:
  - `auction_monitor.normalized_listings|starting_price|numeric` auction_monitor.normalized_listings|starting_price|numeric
- **`auction_monitor.normalized_listings|buy_it_now_price|numeric`**:
  - `auction_monitor.normalized_listings|buy_it_now_price|numeric` auction_monitor.normalized_listings|buy_it_now_price|numeric
- **`auction_monitor.normalized_listings|bid_count|integer`**:
  - `auction_monitor.normalized_listings|bid_count|integer` auction_monitor.normalized_listings|bid_count|integer
- **`auction_monitor.normalized_listings|watcher_count|integer`**:
  - `auction_monitor.normalized_listings|watcher_count|integer` auction_monitor.normalized_listings|watcher_count|integer
- **`auction_monitor.normalized_listings|time_remaining|interval`**:
  - `auction_monitor.normalized_listings|time_remaining|interval` auction_monitor.normalized_listings|time_remaining|interval
- **`auction_monitor.normalized_listings|end_date|timestamp with time zone`**:
  - `auction_monitor.normalized_listings|end_date|timestamp with time zone` auction_monitor.normalized_listings|end_date|timestamp with time zone
- **`auction_monitor.normalized_listings|shipping_cost|numeric`**:
  - `auction_monitor.normalized_listings|shipping_cost|numeric` auction_monitor.normalized_listings|shipping_cost|numeric
- **`auction_monitor.normalized_listings|shipping_location|character varying(255)`**:
  - `auction_monitor.normalized_listings|shipping_location|character varying(255)` auction_monitor.normalized_listings|shipping_location|character varying(255)
- **`auction_monitor.normalized_listings|estimated_total|numeric`**:
  - `auction_monitor.normalized_listings|estimated_total|numeric` auction_monitor.normalized_listings|estimated_total|numeric
- **`auction_monitor.normalized_listings|proxy_service|character varying(50)`**:
  - `auction_monitor.normalized_listings|proxy_service|character varying(50)` auction_monitor.normalized_listings|proxy_service|character varying(50)
- **`auction_monitor.normalized_listings|proxy_fee|numeric`**:
  - `auction_monitor.normalized_listings|proxy_fee|numeric` auction_monitor.normalized_listings|proxy_fee|numeric
- **`auction_monitor.normalized_listings|consolidation_fee|numeric`**:
  - `auction_monitor.normalized_listings|consolidation_fee|numeric` auction_monitor.normalized_listings|consolidation_fee|numeric
- **`auction_monitor.normalized_listings|international_shipping|numeric`**:
  - `auction_monitor.normalized_listings|international_shipping|numeric` auction_monitor.normalized_listings|international_shipping|numeric
- **`auction_monitor.normalized_listings|images|jsonb`**:
  - `auction_monitor.normalized_listings|images|jsonb` auction_monitor.normalized_listings|images|jsonb
- **`auction_monitor.normalized_listings|thumbnail_url|text`**:
  - `auction_monitor.normalized_listings|thumbnail_url|text` auction_monitor.normalized_listings|thumbnail_url|text
- **`auction_monitor.normalized_listings|location_restrictions|jsonb`**:
  - `auction_monitor.normalized_listings|location_restrictions|jsonb` auction_monitor.normalized_listings|location_restrictions|jsonb
- **`auction_monitor.normalized_listings|payment_restrictions|jsonb`**:
  - `auction_monitor.normalized_listings|payment_restrictions|jsonb` auction_monitor.normalized_listings|payment_restrictions|jsonb
- **`auction_monitor.normalized_listings|review_restrictions|jsonb`**:
  - `auction_monitor.normalized_listings|review_restrictions|jsonb` auction_monitor.normalized_listings|review_restrictions|jsonb
- **`auction_monitor.normalized_listings|confidence_score|numeric`**:
  - `auction_monitor.normalized_listings|confidence_score|numeric` auction_monitor.normalized_listings|confidence_score|numeric
- **`auction_monitor.normalized_listings|completeness_score|numeric`**:
  - `auction_monitor.normalized_listings|completeness_score|numeric` auction_monitor.normalized_listings|completeness_score|numeric
- **`auction_monitor.normalized_listings|data_quality_flags|jsonb`**:
  - `auction_monitor.normalized_listings|data_quality_flags|jsonb` auction_monitor.normalized_listings|data_quality_flags|jsonb
- **`auction_monitor.normalized_listings|discogs_release_id|integer`**:
  - `auction_monitor.normalized_listings|discogs_release_id|integer` auction_monitor.normalized_listings|discogs_release_id|integer
- **`auction_monitor.normalized_listings|catalog_match_confidence|numeric`**:
  - `auction_monitor.normalized_listings|catalog_match_confidence|numeric` auction_monitor.normalized_listings|catalog_match_confidence|numeric
- **`auction_monitor.normalized_listings|created_at|timestamp with time zone`**:
  - `auction_monitor.normalized_listings|created_at|timestamp with time zone` auction_monitor.normalized_listings|created_at|timestamp with time zone
- **`auction_monitor.normalized_listings|updated_at|timestamp with time zone`**:
  - `auction_monitor.normalized_listings|updated_at|timestamp with time zone` auction_monitor.normalized_listings|updated_at|timestamp with time zone
- **`auction_monitor.normalized_listings|last_seen_at|timestamp with time zone`**:
  - `auction_monitor.normalized_listings|last_seen_at|timestamp with time zone` auction_monitor.normalized_listings|last_seen_at|timestamp with time zone
- **`auction_monitor.platform_health|id|uuid`**:
  - `auction_monitor.platform_health|id|uuid` auction_monitor.platform_health|id|uuid
- **`auction_monitor.platform_health|platform|character varying(50)`**:
  - `auction_monitor.platform_health|platform|character varying(50)` auction_monitor.platform_health|platform|character varying(50)
- **`auction_monitor.platform_health|check_type|character varying(50)`**:
  - `auction_monitor.platform_health|check_type|character varying(50)` auction_monitor.platform_health|check_type|character varying(50)
- **`auction_monitor.platform_health|status|character varying(20)`**:
  - `auction_monitor.platform_health|status|character varying(20)` auction_monitor.platform_health|status|character varying(20)
- **`auction_monitor.platform_health|response_time_ms|integer`**:
  - `auction_monitor.platform_health|response_time_ms|integer` auction_monitor.platform_health|response_time_ms|integer
- **`auction_monitor.platform_health|error_message|text`**:
  - `auction_monitor.platform_health|error_message|text` auction_monitor.platform_health|error_message|text
- **`auction_monitor.platform_health|checked_at|timestamp with time zone`**:
  - `auction_monitor.platform_health|checked_at|timestamp with time zone` auction_monitor.platform_health|checked_at|timestamp with time zone
- **`auction_monitor.price_history|id|uuid`**:
  - `auction_monitor.price_history|id|uuid` auction_monitor.price_history|id|uuid
- **`auction_monitor.price_history|normalized_listing_id|uuid`**:
  - `auction_monitor.price_history|normalized_listing_id|uuid` auction_monitor.price_history|normalized_listing_id|uuid
- **`auction_monitor.price_history|snapshot_at|timestamp with time zone`**:
  - `auction_monitor.price_history|snapshot_at|timestamp with time zone` auction_monitor.price_history|snapshot_at|timestamp with time zone
- **`auction_monitor.price_history|price|numeric`**:
  - `auction_monitor.price_history|price|numeric` auction_monitor.price_history|price|numeric
- **`auction_monitor.price_history|currency|character varying(3)`**:
  - `auction_monitor.price_history|currency|character varying(3)` auction_monitor.price_history|currency|character varying(3)
- **`auction_monitor.price_history|bid_count|integer`**:
  - `auction_monitor.price_history|bid_count|integer` auction_monitor.price_history|bid_count|integer
- **`auction_monitor.price_history|watcher_count|integer`**:
  - `auction_monitor.price_history|watcher_count|integer` auction_monitor.price_history|watcher_count|integer
- **`auction_monitor.price_history|time_remaining|interval`**:
  - `auction_monitor.price_history|time_remaining|interval` auction_monitor.price_history|time_remaining|interval
- **`auction_monitor.price_history|status|character varying(50)`**:
  - `auction_monitor.price_history|status|character varying(50)` auction_monitor.price_history|status|character varying(50)
- **`auction_monitor.price_history|metadata|jsonb`**:
  - `auction_monitor.price_history|metadata|jsonb` auction_monitor.price_history|metadata|jsonb
- **`auction_monitor.raw_listings|id|uuid`**:
  - `auction_monitor.raw_listings|id|uuid` auction_monitor.raw_listings|id|uuid
- **`auction_monitor.raw_listings|platform|character varying(50)`**:
  - `auction_monitor.raw_listings|platform|character varying(50)` auction_monitor.raw_listings|platform|character varying(50)
- **`auction_monitor.raw_listings|external_id|character varying(255)`**:
  - `auction_monitor.raw_listings|external_id|character varying(255)` auction_monitor.raw_listings|external_id|character varying(255)
- **`auction_monitor.raw_listings|url|text`**:
  - `auction_monitor.raw_listings|url|text` auction_monitor.raw_listings|url|text
- **`auction_monitor.raw_listings|raw_data|jsonb`**:
  - `auction_monitor.raw_listings|raw_data|jsonb` auction_monitor.raw_listings|raw_data|jsonb
- **`auction_monitor.raw_listings|ingestion_status|character varying(20)`**:
  - `auction_monitor.raw_listings|ingestion_status|character varying(20)` auction_monitor.raw_listings|ingestion_status|character varying(20)
- **`auction_monitor.raw_listings|validation_errors|jsonb`**:
  - `auction_monitor.raw_listings|validation_errors|jsonb` auction_monitor.raw_listings|validation_errors|jsonb
- **`auction_monitor.raw_listings|ingested_at|timestamp with time zone`**:
  - `auction_monitor.raw_listings|ingested_at|timestamp with time zone` auction_monitor.raw_listings|ingested_at|timestamp with time zone
- **`auction_monitor.raw_listings|processed_at|timestamp with time zone`**:
  - `auction_monitor.raw_listings|processed_at|timestamp with time zone` auction_monitor.raw_listings|processed_at|timestamp with time zone
- **`auction_monitor.user_saved_auctions|id|uuid`**:
  - `auction_monitor.user_saved_auctions|id|uuid` auction_monitor.user_saved_auctions|id|uuid
- **`auction_monitor.user_saved_auctions|user_id|uuid`**:
  - `auction_monitor.user_saved_auctions|user_id|uuid` auction_monitor.user_saved_auctions|user_id|uuid
- **`auction_monitor.user_saved_auctions|auction_result_id|uuid`**:
  - `auction_monitor.user_saved_auctions|auction_result_id|uuid` auction_monitor.user_saved_auctions|auction_result_id|uuid
- **`auction_monitor.user_saved_auctions|notes|text`**:
  - `auction_monitor.user_saved_auctions|notes|text` auction_monitor.user_saved_auctions|notes|text
- **`auction_monitor.user_saved_auctions|created_at|timestamp with time zone`**:
  - `auction_monitor.user_saved_auctions|created_at|timestamp with time zone` auction_monitor.user_saved_auctions|created_at|timestamp with time zone
- **`auction_monitor.user_watches|id|uuid`**:
  - `auction_monitor.user_watches|id|uuid` auction_monitor.user_watches|id|uuid
- **`auction_monitor.user_watches|user_id|uuid`**:
  - `auction_monitor.user_watches|user_id|uuid` auction_monitor.user_watches|user_id|uuid
- **`auction_monitor.user_watches|search_criteria|jsonb`**:
  - `auction_monitor.user_watches|search_criteria|jsonb` auction_monitor.user_watches|search_criteria|jsonb
- **`auction_monitor.user_watches|platforms|jsonb`**:
  - `auction_monitor.user_watches|platforms|jsonb` auction_monitor.user_watches|platforms|jsonb
- **`auction_monitor.user_watches|notification_preferences|jsonb`**:
  - `auction_monitor.user_watches|notification_preferences|jsonb` auction_monitor.user_watches|notification_preferences|jsonb
- **`auction_monitor.user_watches|status|character varying(20)`**:
  - `auction_monitor.user_watches|status|character varying(20)` auction_monitor.user_watches|status|character varying(20)
- **`auction_monitor.user_watches|created_at|timestamp with time zone`**:
  - `auction_monitor.user_watches|created_at|timestamp with time zone` auction_monitor.user_watches|created_at|timestamp with time zone
- **`auction_monitor.user_watches|expires_at|timestamp with time zone`**:
  - `auction_monitor.user_watches|expires_at|timestamp with time zone` auction_monitor.user_watches|expires_at|timestamp with time zone
- **`auction_monitor.user_watches|last_checked_at|timestamp with time zone`**:
  - `auction_monitor.user_watches|last_checked_at|timestamp with time zone` auction_monitor.user_watches|last_checked_at|timestamp with time zone
- **`auction_monitor.watch_matches|id|uuid`**:
  - `auction_monitor.watch_matches|id|uuid` auction_monitor.watch_matches|id|uuid
- **`auction_monitor.watch_matches|watch_id|uuid`**:
  - `auction_monitor.watch_matches|watch_id|uuid` auction_monitor.watch_matches|watch_id|uuid
- **`auction_monitor.watch_matches|normalized_listing_id|uuid`**:
  - `auction_monitor.watch_matches|normalized_listing_id|uuid` auction_monitor.watch_matches|normalized_listing_id|uuid
- **`auction_monitor.watch_matches|match_score|numeric`**:
  - `auction_monitor.watch_matches|match_score|numeric` auction_monitor.watch_matches|match_score|numeric
- **`auction_monitor.watch_matches|notified_at|timestamp with time zone`**:
  - `auction_monitor.watch_matches|notified_at|timestamp with time zone` auction_monitor.watch_matches|notified_at|timestamp with time zone
- **`auction_monitor.watch_matches|created_at|timestamp with time zone`**:
  - `auction_monitor.watch_matches|created_at|timestamp with time zone` auction_monitor.watch_matches|created_at|timestamp with time zone

## Port 5439 — analytics (record-platform-postgres-analytics-1)

**Databases:** analytics postgres 

### DB `analytics`

**Schemas:** analytics public 

**Tables (approx. row count from planner):**

| Schema.Table | ~rows |
|--------------|-------|
| analytics.aggregated_metrics | 0 |
| analytics.price_snapshots | 0 |
| analytics.search_analytics | 0 |
| analytics.trend_snapshots | 0 |
| analytics.user_behavior | 0 |

**Table definitions (columns):**

- **`analytics.aggregated_metrics|id|uuid`**:
  - `analytics.aggregated_metrics|id|uuid` analytics.aggregated_metrics|id|uuid
- **`analytics.aggregated_metrics|metric_name|text`**:
  - `analytics.aggregated_metrics|metric_name|text` analytics.aggregated_metrics|metric_name|text
- **`analytics.aggregated_metrics|metric_value|jsonb`**:
  - `analytics.aggregated_metrics|metric_value|jsonb` analytics.aggregated_metrics|metric_value|jsonb
- **`analytics.aggregated_metrics|aggregation_date|date`**:
  - `analytics.aggregated_metrics|aggregation_date|date` analytics.aggregated_metrics|aggregation_date|date
- **`analytics.aggregated_metrics|period|text`**:
  - `analytics.aggregated_metrics|period|text` analytics.aggregated_metrics|period|text
- **`analytics.aggregated_metrics|created_at|timestamp with time zone`**:
  - `analytics.aggregated_metrics|created_at|timestamp with time zone` analytics.aggregated_metrics|created_at|timestamp with time zone
- **`analytics.price_snapshots|id|uuid`**:
  - `analytics.price_snapshots|id|uuid` analytics.price_snapshots|id|uuid
- **`analytics.price_snapshots|record_id|uuid`**:
  - `analytics.price_snapshots|record_id|uuid` analytics.price_snapshots|record_id|uuid
- **`analytics.price_snapshots|source|text`**:
  - `analytics.price_snapshots|source|text` analytics.price_snapshots|source|text
- **`analytics.price_snapshots|price|numeric`**:
  - `analytics.price_snapshots|price|numeric` analytics.price_snapshots|price|numeric
- **`analytics.price_snapshots|currency|text`**:
  - `analytics.price_snapshots|currency|text` analytics.price_snapshots|currency|text
- **`analytics.price_snapshots|condition_record|text`**:
  - `analytics.price_snapshots|condition_record|text` analytics.price_snapshots|condition_record|text
- **`analytics.price_snapshots|condition_sleeve|text`**:
  - `analytics.price_snapshots|condition_sleeve|text` analytics.price_snapshots|condition_sleeve|text
- **`analytics.price_snapshots|snapshot_date|date`**:
  - `analytics.price_snapshots|snapshot_date|date` analytics.price_snapshots|snapshot_date|date
- **`analytics.price_snapshots|created_at|timestamp with time zone`**:
  - `analytics.price_snapshots|created_at|timestamp with time zone` analytics.price_snapshots|created_at|timestamp with time zone
- **`analytics.search_analytics|id|uuid`**:
  - `analytics.search_analytics|id|uuid` analytics.search_analytics|id|uuid
- **`analytics.search_analytics|user_id|uuid`**:
  - `analytics.search_analytics|user_id|uuid` analytics.search_analytics|user_id|uuid
- **`analytics.search_analytics|query|text`**:
  - `analytics.search_analytics|query|text` analytics.search_analytics|query|text
- **`analytics.search_analytics|result_count|integer`**:
  - `analytics.search_analytics|result_count|integer` analytics.search_analytics|result_count|integer
- **`analytics.search_analytics|clicked_result_id|uuid`**:
  - `analytics.search_analytics|clicked_result_id|uuid` analytics.search_analytics|clicked_result_id|uuid
- **`analytics.search_analytics|search_timestamp|timestamp with time zone`**:
  - `analytics.search_analytics|search_timestamp|timestamp with time zone` analytics.search_analytics|search_timestamp|timestamp with time zone
- **`analytics.search_analytics|session_id|text`**:
  - `analytics.search_analytics|session_id|text` analytics.search_analytics|session_id|text
- **`analytics.search_analytics|user_agent|text`**:
  - `analytics.search_analytics|user_agent|text` analytics.search_analytics|user_agent|text
- **`analytics.search_analytics|ip_address|inet`**:
  - `analytics.search_analytics|ip_address|inet` analytics.search_analytics|ip_address|inet
- **`analytics.trend_snapshots|id|uuid`**:
  - `analytics.trend_snapshots|id|uuid` analytics.trend_snapshots|id|uuid
- **`analytics.trend_snapshots|record_id|uuid`**:
  - `analytics.trend_snapshots|record_id|uuid` analytics.trend_snapshots|record_id|uuid
- **`analytics.trend_snapshots|metric_type|text`**:
  - `analytics.trend_snapshots|metric_type|text` analytics.trend_snapshots|metric_type|text
- **`analytics.trend_snapshots|metric_value|numeric`**:
  - `analytics.trend_snapshots|metric_value|numeric` analytics.trend_snapshots|metric_value|numeric
- **`analytics.trend_snapshots|snapshot_date|date`**:
  - `analytics.trend_snapshots|snapshot_date|date` analytics.trend_snapshots|snapshot_date|date
- **`analytics.trend_snapshots|period|text`**:
  - `analytics.trend_snapshots|period|text` analytics.trend_snapshots|period|text
- **`analytics.trend_snapshots|created_at|timestamp with time zone`**:
  - `analytics.trend_snapshots|created_at|timestamp with time zone` analytics.trend_snapshots|created_at|timestamp with time zone
- **`analytics.user_behavior|id|uuid`**:
  - `analytics.user_behavior|id|uuid` analytics.user_behavior|id|uuid
- **`analytics.user_behavior|user_id|uuid`**:
  - `analytics.user_behavior|user_id|uuid` analytics.user_behavior|user_id|uuid
- **`analytics.user_behavior|event_type|text`**:
  - `analytics.user_behavior|event_type|text` analytics.user_behavior|event_type|text
- **`analytics.user_behavior|entity_type|text`**:
  - `analytics.user_behavior|entity_type|text` analytics.user_behavior|entity_type|text
- **`analytics.user_behavior|entity_id|uuid`**:
  - `analytics.user_behavior|entity_id|uuid` analytics.user_behavior|entity_id|uuid
- **`analytics.user_behavior|metadata|jsonb`**:
  - `analytics.user_behavior|metadata|jsonb` analytics.user_behavior|metadata|jsonb
- **`analytics.user_behavior|event_timestamp|timestamp with time zone`**:
  - `analytics.user_behavior|event_timestamp|timestamp with time zone` analytics.user_behavior|event_timestamp|timestamp with time zone

### DB `postgres`

**Schemas:** public 

  (no user tables — expected for default DB `postgres` / schema `public`; app uses named schemas above)

## Port 5440 — python_ai (record-platform-postgres-python-ai-1)

**Databases:** postgres python_ai 

### DB `postgres`

**Schemas:** public 

  (no user tables — expected for default DB `postgres` / schema `public`; app uses named schemas above)

### DB `python_ai`

**Schemas:** ai public 

**Tables (approx. row count from planner):**

| Schema.Table | ~rows |
|--------------|-------|
| ai.analytics_cache | 0 |
| ai.events | 165 |
| ai.inference_log | 169 |
| ai.model_metadata | 0 |
| ai.model_metrics | 0 |
| ai.prediction_feedback | 0 |
| ai.predictions | 169 |
| ai.price_predictions | 0 |
| ai.record_embeddings | 0 |
| ai.training_data | 0 |
| ai.training_runs | 0 |

**Table definitions (columns):**

- **`ai.analytics_cache|id|uuid`**:
  - `ai.analytics_cache|id|uuid` ai.analytics_cache|id|uuid
- **`ai.analytics_cache|query|text`**:
  - `ai.analytics_cache|query|text` ai.analytics_cache|query|text
- **`ai.analytics_cache|query_hash|text`**:
  - `ai.analytics_cache|query_hash|text` ai.analytics_cache|query_hash|text
- **`ai.analytics_cache|user_id|uuid`**:
  - `ai.analytics_cache|user_id|uuid` ai.analytics_cache|user_id|uuid
- **`ai.analytics_cache|cache_type|text`**:
  - `ai.analytics_cache|cache_type|text` ai.analytics_cache|cache_type|text
- **`ai.analytics_cache|cached_data|jsonb`**:
  - `ai.analytics_cache|cached_data|jsonb` ai.analytics_cache|cached_data|jsonb
- **`ai.analytics_cache|created_at|timestamp with time zone`**:
  - `ai.analytics_cache|created_at|timestamp with time zone` ai.analytics_cache|created_at|timestamp with time zone
- **`ai.analytics_cache|expires_at|timestamp with time zone`**:
  - `ai.analytics_cache|expires_at|timestamp with time zone` ai.analytics_cache|expires_at|timestamp with time zone
- **`ai.events|id|uuid`**:
  - `ai.events|id|uuid` ai.events|id|uuid
- **`ai.events|event_type|text`**:
  - `ai.events|event_type|text` ai.events|event_type|text
- **`ai.events|user_id|uuid`**:
  - `ai.events|user_id|uuid` ai.events|user_id|uuid
- **`ai.events|query|text`**:
  - `ai.events|query|text` ai.events|query|text
- **`ai.events|event_data|jsonb`**:
  - `ai.events|event_data|jsonb` ai.events|event_data|jsonb
- **`ai.events|kafka_published|boolean`**:
  - `ai.events|kafka_published|boolean` ai.events|kafka_published|boolean
- **`ai.events|kafka_topic|text`**:
  - `ai.events|kafka_topic|text` ai.events|kafka_topic|text
- **`ai.events|created_at|timestamp with time zone`**:
  - `ai.events|created_at|timestamp with time zone` ai.events|created_at|timestamp with time zone
- **`ai.inference_log|id|uuid`**:
  - `ai.inference_log|id|uuid` ai.inference_log|id|uuid
- **`ai.inference_log|user_id|uuid`**:
  - `ai.inference_log|user_id|uuid` ai.inference_log|user_id|uuid
- **`ai.inference_log|query|text`**:
  - `ai.inference_log|query|text` ai.inference_log|query|text
- **`ai.inference_log|inference_type|text`**:
  - `ai.inference_log|inference_type|text` ai.inference_log|inference_type|text
- **`ai.inference_log|input_data|jsonb`**:
  - `ai.inference_log|input_data|jsonb` ai.inference_log|input_data|jsonb
- **`ai.inference_log|output_data|jsonb`**:
  - `ai.inference_log|output_data|jsonb` ai.inference_log|output_data|jsonb
- **`ai.inference_log|processing_time_ms|integer`**:
  - `ai.inference_log|processing_time_ms|integer` ai.inference_log|processing_time_ms|integer
- **`ai.inference_log|analytics_data_used|boolean`**:
  - `ai.inference_log|analytics_data_used|boolean` ai.inference_log|analytics_data_used|boolean
- **`ai.inference_log|cache_hit|boolean`**:
  - `ai.inference_log|cache_hit|boolean` ai.inference_log|cache_hit|boolean
- **`ai.inference_log|created_at|timestamp with time zone`**:
  - `ai.inference_log|created_at|timestamp with time zone` ai.inference_log|created_at|timestamp with time zone
- **`ai.model_metadata|id|uuid`**:
  - `ai.model_metadata|id|uuid` ai.model_metadata|id|uuid
- **`ai.model_metadata|model_name|text`**:
  - `ai.model_metadata|model_name|text` ai.model_metadata|model_name|text
- **`ai.model_metadata|model_version|text`**:
  - `ai.model_metadata|model_version|text` ai.model_metadata|model_version|text
- **`ai.model_metadata|model_type|text`**:
  - `ai.model_metadata|model_type|text` ai.model_metadata|model_type|text
- **`ai.model_metadata|model_path|text`**:
  - `ai.model_metadata|model_path|text` ai.model_metadata|model_path|text
- **`ai.model_metadata|training_date|timestamp with time zone`**:
  - `ai.model_metadata|training_date|timestamp with time zone` ai.model_metadata|training_date|timestamp with time zone
- **`ai.model_metadata|accuracy_metrics|jsonb`**:
  - `ai.model_metadata|accuracy_metrics|jsonb` ai.model_metadata|accuracy_metrics|jsonb
- **`ai.model_metadata|hyperparameters|jsonb`**:
  - `ai.model_metadata|hyperparameters|jsonb` ai.model_metadata|hyperparameters|jsonb
- **`ai.model_metadata|is_active|boolean`**:
  - `ai.model_metadata|is_active|boolean` ai.model_metadata|is_active|boolean
- **`ai.model_metadata|created_at|timestamp with time zone`**:
  - `ai.model_metadata|created_at|timestamp with time zone` ai.model_metadata|created_at|timestamp with time zone
- **`ai.model_metadata|updated_at|timestamp with time zone`**:
  - `ai.model_metadata|updated_at|timestamp with time zone` ai.model_metadata|updated_at|timestamp with time zone
- **`ai.model_metrics|id|uuid`**:
  - `ai.model_metrics|id|uuid` ai.model_metrics|id|uuid
- **`ai.model_metrics|model_type|text`**:
  - `ai.model_metrics|model_type|text` ai.model_metrics|model_type|text
- **`ai.model_metrics|metric_name|text`**:
  - `ai.model_metrics|metric_name|text` ai.model_metrics|metric_name|text
- **`ai.model_metrics|metric_value|numeric`**:
  - `ai.model_metrics|metric_value|numeric` ai.model_metrics|metric_value|numeric
- **`ai.model_metrics|sample_size|integer`**:
  - `ai.model_metrics|sample_size|integer` ai.model_metrics|sample_size|integer
- **`ai.model_metrics|evaluation_period_start|timestamp with time zone`**:
  - `ai.model_metrics|evaluation_period_start|timestamp with time zone` ai.model_metrics|evaluation_period_start|timestamp with time zone
- **`ai.model_metrics|evaluation_period_end|timestamp with time zone`**:
  - `ai.model_metrics|evaluation_period_end|timestamp with time zone` ai.model_metrics|evaluation_period_end|timestamp with time zone
- **`ai.model_metrics|metadata|jsonb`**:
  - `ai.model_metrics|metadata|jsonb` ai.model_metrics|metadata|jsonb
- **`ai.model_metrics|created_at|timestamp with time zone`**:
  - `ai.model_metrics|created_at|timestamp with time zone` ai.model_metrics|created_at|timestamp with time zone
- **`ai.prediction_feedback|id|uuid`**:
  - `ai.prediction_feedback|id|uuid` ai.prediction_feedback|id|uuid
- **`ai.prediction_feedback|prediction_id|uuid`**:
  - `ai.prediction_feedback|prediction_id|uuid` ai.prediction_feedback|prediction_id|uuid
- **`ai.prediction_feedback|user_id|uuid`**:
  - `ai.prediction_feedback|user_id|uuid` ai.prediction_feedback|user_id|uuid
- **`ai.prediction_feedback|feedback_type|text`**:
  - `ai.prediction_feedback|feedback_type|text` ai.prediction_feedback|feedback_type|text
- **`ai.prediction_feedback|actual_price|numeric`**:
  - `ai.prediction_feedback|actual_price|numeric` ai.prediction_feedback|actual_price|numeric
- **`ai.prediction_feedback|notes|text`**:
  - `ai.prediction_feedback|notes|text` ai.prediction_feedback|notes|text
- **`ai.prediction_feedback|created_at|timestamp with time zone`**:
  - `ai.prediction_feedback|created_at|timestamp with time zone` ai.prediction_feedback|created_at|timestamp with time zone
- **`ai.predictions|id|uuid`**:
  - `ai.predictions|id|uuid` ai.predictions|id|uuid
- **`ai.predictions|query|text`**:
  - `ai.predictions|query|text` ai.predictions|query|text
- **`ai.predictions|query_hash|text`**:
  - `ai.predictions|query_hash|text` ai.predictions|query_hash|text
- **`ai.predictions|prediction_type|text`**:
  - `ai.predictions|prediction_type|text` ai.predictions|prediction_type|text
- **`ai.predictions|user_id|uuid`**:
  - `ai.predictions|user_id|uuid` ai.predictions|user_id|uuid
- **`ai.predictions|input_data|jsonb`**:
  - `ai.predictions|input_data|jsonb` ai.predictions|input_data|jsonb
- **`ai.predictions|prediction_result|jsonb`**:
  - `ai.predictions|prediction_result|jsonb` ai.predictions|prediction_result|jsonb
- **`ai.predictions|confidence_score|numeric`**:
  - `ai.predictions|confidence_score|numeric` ai.predictions|confidence_score|numeric
- **`ai.predictions|created_at|timestamp with time zone`**:
  - `ai.predictions|created_at|timestamp with time zone` ai.predictions|created_at|timestamp with time zone
- **`ai.predictions|expires_at|timestamp with time zone`**:
  - `ai.predictions|expires_at|timestamp with time zone` ai.predictions|expires_at|timestamp with time zone
- **`ai.price_predictions|id|uuid`**:
  - `ai.price_predictions|id|uuid` ai.price_predictions|id|uuid
- **`ai.price_predictions|record_id|uuid`**:
  - `ai.price_predictions|record_id|uuid` ai.price_predictions|record_id|uuid
- **`ai.price_predictions|model_id|uuid`**:
  - `ai.price_predictions|model_id|uuid` ai.price_predictions|model_id|uuid
- **`ai.price_predictions|predicted_price|numeric`**:
  - `ai.price_predictions|predicted_price|numeric` ai.price_predictions|predicted_price|numeric
- **`ai.price_predictions|confidence_score|numeric`**:
  - `ai.price_predictions|confidence_score|numeric` ai.price_predictions|confidence_score|numeric
- **`ai.price_predictions|input_features|jsonb`**:
  - `ai.price_predictions|input_features|jsonb` ai.price_predictions|input_features|jsonb
- **`ai.price_predictions|actual_price|numeric`**:
  - `ai.price_predictions|actual_price|numeric` ai.price_predictions|actual_price|numeric
- **`ai.price_predictions|prediction_date|timestamp with time zone`**:
  - `ai.price_predictions|prediction_date|timestamp with time zone` ai.price_predictions|prediction_date|timestamp with time zone
- **`ai.price_predictions|created_at|timestamp with time zone`**:
  - `ai.price_predictions|created_at|timestamp with time zone` ai.price_predictions|created_at|timestamp with time zone
- **`ai.record_embeddings|id|uuid`**:
  - `ai.record_embeddings|id|uuid` ai.record_embeddings|id|uuid
- **`ai.record_embeddings|record_id|uuid`**:
  - `ai.record_embeddings|record_id|uuid` ai.record_embeddings|record_id|uuid
- **`ai.record_embeddings|model_id|uuid`**:
  - `ai.record_embeddings|model_id|uuid` ai.record_embeddings|model_id|uuid
- **`ai.record_embeddings|embedding_data|bytea`**:
  - `ai.record_embeddings|embedding_data|bytea` ai.record_embeddings|embedding_data|bytea
- **`ai.record_embeddings|created_at|timestamp with time zone`**:
  - `ai.record_embeddings|created_at|timestamp with time zone` ai.record_embeddings|created_at|timestamp with time zone
- **`ai.training_data|id|uuid`**:
  - `ai.training_data|id|uuid` ai.training_data|id|uuid
- **`ai.training_data|record_id|uuid`**:
  - `ai.training_data|record_id|uuid` ai.training_data|record_id|uuid
- **`ai.training_data|features|jsonb`**:
  - `ai.training_data|features|jsonb` ai.training_data|features|jsonb
- **`ai.training_data|target_value|numeric`**:
  - `ai.training_data|target_value|numeric` ai.training_data|target_value|numeric
- **`ai.training_data|data_source|text`**:
  - `ai.training_data|data_source|text` ai.training_data|data_source|text
- **`ai.training_data|quality_score|numeric`**:
  - `ai.training_data|quality_score|numeric` ai.training_data|quality_score|numeric
- **`ai.training_data|used_in_training|boolean`**:
  - `ai.training_data|used_in_training|boolean` ai.training_data|used_in_training|boolean
- **`ai.training_data|training_run_id|uuid`**:
  - `ai.training_data|training_run_id|uuid` ai.training_data|training_run_id|uuid
- **`ai.training_data|created_at|timestamp with time zone`**:
  - `ai.training_data|created_at|timestamp with time zone` ai.training_data|created_at|timestamp with time zone
- **`ai.training_runs|id|uuid`**:
  - `ai.training_runs|id|uuid` ai.training_runs|id|uuid
- **`ai.training_runs|model_id|uuid`**:
  - `ai.training_runs|model_id|uuid` ai.training_runs|model_id|uuid
- **`ai.training_runs|training_started_at|timestamp with time zone`**:
  - `ai.training_runs|training_started_at|timestamp with time zone` ai.training_runs|training_started_at|timestamp with time zone
- **`ai.training_runs|training_completed_at|timestamp with time zone`**:
  - `ai.training_runs|training_completed_at|timestamp with time zone` ai.training_runs|training_completed_at|timestamp with time zone
- **`ai.training_runs|status|text`**:
  - `ai.training_runs|status|text` ai.training_runs|status|text
- **`ai.training_runs|training_metrics|jsonb`**:
  - `ai.training_runs|training_metrics|jsonb` ai.training_runs|training_metrics|jsonb
- **`ai.training_runs|error_message|text`**:
  - `ai.training_runs|error_message|text` ai.training_runs|error_message|text
- **`ai.training_runs|created_at|timestamp with time zone`**:
  - `ai.training_runs|created_at|timestamp with time zone` ai.training_runs|created_at|timestamp with time zone

---
If every DB shows "(no user tables)", apply schemas: `PGPASSWORD=postgres ./scripts/apply-external-db-schemas.sh`. See **docs/WHY_NO_USER_TABLES_AND_HOW_TO_FIX.md**.

