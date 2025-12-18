-- Optimize Listings Database for Write-Heavy Workloads
-- Run on postgres-listings-1 (port 5435)

SET ROLE postgres;

-- ============================================================
-- FIX WATCHLIST SCHEMA (Add Unique Constraint)
-- ============================================================

-- Add unique constraint for ON CONFLICT to work
DO $$ 
BEGIN
  -- Check if constraint already exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'unique_user_source_query' 
    AND conrelid = 'listings.watchlist'::regclass
  ) THEN
    ALTER TABLE listings.watchlist 
    ADD CONSTRAINT unique_user_source_query 
    UNIQUE (user_id, source, query);
    RAISE NOTICE 'Added unique constraint to watchlist table';
  ELSE
    RAISE NOTICE 'Unique constraint already exists on watchlist table';
  END IF;
END $$;

-- ============================================================
-- OPTIMIZE INDEXES FOR WRITE PERFORMANCE
-- ============================================================

-- Create partial index for active auctions (write optimization)
CREATE INDEX IF NOT EXISTS idx_auctions_active 
ON listings.auctions(ends_at) 
WHERE ends_at > NOW();

-- Create covering index for search queries (read optimization)
CREATE INDEX IF NOT EXISTS idx_auctions_search_covering 
ON listings.auctions(source, item_id, title, price, currency, ends_at) 
INCLUDE (url, fetched_at);

-- Optimize watchlist queries with composite index
CREATE INDEX IF NOT EXISTS idx_watchlist_user_created 
ON listings.watchlist(user_id, created_at DESC);

-- ============================================================
-- TRIGRAM OPTIMIZATION FOR TEXT SEARCH
-- ============================================================

-- Ensure pg_trgm extension is enabled
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create trigram indexes for fast text search (if not exists)
DO $$
BEGIN
  -- Title search index
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'idx_auctions_title_trgm'
  ) THEN
    CREATE INDEX idx_auctions_title_trgm 
    ON listings.auctions USING gin(title gin_trgm_ops);
    RAISE NOTICE 'Created trigram index on auctions.title';
  END IF;
  
  -- Search history query index (if table exists)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'listings' AND table_name = 'search_history') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes 
      WHERE indexname = 'idx_search_q_trgm'
    ) THEN
      CREATE INDEX idx_search_q_trgm 
      ON listings.search_history USING gin(q gin_trgm_ops);
      RAISE NOTICE 'Created trigram index on search_history.q';
    END IF;
  END IF;
END $$;

-- ============================================================
-- PARTITIONING FOR LARGE TABLES (Optional, for future scaling)
-- ============================================================

-- Consider partitioning auctions table by date if it grows very large
-- This is commented out as it requires more planning
-- CREATE TABLE listings.auctions_partitioned (
--   LIKE listings.auctions INCLUDING ALL
-- ) PARTITION BY RANGE (fetched_at);

-- ============================================================
-- VACUUM AND ANALYZE OPTIMIZATION
-- ============================================================

-- Update statistics for better query planning
ANALYZE listings.auctions;
ANALYZE listings.watchlist;
ANALYZE listings.search_history;

-- ============================================================
-- CONNECTION POOLING HINTS
-- ============================================================

-- Note: Connection pooling should be configured at application level
-- Recommended settings for write-heavy workloads:
-- - max_connections: 200-500 (depending on load)
-- - shared_buffers: 25% of RAM
-- - effective_cache_size: 50-75% of RAM
-- - work_mem: 4-16MB per connection
-- - maintenance_work_mem: 1-2GB
-- - checkpoint_completion_target: 0.9
-- - wal_buffers: 16MB
-- - random_page_cost: 1.1 (for SSD)
-- - effective_io_concurrency: 200 (for SSD)

-- ============================================================
-- MONITORING QUERIES
-- ============================================================

-- Enable pg_stat_statements for query monitoring (if extension exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') THEN
    -- Reset statistics (optional, for fresh start)
    -- PERFORM pg_stat_statements_reset();
    RAISE NOTICE 'pg_stat_statements is enabled - use it to monitor slow queries';
  ELSE
    RAISE NOTICE 'pg_stat_statements not enabled - consider enabling for query monitoring';
  END IF;
END $$;

-- ============================================================
-- GRANTS
-- ============================================================

-- Ensure proper permissions
GRANT ALL PRIVILEGES ON SCHEMA listings TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA listings TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA listings TO postgres;

