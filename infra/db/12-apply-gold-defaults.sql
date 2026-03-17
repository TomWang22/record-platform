-- Apply gold performance defaults per database (run once per DB).
-- Instance-level tuning (work_mem=32MB, enable_seqscan=off, jit=off, max_parallel_workers=12/4, etc.)
-- is applied at container start via docker-compose. This file sets per-DB options so hot paths
-- and hashing stay cache-friendly and match RESTORE-GOLD-PERFORMANCE.
-- Run: scripts/apply-gold-tuning-all-dbs.sh (or manually per port/db).

SET ROLE postgres;

-- Per-database settings (gold: pg_trgm.similarity_threshold=0.40 for fuzzy search)
DO $$
DECLARE
  db text := current_database();
  has_trgm boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') INTO has_trgm;
  IF has_trgm THEN
    EXECUTE format('ALTER DATABASE %I SET pg_trgm.similarity_threshold = 0.40', db);
    RAISE NOTICE 'Set pg_trgm.similarity_threshold = 0.40 for %', db;
  END IF;
END $$;

-- Reinforce planner defaults at database level (sub-20ms: index-first, tuple costs, parallel 12/4)
DO $$
DECLARE
  db text := current_database();
BEGIN
  EXECUTE format('ALTER DATABASE %I SET random_page_cost = 0.8', db);  -- SSD aggressive
  EXECUTE format('ALTER DATABASE %I SET effective_cache_size = %L', db, '4GB');
  EXECUTE format('ALTER DATABASE %I SET work_mem = %L', db, '32MB');
  EXECUTE format('ALTER DATABASE %I SET jit = off', db);
  EXECUTE format('ALTER DATABASE %I SET enable_seqscan = off', db);
  EXECUTE format('ALTER DATABASE %I SET max_parallel_workers_per_gather = 4', db);
  EXECUTE format('ALTER DATABASE %I SET max_parallel_workers = 12', db);
  EXECUTE format('ALTER DATABASE %I SET cpu_index_tuple_cost = 0.0005', db);  -- prefer index scans
  EXECUTE format('ALTER DATABASE %I SET cpu_tuple_cost = 0.01', db);
  EXECUTE format('ALTER DATABASE %I SET parallel_tuple_cost = 0.1', db);
  EXECUTE format('ALTER DATABASE %I SET parallel_setup_cost = 1000', db);
  EXECUTE format('ALTER DATABASE %I SET default_statistics_target = 100', db);
  EXECUTE format('ALTER DATABASE %I SET effective_io_concurrency = 200', db);
  -- Cold tuning: allow parallel plans on smaller tables (default 8MB)
  EXECUTE format('ALTER DATABASE %I SET min_parallel_table_scan_size = %L', db, '0');
  EXECUTE format('ALTER DATABASE %I SET min_parallel_index_scan_size = %L', db, '0');
  RAISE NOTICE 'Gold planner defaults (sub-20ms, cold 1.5k-5k+ TPS) applied for %', db;
END $$;

SELECT 'Gold defaults applied for database: ' || current_database() AS status;
