-- Data summary: per-schema, per-table row counts and sizes (transparent for tuning/pgbench).
-- Run per DB to see "how much data" before EXPLAIN/pgbench. Target: 7-8 figure scale (millions+).
-- Usage: psql -h ... -p PORT -U postgres -d DB -f 31-data-summary.sql

\echo '=== DATA SUMMARY (schema | table | approx rows | total size) ==='
SELECT
  n.nspname AS schema,
  c.relname AS table_name,
  COALESCE((c.reltuples)::bigint, 0) AS approx_rows,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND c.relkind = 'r'
ORDER BY n.nspname, pg_total_relation_size(c.oid) DESC;

\echo ''
\echo '=== LIVE ROW ESTIMATES (pg_stat_user_tables; run ANALYZE first) ==='
SELECT
  schemaname AS schema,
  relname AS table_name,
  n_live_tup AS live_tup,
  n_dead_tup AS dead_tup,
  pg_size_pretty(pg_total_relation_size((quote_ident(schemaname)||'.'||quote_ident(relname))::regclass)) AS size
FROM pg_stat_user_tables
ORDER BY schemaname, n_live_tup DESC;

\echo ''
\echo '=== TOTAL DATA PER SCHEMA ==='
SELECT
  n.nspname AS schema,
  COUNT(*) AS table_count,
  SUM(COALESCE((c.reltuples)::bigint, 0)) AS approx_total_rows,
  pg_size_pretty(SUM(pg_total_relation_size(c.oid))) AS total_size
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND c.relkind = 'r'
GROUP BY n.nspname
ORDER BY SUM(pg_total_relation_size(c.oid)) DESC;
