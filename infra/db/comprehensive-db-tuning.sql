-- Comprehensive Database Tuning
-- Target: 1.5k–5.1k TPS (gold: 6–8k TPS); hot tenants, hashing, cache-friendly.
-- Instance-level gold tuning is applied at container start via docker-compose.
-- This file adds indexes and optional ALTER SYSTEM overrides (restart required).
-- See scripts/RESTORE-GOLD-PERFORMANCE.md.gz and scripts/apply-gold-tuning-all-dbs.sh.

SET ROLE postgres;

-- ============================================================
-- POSTGRESQL CONFIGURATION (Gold: Worker 12/4, Memory, Index-First)
-- ============================================================

-- Worker threads (gold: 4 and 12)
ALTER SYSTEM SET max_parallel_workers_per_gather = 4;
ALTER SYSTEM SET max_worker_processes = 12;
ALTER SYSTEM SET max_parallel_workers = 12;

-- Memory (gold: work_mem 32MB, effective_cache_size 4GB; keep hot data in buffer)
ALTER SYSTEM SET work_mem = '32MB';
ALTER SYSTEM SET maintenance_work_mem = '256MB';
ALTER SYSTEM SET shared_buffers = '1GB';
ALTER SYSTEM SET effective_cache_size = '4GB';
ALTER SYSTEM SET temp_buffers = '8MB';
ALTER SYSTEM SET effective_io_concurrency = 200;

-- Write-ahead log (WAL) settings
ALTER SYSTEM SET wal_buffers = '16MB';  -- WAL buffer size
ALTER SYSTEM SET checkpoint_completion_target = 0.9;  -- Spread checkpoint writes over 90% of interval
ALTER SYSTEM SET max_wal_size = '2GB';  -- Max WAL size before checkpoint

-- Connection and stats (keep 500 for platform; gold uses default_statistics_target 100)
ALTER SYSTEM SET default_statistics_target = 100;

-- ============================================================
-- QUERY PLANNER SETTINGS (Disable Sequential Scans, Prefer Indexes)
-- ============================================================

-- Disable sequential scans (force index usage)
ALTER SYSTEM SET enable_seqscan = off;  -- CRITICAL: Force index scans
ALTER SYSTEM SET enable_indexscan = on;  -- Enable index scans
ALTER SYSTEM SET enable_bitmapscan = on;  -- Enable bitmap index scans
ALTER SYSTEM SET enable_indexonlyscan = on;  -- Enable index-only scans

-- Planner cost settings (prefer indexes over sequential scans)
ALTER SYSTEM SET random_page_cost = 0.8;  -- Lower for SSD (default 4.0, 1.1 for SSD, 0.8 aggressive)
ALTER SYSTEM SET cpu_index_tuple_cost = 0.0005;  -- Lower to prefer index scans (default 0.005)
ALTER SYSTEM SET cpu_tuple_cost = 0.01;  -- Keep default
ALTER SYSTEM SET seq_page_cost = 1.0;  -- Default (sequential page read cost)

-- Parallel query settings
ALTER SYSTEM SET parallel_tuple_cost = 0.1;  -- Lower to prefer parallel queries
ALTER SYSTEM SET parallel_setup_cost = 1000.0;  -- Cost to start parallel worker

-- ============================================================
-- AUTOVACUUM TUNING (Critical for Write-Heavy, 2.4M+ Records)
-- ============================================================

ALTER SYSTEM SET autovacuum = on;
ALTER SYSTEM SET autovacuum_max_workers = 4;  -- Parallel autovacuum workers
ALTER SYSTEM SET autovacuum_naptime = '10s';  -- Time between autovacuum runs
ALTER SYSTEM SET autovacuum_vacuum_threshold = 50;  -- Min changes to trigger vacuum
ALTER SYSTEM SET autovacuum_analyze_threshold = 50;  -- Min changes to trigger analyze

-- Per-table autovacuum settings (applied below)
-- records.records: scale_factor 0.02/0.05 (very aggressive for large table)
-- listings.listings: scale_factor 0.1/0.05 (write-heavy)
-- shopping tables: scale_factor 0.1/0.05 (write-heavy)

-- ============================================================
-- RECORDS SERVICE - COMPREHENSIVE INDEXING (Port 5433)
-- ============================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;  -- Query performance monitoring

-- 1. PARTIAL INDEXES (Hot Tenant, Active Records, Recent Records)

-- Hot tenant partial indexes (primary user - most queries)
CREATE INDEX IF NOT EXISTS idx_records_hot_user_id 
  ON records.records (user_id, updated_at DESC) 
  WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;

CREATE INDEX IF NOT EXISTS idx_records_hot_artist_name 
  ON records.records (user_id, artist, name) 
  WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;

-- Recent records partial index (most accessed data)
CREATE INDEX IF NOT EXISTS idx_records_recent_updated 
  ON records.records (user_id, updated_at DESC) 
  WHERE updated_at > NOW() - INTERVAL '90 days';

-- Active records partial index (non-deleted)
CREATE INDEX IF NOT EXISTS idx_records_active_user 
  ON records.records (user_id, created_at DESC) 
  WHERE created_at > NOW() - INTERVAL '1 year';

-- 2. COMPOSITE INDEXES (Multi-column queries)

-- User + Artist + Name (most common search pattern)
CREATE INDEX IF NOT EXISTS idx_records_user_artist_name 
  ON records.records (user_id, artist, name, format);

-- User + Catalog + Format (catalog lookups)
CREATE INDEX IF NOT EXISTS idx_records_user_catalog_format 
  ON records.records (user_id, catalog_number, format) 
  WHERE catalog_number IS NOT NULL;

-- User + Release Year + Label (browsing by year/label)
CREATE INDEX IF NOT EXISTS idx_records_user_year_label 
  ON records.records (user_id, release_year, label, name) 
  WHERE release_year IS NOT NULL AND label IS NOT NULL;

-- User + Price + Purchased Date (price/financial queries)
CREATE INDEX IF NOT EXISTS idx_records_user_price_purchased 
  ON records.records (user_id, price_paid, purchased_at DESC) 
  WHERE price_paid IS NOT NULL;

-- 3. TRIGRAM INDEXES (Fuzzy Search - GIN)

CREATE INDEX IF NOT EXISTS idx_records_artist_trgm 
  ON records.records USING gin (artist gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_records_name_trgm 
  ON records.records USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_records_catalog_trgm 
  ON records.records USING gin (catalog_number gin_trgm_ops) 
  WHERE catalog_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_records_label_trgm 
  ON records.records USING gin (label gin_trgm_ops) 
  WHERE label IS NOT NULL;

-- Search normalization indexes (comprehensive search)
CREATE INDEX IF NOT EXISTS idx_records_search_norm_gin 
  ON records.records USING gin (search_norm gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_records_search_norm_gist 
  ON records.records USING gist (search_norm gist_trgm_ops);

-- Hot tenant trigram indexes (partial for primary user)
CREATE INDEX IF NOT EXISTS idx_records_hot_search_norm_gin 
  ON records.records USING gin (search_norm gin_trgm_ops) 
  WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;

-- 4. FULL-TEXT SEARCH INDEXES (tsvector)

DO $$
BEGIN
  -- Only create if search_tsv column exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema='records' AND table_name='records' AND column_name='search_tsv'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_records_search_tsv_all 
      ON records.records USING gin (search_tsv);
    
    CREATE INDEX IF NOT EXISTS idx_records_hot_search_tsv 
      ON records.records USING gin (search_tsv) 
      WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;
  END IF;
END $$;

-- 5. COVERING INDEXES (Index-Only Scans - include frequently selected columns)

CREATE INDEX IF NOT EXISTS idx_records_user_artist_covering 
  ON records.records (user_id, artist, name) 
  INCLUDE (format, catalog_number, record_grade, sleeve_grade);

CREATE INDEX IF NOT EXISTS idx_records_user_updated_covering 
  ON records.records (user_id, updated_at DESC) 
  INCLUDE (artist, name, format, catalog_number);

-- 6. FUNCTIONAL INDEXES (for normalized text searches)

CREATE INDEX IF NOT EXISTS idx_records_artist_norm_gin 
  ON records.records USING gin (artist_norm gin_trgm_ops) 
  WHERE artist_norm IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_records_name_norm_gin 
  ON records.records USING gin (name_norm gin_trgm_ops) 
  WHERE name_norm IS NOT NULL;

-- 7. AUTOVACUUM TUNING (Per-table - Read/Write Heavy Workload)

ALTER TABLE records.records SET (
  autovacuum_vacuum_scale_factor = 0.05,  -- Balanced for read/write heavy (5% change triggers vacuum)
  autovacuum_analyze_scale_factor = 0.05,  -- 5% change triggers analyze (keeps stats fresh for queries)
  autovacuum_vacuum_cost_delay = 0,  -- No delay (aggressive for write-heavy component)
  autovacuum_vacuum_cost_limit = 200  -- Higher limit for faster vacuum (handle 2.4M+ records)
);

-- ============================================================
-- LISTINGS SERVICE - INDEXING (Port 5435)
-- ============================================================

-- Partial indexes
CREATE INDEX IF NOT EXISTS idx_listings_active_user 
  ON listings.listings (user_id, created_at DESC) 
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_listings_active_category 
  ON listings.listings (category, price) 
  WHERE is_active = true AND category IS NOT NULL;

-- Composite indexes
CREATE INDEX IF NOT EXISTS idx_listings_user_type_category 
  ON listings.listings (user_id, listing_type, category, price);

CREATE INDEX IF NOT EXISTS idx_listings_active_price 
  ON listings.listings (is_active, listing_type, price, created_at DESC) 
  WHERE is_active = true;

-- Trigram indexes
CREATE INDEX IF NOT EXISTS idx_listings_title_trgm 
  ON listings.listings USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_search_q_trgm 
  ON listings.search_history USING gin (q gin_trgm_ops);

-- Autovacuum tuning
ALTER TABLE listings.listings SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_scale_factor = 0.05
);

-- ============================================================
-- SHOPPING SERVICE - INDEXING (Port 5436)
-- ============================================================

-- Composite indexes for cart operations
CREATE INDEX IF NOT EXISTS idx_cart_user_item 
  ON shopping.shopping_cart (user_id, item_type, item_id);

CREATE INDEX IF NOT EXISTS idx_cart_user_updated 
  ON shopping.shopping_cart (user_id, updated_at DESC);

-- Partial index for active carts
CREATE INDEX IF NOT EXISTS idx_cart_active_user 
  ON shopping.shopping_cart (user_id, created_at DESC) 
  WHERE updated_at > NOW() - INTERVAL '30 days';

-- Orders composite indexes
CREATE INDEX IF NOT EXISTS idx_orders_user_status 
  ON shopping.orders (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_user_payment 
  ON shopping.orders (user_id, payment_status, completed_at DESC);

-- Purchase history indexes
CREATE INDEX IF NOT EXISTS idx_purchases_user_resellable 
  ON shopping.purchase_history (user_id, resellable) 
  WHERE resellable = true;

CREATE INDEX IF NOT EXISTS idx_purchases_user_purchased 
  ON shopping.purchase_history (user_id, purchased_at DESC);

-- Autovacuum tuning
ALTER TABLE shopping.shopping_cart SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_scale_factor = 0.05
);

ALTER TABLE shopping.orders SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_scale_factor = 0.05
);

ALTER TABLE shopping.purchase_history SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_scale_factor = 0.05
);

-- ============================================================
-- STATISTICS UPDATE (Critical for Query Planner)
-- ============================================================

ANALYZE records.records;
ANALYZE listings.listings;
ANALYZE listings.auction_details;
ANALYZE listings.search_history;
ANALYZE shopping.shopping_cart;
ANALYZE shopping.orders;
ANALYZE shopping.purchase_history;

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

-- Check indexes created
SELECT 
  schemaname, tablename, indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes
WHERE schemaname IN ('records', 'listings', 'shopping')
  AND tablename IN ('records', 'listings', 'shopping_cart', 'orders', 'purchase_history')
ORDER BY schemaname, tablename, indexname;

-- Check planner settings
SHOW enable_seqscan;  -- Should be OFF
SHOW enable_indexscan;  -- Should be ON
SHOW random_page_cost;
SHOW max_parallel_workers_per_gather;
SHOW max_worker_processes;
SHOW work_mem;

SELECT 'Tuning complete. Restart PostgreSQL to apply ALTER SYSTEM changes.' as status;
