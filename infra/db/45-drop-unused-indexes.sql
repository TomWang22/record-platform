-- Report: unused indexes (idx_scan = 0) for all user schemas.
-- Safe to run on any DB. Excludes primary key and unique constraint indexes.
-- Use output to decide which indexes to drop (reduce shared_buffers and planning cost).
-- Critical indexes (*_bench, search_tsv, user_id btree) must never be dropped on records.

\echo '=== Unused indexes (idx_scan = 0; exclude PK/unique) ==='
SELECT
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes s
JOIN pg_index i ON i.indexrelid = s.indexrelid
WHERE idx_scan = 0
  AND NOT indisprimary
  AND NOT indisunique
  AND schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY schemaname, tablename, pg_relation_size(s.indexrelid) DESC;

\echo ''
\echo '=== Index usage summary (all user indexes, by scans) ==='
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY schemaname, tablename, idx_scan ASC, pg_relation_size(indexrelid) DESC;
