-- Optimize PostgreSQL planner for better index usage and TRGM performance
-- Run this after data loads and before benchmarks

SET ROLE postgres;

-- 1. Aggressive planner tuning for SSD (lower costs to prefer indexes)
ALTER SYSTEM SET random_page_cost = 0.8;  -- Lower for SSD (was 1.2)
ALTER SYSTEM SET cpu_index_tuple_cost = 0.0005;  -- Lower to prefer index scans (default 0.005)
ALTER SYSTEM SET cpu_tuple_cost = 0.01;  -- Keep default
ALTER SYSTEM SET effective_cache_size = '8GB';  -- Adjust based on available RAM

-- 2. Memory settings (if not already set in deployment)
-- These should be in deployment args, but ensure they're correct:
-- shared_buffers = 512MB (or higher if you have RAM)
-- work_mem = 16MB (or higher for complex queries)

-- 3. Force VACUUM ANALYZE on partitioned table
VACUUM ANALYZE records.records;

-- 4. Analyze all partitions
DO $$
DECLARE
  part_name text;
BEGIN
  FOR part_name IN 
    SELECT relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'records' 
      AND c.relname LIKE 'records_p%'
      AND c.relkind = 'r'
    ORDER BY relname
  LOOP
    EXECUTE format('ANALYZE records.%I', part_name);
    RAISE NOTICE 'Analyzed: %', part_name;
  END LOOP;
END $$;

-- 5. Verify indexes exist and are being used
SELECT 
  schemaname, tablename, indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
  idx_scan as times_used,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE schemaname = 'records' 
  AND tablename = 'records'
  AND (indexname LIKE '%trgm%' OR indexname LIKE '%search_norm%' OR indexname LIKE '%hot%')
ORDER BY indexname;

-- 6. Check table statistics
SELECT 
  schemaname, relname,
  last_vacuum, last_analyze, last_autoanalyze,
  n_live_tup, n_dead_tup,
  CASE WHEN n_live_tup > 0 
    THEN ROUND(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 2)
    ELSE 0 
  END as dead_pct
FROM pg_stat_user_tables
WHERE schemaname = 'records' AND relname = 'records';

SELECT 'Optimization complete. Restart Postgres to apply ALTER SYSTEM changes.' as status;

