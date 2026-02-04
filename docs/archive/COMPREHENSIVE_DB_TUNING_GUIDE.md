# Comprehensive Database Tuning Guide

## Target Performance
- **Records Service**: 5.1k TPS with 2.4M+ records
- **pgbench Clients**: Up to 256 concurrent clients
- **Query Time Reduction**: 10+ seconds overall improvement
- **Cluster**: Single cluster with oversubscription (aggressive tuning)

## Tuning Strategy

### 1. Partial Indexes (Hot Tenant, Recent Data)

**Purpose**: Index only frequently accessed data subsets

**Records Service**:
```sql
-- Hot tenant (primary user - most queries)
CREATE INDEX idx_records_hot_user_id ON records.records (user_id, updated_at DESC) 
  WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;

-- Recent records (last 90 days - most accessed)
CREATE INDEX idx_records_recent_updated ON records.records (user_id, updated_at DESC) 
  WHERE updated_at > NOW() - INTERVAL '90 days';

-- Active records (last year)
CREATE INDEX idx_records_active_user ON records.records (user_id, created_at DESC) 
  WHERE created_at > NOW() - INTERVAL '1 year';
```

**Benefits**: 
- Smaller index size (only index active/recent data)
- Faster index scans (less data to scan)
- Better cache utilization

### 2. Composite Indexes (Multi-Column Queries)

**Purpose**: Optimize multi-column WHERE/ORDER BY patterns

**Records Service**:
```sql
-- User + Artist + Name (most common search)
CREATE INDEX idx_records_user_artist_name 
  ON records.records (user_id, artist, name, format);

-- User + Catalog + Format (catalog lookups)
CREATE INDEX idx_records_user_catalog_format 
  ON records.records (user_id, catalog_number, format) 
  WHERE catalog_number IS NOT NULL;

-- User + Release Year + Label (browsing)
CREATE INDEX idx_records_user_year_label 
  ON records.records (user_id, release_year, label, name) 
  WHERE release_year IS NOT NULL AND label IS NOT NULL;
```

**Benefits**:
- Single index covers multi-column queries
- Eliminates need for bitmap index scans
- Faster ORDER BY on indexed columns

### 3. Worker Threads & Memory (4 and 12)

**PostgreSQL Configuration**:
```sql
ALTER SYSTEM SET max_parallel_workers_per_gather = 4;  -- 4 parallel workers per query
ALTER SYSTEM SET max_worker_processes = 12;  -- 12 total background workers
ALTER SYSTEM SET max_parallel_workers = 12;  -- 12 max parallel workers

-- Memory settings (critical for 2.4M+ records, 256 clients)
ALTER SYSTEM SET work_mem = '16MB';  -- Per sort/hash operation
ALTER SYSTEM SET maintenance_work_mem = '1GB';  -- For VACUUM, CREATE INDEX
ALTER SYSTEM SET shared_buffers = '2GB';  -- Shared cache (25% RAM)
ALTER SYSTEM SET effective_cache_size = '6GB';  -- OS cache estimate (50-75% RAM)
```

**Rationale**:
- 4 workers per gather: Optimal for parallel queries (SSD I/O)
- 12 total workers: Supports multiple parallel queries (256 clients)
- 16MB work_mem: Handles complex sorts/joins (increase if needed)
- 1GB maintenance_work_mem: Fast VACUUM/INDEX for 2.4M records

### 4. Disable Sequential Scans (Force Index Usage)

**Critical Settings**:
```sql
ALTER SYSTEM SET enable_seqscan = off;  -- DISABLE sequential scans
ALTER SYSTEM SET enable_indexscan = on;  -- Enable index scans
ALTER SYSTEM SET enable_bitmapscan = on;  -- Enable bitmap scans
ALTER SYSTEM SET enable_indexonlyscan = on;  -- Enable index-only scans

-- Planner cost tuning (prefer indexes)
ALTER SYSTEM SET random_page_cost = 0.8;  -- Low for SSD (default 4.0)
ALTER SYSTEM SET cpu_index_tuple_cost = 0.0005;  -- Lower to prefer indexes
```

**Warning**: 
- `enable_seqscan = off` forces index usage
- Only enable after **all indexes are created**
- Query planner may error if no index exists (will fail gracefully)
- **Always create indexes before disabling seqscan**

### 5. Trigram Indexes (Fuzzy Search)

**GIN Indexes for Text Search**:
```sql
CREATE INDEX idx_records_artist_trgm ON records.records USING gin (artist gin_trgm_ops);
CREATE INDEX idx_records_name_trgm ON records.records USING gin (name gin_trgm_ops);
CREATE INDEX idx_records_catalog_trgm ON records.records USING gin (catalog_number gin_trgm_ops);
CREATE INDEX idx_records_search_norm_gin ON records.records USING gin (search_norm gin_trgm_ops);
```

**Benefits**:
- Fast fuzzy/text search (5-10x faster)
- Supports ILIKE '%pattern%' queries
- GIN indexes are optimized for text search

### 6. Covering Indexes (Index-Only Scans)

**Include Frequently Selected Columns**:
```sql
CREATE INDEX idx_records_user_artist_covering 
  ON records.records (user_id, artist, name) 
  INCLUDE (format, catalog_number, record_grade, sleeve_grade);
```

**Benefits**:
- Index-only scans (no table access)
- Faster queries (data in index)
- Reduced I/O for SELECT queries

### 7. Autovacuum Tuning (Write-Heavy Workloads)

**Records Service** (2.4M records):
```sql
ALTER TABLE records.records SET (
  autovacuum_vacuum_scale_factor = 0.02,  -- 2% change triggers vacuum (aggressive)
  autovacuum_analyze_scale_factor = 0.05,  -- 5% change triggers analyze
  autovacuum_vacuum_cost_delay = 0,  -- No delay
  autovacuum_vacuum_cost_limit = 200  -- Higher limit
);
```

**Rationale**:
- Large tables need aggressive autovacuum
- Prevents bloat (critical for 2.4M+ records)
- Keeps statistics fresh (better query plans)

### 8. Query Planner Optimization

**Settings for Index Preference**:
```sql
ALTER SYSTEM SET random_page_cost = 0.8;  -- SSD optimization
ALTER SYSTEM SET cpu_index_tuple_cost = 0.0005;  -- Prefer index scans
ALTER SYSTEM SET effective_cache_size = '6GB';  -- Better cache estimates
```

**Impact**:
- Planner chooses indexes over sequential scans
- Better estimates for parallel queries
- Optimal for SSD storage

## Execution Order

1. **Restore SQL Backups** (schema + data)
   ```bash
   ./scripts/restore-and-tune-all-databases.sh
   ```

2. **Apply Comprehensive Tuning** (indexes + config)
   ```bash
   # Run comprehensive tuning SQL
   PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d records \
     -f infra/db/comprehensive-db-tuning.sql
   ```

3. **Restart PostgreSQL** (apply ALTER SYSTEM changes)
   ```bash
   # Restart required for ALTER SYSTEM settings
   kubectl -n record-platform rollout restart statefulset/postgres
   ```

4. **Verify Tuning**:
   ```sql
   SHOW enable_seqscan;  -- Should be OFF
   SHOW max_parallel_workers_per_gather;  -- Should be 4
   SHOW max_worker_processes;  -- Should be 12
   SHOW work_mem;  -- Should be 16MB
   
   -- Check indexes
   SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'records';
   ```

5. **Run pgbench** (validate 5.1k TPS):
   ```bash
   pgbench -h localhost -p 5433 -U postgres -d records -c 256 -j 12 -T 300
   ```

## Performance Validation

### Query Plan Verification

**Ensure Index Usage**:
```sql
EXPLAIN (ANALYZE, BUFFERS) 
SELECT * FROM records.records 
WHERE user_id = '...' AND artist ILIKE '%pattern%';
```

**Check for**:
- ✅ `Index Scan` or `Bitmap Index Scan` (NOT Seq Scan)
- ✅ `Index Only Scan` (for covering indexes)
- ✅ Parallel workers used (for large queries)

### Index Usage Statistics

```sql
SELECT 
  schemaname, tablename, indexname,
  idx_scan as times_used,
  idx_tup_read as tuples_read
FROM pg_stat_user_indexes
WHERE schemaname = 'records' AND tablename = 'records'
ORDER BY idx_scan DESC;
```

### Table Statistics

```sql
SELECT 
  schemaname, relname,
  last_vacuum, last_analyze,
  n_live_tup, n_dead_tup
FROM pg_stat_user_tables
WHERE schemaname = 'records' AND relname = 'records';
```

## Troubleshooting

### If Queries Fail After `enable_seqscan = off`:

1. Check if index exists:
   ```sql
   SELECT indexname FROM pg_indexes WHERE tablename = 'records';
   ```

2. Create missing indexes:
   ```sql
   -- Re-run comprehensive-db-tuning.sql
   ```

3. Temporarily enable seqscan if needed:
   ```sql
   SET enable_seqscan = on;  -- Per-session only
   ```

### If Performance Doesn't Improve:

1. Verify indexes are used:
   ```sql
   EXPLAIN ANALYZE <your-query>;
   ```

2. Check statistics freshness:
   ```sql
   SELECT last_analyze FROM pg_stat_user_tables WHERE relname = 'records';
   ```

3. Update statistics:
   ```sql
   ANALYZE records.records;
   ```

### If pgbench TPS is Low:

1. Check parallel workers:
   ```sql
   SHOW max_parallel_workers_per_gather;
   ```

2. Verify work_mem is sufficient:
   ```sql
   SHOW work_mem;  -- Increase if needed (32MB, 64MB)
   ```

3. Check autovacuum activity:
   ```sql
   SELECT * FROM pg_stat_progress_vacuum;
   ```

## Expected Results

- **Query Performance**: 10+ second reduction in end-to-end query time
- **pgbench TPS**: 5.1k+ TPS with 2.4M records, 256 clients
- **Index Usage**: 100% index scans (no sequential scans)
- **Parallel Workers**: 4 workers per gather node
- **Memory**: 16MB work_mem handles complex queries
- **Autovacuum**: Keeps bloat minimal (aggressive tuning)

## Files

- **Tuning SQL**: `infra/db/comprehensive-db-tuning.sql`
- **Restore Script**: `scripts/restore-and-tune-all-databases.sh`
- **Documentation**: `DATABASE_RESTORE_AND_TUNING_PLAN.md`
