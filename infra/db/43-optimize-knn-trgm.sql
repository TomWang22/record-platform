-- Optimize KNN and TRGM performance
-- Run after partition migration and VACUUM ANALYZE

-- 1. Ensure all indexes exist on partitioned table
\echo '-> Ensuring KNN indexes exist'

CREATE INDEX IF NOT EXISTS idx_records_search_norm_gist
  ON records.records USING gist (search_norm gist_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_records_search_norm_gin
  ON records.records USING gin (search_norm gin_trgm_ops);

-- 2. Hot tenant partial indexes (for primary tenant)
\echo '-> Creating hot tenant partial indexes'

CREATE INDEX IF NOT EXISTS records_hot_knn_main
  ON records.records USING gist (search_norm gist_trgm_ops)
  WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;

CREATE INDEX IF NOT EXISTS records_hot_gin_main
  ON records.records USING gin (search_norm gin_trgm_ops)
  WITH (fastupdate=off)
  WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;

-- 3. TRGM indexes for substring search (optimize for tail latency)
\echo '-> Optimizing TRGM indexes'

-- Ensure these exist (they should from initial setup)
CREATE INDEX IF NOT EXISTS idx_records_artist_trgm 
  ON records.records USING gin (artist gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_records_name_trgm
  ON records.records USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_records_catalog_trgm
  ON records.records USING gin (catalog_number gin_trgm_ops);

-- 4. Composite index for TRGM queries (user_id + ILIKE pattern)
-- This helps with partition pruning + index scan
CREATE INDEX IF NOT EXISTS idx_records_user_artist_trgm
  ON records.records USING gin (user_id, artist gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_records_user_name_trgm
  ON records.records USING gin (user_id, name gin_trgm_ops);

-- 5. Update statistics for better query planning
\echo '-> Updating statistics'

ANALYZE records.records;

-- Analyze all partitions
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

-- 6. Set work_mem higher for KNN queries (session-level, not persistent)
-- This helps with GiST index scans
\echo '-> Optimization complete'

-- Verify indexes
SELECT 
  schemaname, tablename, indexname,
  pg_size_pretty(pg_relation_size((schemaname||'.'||indexname)::regclass)) as size
FROM pg_indexes
WHERE schemaname = 'records' 
  AND tablename = 'records'
  AND (indexname LIKE '%search_norm%' OR indexname LIKE '%trgm%' OR indexname LIKE '%hot%')
ORDER BY indexname;

