# PostgreSQL Performance Optimization Status

**Last Updated:** 2024-11-19  
**Target:** 20ms execution time for fuzzy search queries  
**Current Status:** ~1000ms (50x slower than target)

## Current Performance Metrics

### Query Performance
- **Raw `%` query:** 1201ms (matches 613k → filters to 56k → sorts)
- **KNN query (`<->`):** 945ms (reads 25k buffers ≈ 200MB)
- **Function (KNN-first):** 1004ms (reads 29k buffers ≈ 230MB)
- **Target:** 20ms

### Database Configuration
- **PostgreSQL:** Running in Docker (`postgres-external` container)
- **Connection:** `localhost:5432`
- **Database:** `records`
- **Dataset:** 1.2M rows total
- **Benchmark User:** `0dc268d0-a86f-4e12-8d10-9db0f1b735e0`

### Indexes Created

#### Partial Indexes (Tenant-Scoped)
- `idx_records_search_norm_gist_user0`: 199MB (GiST trigram, KNN path)
- `idx_records_search_norm_gin_user0`: 71MB (GIN trigram, `%` path)
- `idx_records_user_id_btree`: 8MB (user_id filtering)

#### Global Indexes
- **Status:** Dropped (to force partial index usage)
- Previously existed: `idx_records_partitioned_search_norm_gist`, `idx_records_partitioned_search_norm_gin`, `ix_records_search_norm_gist`

## Root Cause Analysis

### Primary Issue
The GiST trigram index (199MB for this tenant) is too large and inefficient for KNN queries:
- Reading ~200MB of index to find 50 nearest neighbors
- Poor index selectivity for KNN operations
- Physical table order doesn't match index order (poor locality)

### Why `%` Query is Slow
- Threshold 0.35 matches 613k rows from index
- Then filters to 56k rows
- Then sorts 56k rows
- **Fundamentally inefficient** - avoid this path

### Why KNN Query is Slow
- GiST index scan reads 25k+ buffers (~200MB) to return 50 rows
- Index structure doesn't efficiently narrow down candidates
- Table not clustered by index (poor locality)

## Optimizations Applied

### ✅ Completed
1. **High-Threshold GIN % Function Design** (NEW STRATEGY)
   - Rewrote `search_records_fuzzy_ids` to use high-threshold GIN %
   - Uses `set_limit(0.70)` to dramatically reduce candidate set
   - Leverages GIN index's efficient `%` operator
   - Candidate cap: 300 rows
   - Avoids slow KNN GiST scan over large index

2. **Partial Indexes**
   - Created tenant-scoped GiST and GIN indexes
   - Dropped global indexes to force partial index usage

3. **Function Optimization**
   - Reduced `candidate_cap` from 2000 → 500
   - Uses KNN-only path (no `%` in heavy path)

4. **Database Connection Unification**
   - All connections use `localhost:5432`
   - Removed pod-based database access

### 🔄 In Progress
1. **Table Clustering**
   - **Issue:** PostgreSQL cannot cluster on partial indexes
   - **Workaround:** Create temporary global index, cluster, then drop
   - **Script:** `scripts/cluster-table-for-knn.sh`

### ❌ Not Yet Attempted
1. **Partitioning by user_id**
   - Could dramatically reduce index size per partition
   - Would require schema changes

2. **Further candidate_cap reduction**
   - Current: 500
   - Could try: 200-300

3. **Alternative index strategies**
   - B-tree on normalized hash
   - Different trigram index configuration

## Key Files

### Scripts
- `scripts/create-knn-function.sh` - Creates KNN-first search function
- `scripts/create-per-tenant-indexes.sh` - Creates partial indexes
- `scripts/optimize-for-speed.sh` - Drops global indexes, warms cache
- `scripts/cluster-table-for-knn.sh` - Clusters table by GiST index
- `scripts/run_pgbench_sweep.sh` - Benchmark harness
- `scripts/debug_trgm_thresholds.sql` - Tests different similarity thresholds

### Function Signature
```sql
public.search_records_fuzzy_ids(
  p_user   uuid,
  p_q      text,
  p_limit  bigint DEFAULT 100,
  p_offset bigint DEFAULT 0
) RETURNS TABLE(id uuid, rank real)
```

**Design:**
- Uses high-threshold `%` (0.70) with GIN index for candidate selection
- Uses `set_limit(0.70)` to force small candidate set (few hundred vs 600k+)
- Candidate cap: 300 rows max
- Computes `similarity()` only on small candidate set
- Rank threshold: 0.20
- **Key advantage:** GIN `%` with high threshold is much faster than KNN GiST scan

## Next Steps

### Immediate (High Priority)
1. **✅ Implemented: High-threshold GIN % strategy**
   - Changed from KNN-first to high-threshold GIN %
   - Uses `set_limit(0.70)` to dramatically reduce candidate set
   - Should reduce matches from 600k+ → few hundred
   - **Status:** Function updated, testing in progress

2. **Test new function performance:**
   ```bash
   PGHOST=localhost PGPORT=5432 PGUSER=postgres PGDATABASE=records PGPASSWORD=postgres \
   psql -c "EXPLAIN ANALYZE SELECT count(*) FROM public.search_records_fuzzy_ids(...)"
   ```

3. **Tune parameters:**
   - `candidate_cap`: Try 200, 300, 500
   - `high_trgm_limit`: Try 0.65, 0.70, 0.75
   - Measure: avg_ms, rows per query, buffer hits

### Deferred (Disk Space Issue)
- **Clustering:** Cannot run due to disk space constraints
- **Issue:** Creating temporary global GiST index requires too much space
- **Workaround:** High-threshold GIN % strategy avoids need for clustering

### Medium Priority
3. **If still slow after clustering:**
   - Reduce `candidate_cap` further (500 → 200)
   - Check tenant record count (199MB index suggests ~1M+ records)
   - Consider if this tenant is representative of production

### Long Term
4. **Consider partitioning:**
   - Partition `records.records` by `user_id`
   - Would create smaller indexes per partition
   - Requires schema migration

5. **Alternative strategies:**
   - Different index types
   - Materialized views for hot tenants
   - Caching layer

## Benchmark Variants

The harness tests these variants:
- `knn` - Direct KNN query (`<->`)
- `trgm` - Function call (KNN-first)
- `trgm_simple` - Raw `%` query (diagnostic only)
- `noop` - `SELECT 1` (TPS ceiling)

## Configuration

### Environment Variables
- `TRGM_THRESHOLD`: Default 0.45 (for `%` queries)
- `TRACK_IO_TIMING`: Default `on` (set to `off` for max TPS)
- `BENCH_USER_UUID`: Default `0dc268d0-a86f-4e12-8d10-9db0f1b735e0`

### PostgreSQL Settings (via PGOPTIONS)
- `jit=off`
- `enable_seqscan=off`
- `random_page_cost=1.0`
- `cpu_index_tuple_cost=0.0005`
- `cpu_tuple_cost=0.01`
- `effective_cache_size=8GB`
- `work_mem=256MB`
- `pg_trgm.similarity_threshold=0.45`

## Known Issues

1. **Disk space constraint**
   - Cannot create temporary global GiST index for clustering
   - Error: "No space left on device"
   - **Workaround:** High-threshold GIN % strategy avoids need for clustering

2. **Cannot cluster on partial indexes**
   - PostgreSQL limitation
   - Would require temporary global index (blocked by disk space)

3. **Large index size**
   - 199MB GiST index for single tenant
   - Suggests tenant has many records
   - May need partitioning if performance still insufficient

## Expected Performance After Clustering

- **Buffer reads:** Should reduce by 50-70%
- **Execution time:** Target <200ms initially
- **Further optimization:** Tune to 20ms target

## Notes for Future Reference

- All database connections use `localhost:5432` (Docker Postgres)
- Function uses KNN-first design (no `%` in candidate selection)
- Partial indexes are tenant-scoped for better selectivity
- Global indexes were dropped to force partial index usage
- Clustering requires temporary global index (PostgreSQL limitation)

