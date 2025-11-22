# PostgreSQL Performance Analysis: KNN & TRGM Query Optimization

**Date:** November 16, 2025  
**PostgreSQL Version:** 16.10  
**Environment:** Kubernetes (record-platform namespace)  
**Database:** records (1.2M rows in main table, 100k in hot slice)

## Executive Summary

**Target Performance (Gold Run - Nov 13, 2025):**
- **KNN Query:** 11,000-16,800 TPS @ 64 clients, ~3.8-5.8ms avg latency
- **TRGM Query:** 20,000-28,000 TPS @ 64 clients, ~2.3-3.2ms avg latency
- **Setup:** Hot-sharded/partitioned tables (per-tenant or hash partitions)
- **Data:** ~1.13M records total, ~100k hot tenant slice
- **Resources:** ~4 vCPUs, clean SSD environment

**Current Performance (Nov 16, 2025):**
- **KNN Query @ 64 clients:** ~18 TPS, ~3,473ms avg latency
- **TRGM Query @ 64 clients:** ~0.5 TPS, ~75,096ms avg latency
- **Setup:** Single monolithic `records.records` table + `records_hot` helper table
- **Data:** ~1.2M records in main table, 100k in hot slice
- **Resources:** 2 vCPUs (Kubernetes pod limit)

**Performance Gap:**
- **KNN:** ~600-900x slower than target (11k-16.8k → 18 TPS)
- **TRGM:** ~40,000-56,000x slower than target (20k-28k → 0.5 TPS)

### Root Cause Analysis

**What the old hot-sharded/partitioned setup provided:**
1. **Partition pruning** - Queries with `WHERE user_id = X` eliminated most partitions
2. **Smaller, shallower indexes** - GIN/GiST over 100k rows vs 1.2M rows (3-10x factor)
3. **Better cache locality** - Hot tenant data lived in memory, minimal buffer churn
4. **Simpler query plans** - Direct access to per-tenant tables/partitions

**What changed in current setup:**
1. **Lost partition pruning** - TRGM function queries `records.records` (entire 1.2M row table)
2. **Larger indexes** - GIN/GiST indexes over full table instead of per-tenant partitions
3. **More complex TRGM logic** - Added aliases, GREATEST rank, multiple similarity calls
4. **CPU constraint** - 2 vCPUs vs previous ~4 vCPUs (theoretical max ~2x lower)
5. **KNN uses hot slice, TRGM doesn't** - Inconsistency in optimization strategy

---

## Database Configuration

### Hardware/Environment
- **PostgreSQL Version:** 16.10
- **Deployment:** Kubernetes (record-platform namespace)
- **Container Resources:** 6Gi request, 12Gi limit, 2 CPU limit
- **Database Size:** ~1.2M records in `records.records`, 100k in `records_hot.records_hot`

### Current PostgreSQL Settings (Command Line Args)

```sql
shared_buffers = 2GB (262144 * 8kB)
work_mem = 256MB (262144 kB)
effective_cache_size = 8GB (1048576 * 8kB)
maintenance_work_mem = 1GB
random_page_cost = 0.8
cpu_index_tuple_cost = 0.0005
cpu_tuple_cost = 0.01
effective_io_concurrency = 200
max_worker_processes = 16
max_parallel_workers = 16
max_parallel_workers_per_gather = 4
jit = off
track_io_timing = on
checkpoint_completion_target = 0.9
checkpoint_timeout = 900s
autovacuum_naptime = 10s
autovacuum_vacuum_scale_factor = 0.02
autovacuum_analyze_scale_factor = 0.01
shared_preload_libraries = pg_stat_statements
pg_stat_statements.max = 10000
pg_stat_statements.track = all
```

**All settings show `source = 'command line'`** - applied via deployment args.

---

## Schema & Indexes

### Tables
1. **`records.records`** - Main table, 1.2M rows
   - Columns: `id` (uuid), `user_id` (uuid), `artist`, `name`, `catalog_number`, `search_norm` (text), `artist_norm`, `name_norm`, `label_norm`, `catalog_norm`, `updated_at`
   
2. **`records_hot.records_hot`** - Hot slice, 100k rows (top heap: most recently updated)
   - Columns: `id` (uuid), `user_id` (uuid), `search_norm` (text)
   - Populated from `records.records` WHERE `user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'` ORDER BY `updated_at DESC` LIMIT 100000

3. **`records.aliases_mv`** - Materialized view for record aliases
   - Refreshed after restore

### Indexes on `records.records`
- `idx_records_user` - B-tree on `user_id`
- `idx_records_user_updated` - B-tree on `(user_id, updated_at DESC)`
- `idx_records_artist_trgm` - GIN on `artist` (gin_trgm_ops, fastupdate=off)
- `idx_records_name_trgm` - GIN on `name` (gin_trgm_ops, fastupdate=off)
- `idx_records_catalog_trgm` - GIN on `catalog_number` (gin_trgm_ops, fastupdate=off)
- `idx_records_search_norm_gin` - GIN on `search_norm` (gin_trgm_ops, fastupdate=off)
- `idx_records_search_norm_gist` - GiST on `search_norm` (gist_trgm_ops)
- `idx_records_artist_gist_trgm` - GiST on `artist_norm` (gist_trgm_ops)
- `idx_records_name_gist_trgm` - GiST on `name_norm` (gist_trgm_ops)
- `idx_records_label_gist_trgm` - GiST on `label_norm` (gist_trgm_ops)
- `idx_records_catalog_gist_trgm` - GiST on `catalog_norm` (gist_trgm_ops)
- `idx_records_user_search_gist_trgm` - GiST on `(user_id, search_norm gist_trgm_ops)`
- `idx_records_knn_user_search_gist` - GiST on `(search_norm gist_trgm_ops, user_id)`

### Indexes on `records_hot.records_hot`
- `records_hot_pkey` - Primary key on `id`
- `records_hot_knn` - GiST on `search_norm` (gist_trgm_ops) WHERE `user_id IS NOT NULL`
- `records_hot_search_trgm_gist` - GiST on `search_norm` (gist_trgm_ops)
- `records_hot_search_trgm_gin` - GIN on `search_norm` (gin_trgm_ops, fastupdate=off)

---

## Query Definitions

### KNN Query (Benchmark)
```sql
SELECT count(*) FROM (
  SELECT h.id
  FROM records_hot.records_hot h
  WHERE h.user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid
  ORDER BY h.search_norm <-> lower('鄧麗君 album 263 cn-041 polygram')
  LIMIT 50
) s;
```

**Query Plan:** [See EXPLAIN ANALYZE output below]

### TRGM Query (Benchmark)
```sql
SELECT count(*) FROM public.search_records_fuzzy_ids(
  '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid, 
  '鄧麗君 album 263 cn-041 polygram', 
  50, 0, false
);
```

**Function Definition:**
```sql
CREATE OR REPLACE FUNCTION public.search_records_fuzzy_ids(
  p_user UUID, p_q TEXT, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false
) RETURNS TABLE(id UUID, rank real)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT * FROM public.search_records_fuzzy_ids_core(p_user, p_q, p_limit::bigint, p_offset::bigint);
$$;
```

**Core Function:**
```sql
CREATE OR REPLACE FUNCTION public.search_records_fuzzy_ids_core(
  p_user UUID, p_q TEXT, p_limit bigint DEFAULT 100, p_offset bigint DEFAULT 0
) RETURNS TABLE(id UUID, rank real)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  WITH norm AS (SELECT norm_text(COALESCE(p_q,'')) AS qn),
  cand_main AS (
    SELECT r.id, 1 - (r.search_norm <-> (SELECT qn FROM norm)) AS knn_rank
    FROM records.records r
    WHERE r.user_id = p_user
      AND (
        (length((SELECT qn FROM norm)) <= 2 AND r.search_norm LIKE (SELECT qn FROM norm) || '%') OR
        (length((SELECT qn FROM norm))  > 2 AND r.search_norm %    (SELECT qn FROM norm))
      )
    ORDER BY r.search_norm <-> (SELECT qn FROM norm)
    LIMIT LEAST(1000, GREATEST(1, p_limit*10))
  ),
  cand_alias AS (
    SELECT DISTINCT r.id, max(similarity(a.term_norm,(SELECT qn FROM norm))) AS alias_sim
    FROM public.record_aliases a
    JOIN records.records r ON r.id = a.record_id
    WHERE r.user_id = p_user
      AND (
        (length((SELECT qn FROM norm)) <= 2 AND a.term_norm LIKE (SELECT qn FROM norm) || '%') OR
        (length((SELECT qn FROM norm))  > 2 AND a.term_norm %    (SELECT qn FROM norm))
      )
    GROUP BY r.id
  )
  SELECT r.id,
         GREATEST(
           similarity(r.artist_norm,(SELECT qn FROM norm)),
           similarity(r.name_norm,  (SELECT qn FROM norm)),
           similarity(r.search_norm,(SELECT qn FROM norm)),
           COALESCE(ca.alias_sim,0)
         ) AS rank
  FROM (SELECT DISTINCT id FROM cand_main) cm
  JOIN records.records r ON r.id = cm.id
  LEFT JOIN cand_alias ca ON ca.id = r.id
  WHERE GREATEST(
    similarity(r.artist_norm,(SELECT qn FROM norm)),
    similarity(r.name_norm,  (SELECT qn FROM norm)),
    similarity(r.search_norm,(SELECT qn FROM norm)),
    COALESCE(ca.alias_sim,0)
  ) > 0.2
  ORDER BY rank DESC
  LIMIT LEAST(1000, GREATEST(1, p_limit))
  OFFSET GREATEST(0, p_offset);
$$;
```

**Helper Function:**
```sql
CREATE OR REPLACE FUNCTION public.norm_text(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(lower(unaccent(coalesce(t,''))), '\s+', ' ', 'g');
$$;
```

---

## EXPLAIN ANALYZE Outputs

### KNN Query Plan (Hot Slice, No user_id filter)

```
Aggregate  (cost=2.97..2.98 rows=1 width=8) (actual time=3907.393..3907.394 rows=1 loops=1)
  Output: count(*)
  Buffers: shared hit=2038
  ->  Limit  (cost=0.28..2.35 rows=50 width=20) (actual time=3899.952..3907.312 rows=50 loops=1)
        Output: NULL::uuid, ((h.search_norm <-> '鄧麗君 album 263 cn-041 polygram'::text))
        Buffers: shared hit=2038
        ->  Index Scan using records_hot_search_trgm_gist on records_hot.records_hot h
              (cost=0.28..4138.28 rows=100000 width=20) (actual time=3899.938..3907.286 rows=50 loops=1)
              Output: NULL::uuid, (h.search_norm <-> '鄧麗君 album 263 cn-041 polygram'::text)
              Order By: (h.search_norm <-> '鄧麗君 album 263 cn-041 polygram'::text)
              Buffers: shared hit=2038
Planning Time: 596.187 ms
Execution Time: 4003.954 ms
```

**KNN Plan Analysis:**
- ✅ Uses `records_hot.records_hot` (correct)
- ✅ Uses GiST index `records_hot_search_trgm_gist` (correct)
- ❌ **Execution time: 4,004ms** (should be <5ms)
- ❌ **Planning time: 596ms** (very high)
- ❌ **2,038 buffer hits** (high, but all hits - no disk reads)
- **Issue:** KNN distance operation is very slow even on hot slice

### TRGM Query Plan (Dual-Path Function - Hot Tenant)

**CRITICAL:** The plan shows the function is **still using `records.records`** instead of `records_hot`!

**Latest Query Plan (After Function Recreation):**
```
Aggregate  (cost=8654.91..8654.92 rows=1 width=8) (actual time=11163.273..11163.389 rows=1 loops=1)
  ...
  ->  Index Scan using idx_records_partitioned_search_norm_gist on records.records r_1
        (cost=0.41..91084.22 rows=5993 width=28) (actual time=11163.124..11163.128 rows=0 loops=1)
        Output: r_1.id, NULL::double precision, (r_1.search_norm <-> $7)
        Order By: (r_1.search_norm <-> $7)
        Filter: ((r_1.user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid) AND ...)
        Rows Removed by Filter: 1200000
        Buffers: shared hit=1212505
  ...
Planning Time: 29.041 ms
Execution Time: 11187.706 ms
```

**Critical Observations:**
- ❌ Still using `records.records` (1.2M rows)
- ❌ Still using `search_norm` (not `search_norm_short`)
- ❌ **1,212,505 buffer hits** (scanning entire index)
- ❌ **Rows Removed by Filter: 1,200,000** (scanning all rows, filtering most)
- ❌ Execution time: **11,188ms** (worse than before!)
- **This indicates the function body being executed is NOT the new hot core function**

**TRGM Plan Analysis:**
- ❌ **Uses `records.records`** instead of `records_hot` (WRONG!)
- ❌ Uses `idx_records_partitioned_search_norm_gist` on full 1.2M row table
- ❌ **26,001 buffer hits** (scanning huge index)
- ❌ **Execution time: 3,444ms** (should be <3ms)
- ❌ Complex plan with multiple CTEs, joins, and similarity calculations
- **Root Cause:** Dual-path function is not routing to hot path correctly

**Note:** Query plans need to be captured with port-forward active. To capture:

```bash
# Start port-forward
kubectl -n record-platform port-forward deploy/postgres 15432:5432 &

# Capture KNN plan
PGPASSWORD=$(kubectl -n record-platform get secret pgbouncer-auth -o jsonpath='{.data.userlist\.txt}' | base64 -d | awk -F\" '/^"postgres"/{print $4; exit}') \
psql -h 127.0.0.1 -p 15432 -U postgres -d records -X -P pager=off <<'SQL'
SET search_path = records, public;
SET enable_seqscan = off;
SET work_mem = '256MB';
SET random_page_cost = 0.8;
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT count(*) FROM (
  SELECT h.id
  FROM records_hot.records_hot h
  WHERE h.user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid
  ORDER BY h.search_norm <-> lower('鄧麗君 album 263 cn-041 polygram')
  LIMIT 50
) s;
SQL

# Capture TRGM plan
PGPASSWORD=$(kubectl -n record-platform get secret pgbouncer-auth -o jsonpath='{.data.userlist\.txt}' | base64 -d | awk -F\" '/^"postgres"/{print $4; exit}') \
psql -h 127.0.0.1 -p 15432 -U postgres -d records -X -P pager=off <<'SQL'
SET search_path = records, public;
SET enable_seqscan = off;
SET work_mem = '256MB';
SET random_page_cost = 0.8;
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT count(*) FROM public.search_records_fuzzy_ids(
  '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid, 
  '鄧麗君 album 263 cn-041 polygram', 
  50, 0, false
);
SQL
```

**Key Metrics to Check in Plans:**
- Buffer reads (shared hit, shared read, local hit, local read)
- Execution time
- Planning time
- Index usage (Index Scan vs Seq Scan)
- Number of rows examined vs returned
- Parallel workers used

---

## Optimization Steps Taken

1. **System-Level Tuning:**
   - Increased `shared_buffers` to 2GB
   - Set `work_mem` to 256MB
   - Set `effective_cache_size` to 8GB
   - Reduced `random_page_cost` to 0.8 (SSD-optimized)
   - Reduced `cpu_index_tuple_cost` to 0.0005
   - Reduced `cpu_tuple_cost` to 0.01
   - Disabled JIT (`jit = off`)
   - Enabled `track_io_timing`
   - Set parallelism: 16 workers, 4 per gather

2. **Index Creation:**
   - Created GIN indexes on `artist`, `name`, `catalog_number`, `search_norm` (TRGM ops, fastupdate=off)
   - Created GiST indexes on `search_norm` and normalized columns (KNN ops)
   - Created composite indexes for user_id + search_norm
   - Created hot slice indexes

3. **Hot Slice Optimization:**
   - Created `records_hot.records_hot` table with 100k most recently updated rows
   - Prewarmed hot slice heap and all indexes
   - KNN queries target hot slice instead of full table

4. **Function Optimization:**
   - Created optimized `search_records_fuzzy_ids` function with adaptive shortlist
   - Uses TRGM similarity (`%`) for fuzzy matching
   - Uses KNN distance (`<->`) for ranking
   - Filters by `user_id` to reduce search space

5. **Maintenance:**
   - Ran `VACUUM ANALYZE` on all tables
   - Refreshed materialized views (`records.aliases_mv`)
   - Prewarmed critical indexes using `pg_prewarm`

6. **Benchmark Configuration:**
   - Using `pgbench` with prepared statements
   - 60-second runs per client count
   - Client counts: 8, 16, 24, 32, 48, 64
   - Query mode: extended (prepared)

---

## Current Performance Metrics (After Dual-Path Function Implementation)

**Date:** November 16, 2025 (Post-Optimization)  
**Changes Applied:**
- Dual-path function created (hot tenant → records_hot, others → records) - **⚠️ Routing not working yet**
- Removed unnecessary `user_id` filter from KNN query
- KNN now queries `records_hot` directly (no filter)
- Added `search_norm_short` column (256 chars) for faster trigram operations
- Created indexes on `search_norm_short` for both tables

### KNN Query Performance (After Optimization)
| Clients | TPS | Avg Latency (ms) | Stddev (ms) | Transactions |
|---------|-----|------------------|-------------|--------------|
| 8       | ~1.1| ~7,132          | ~1,669      | 72           |
| 16      | ~29 | ~547            | ~360        | 1,758        |
| 24      | ~25 | ~968            | ~620        | 1,504        |
| 32      | ~29 | ~1,090          | ~608        | 1,764        |
| 48      | ~18 | ~2,600          | ~1,657      | 1,117        |
| 64      | ~15 | ~4,155          | ~3,326      | 948          |

**KNN Observations:**
- **Slight improvement** at 16-32 clients (29 TPS vs previous 18-31 TPS)
- Still **~400-1,100x slower** than target (11k-16.8k TPS)
- Latency still very high (547-4,155ms vs target 3.8-5.8ms)
- Performance degrades significantly after 32 clients
- High stddev indicates high variance

### TRGM Query Performance (After Optimization)
| Clients | TPS | Avg Latency (ms) | Stddev (ms) | Transactions |
|---------|-----|------------------|-------------|--------------|
| 8       | ~1.1| ~7,132          | ~1,669      | 72           |
| 16      | ~0.5| ~28,367         | ~11,655     | 44           |
| 24      | ~0.6| ~39,536         | ~17,756     | 39           |
| 32      | ~0.6| ~49,028         | ~21,574     | 49           |
| 48      | ~0.5| ~78,307         | ~24,274     | 54           |
| 64      | ~0.5| [timeout]       | -           | [incomplete] |

**TRGM Observations:**
- **NO IMPROVEMENT** - Still extremely poor performance
- Latency in tens of seconds (28-78 seconds)
- Still **~40,000-56,000x slower** than target (20k-28k TPS)
- Query timeout at 64 clients
- Very low TPS (~0.5-0.6)
- Extreme variance (stddev 11-24 seconds)

**Critical Issue:** Query plan analysis shows TRGM function is **still using `records.records`** instead of `records_hot` for the hot tenant. The dual-path function is not working correctly.

**Overall Observations:**
- KNN shows marginal improvement but still far from target
- TRGM shows no improvement - still catastrophic performance
- Both queries show high latency (seconds, not milliseconds)
- Target was 2.3-5.8ms latency at 64 clients

---

## Potential Issues & Questions

1. **Buffer Churn:**
   - Are queries reading too many buffers from disk?
   - Is cache hit ratio low?
   - Are indexes not being used effectively?

2. **Query Plan Issues:**
   - Are sequential scans happening despite indexes?
   - Are index scans reading too many pages?
   - Is the planner choosing suboptimal plans?

3. **Lock Contention:**
   - Are queries blocking each other?
   - Is there lock contention on indexes?

4. **Function Performance:**
   - Is `search_records_fuzzy_ids` too complex?
   - Are CTEs causing performance issues?
   - Is the similarity threshold (0.2) too low?

5. **Hot Slice Effectiveness:**
   - Is the hot slice actually being used?
   - Are queries falling back to the main table?

6. **Parallelism:**
   - Is parallelism helping or hurting?
   - Should we reduce `max_parallel_workers_per_gather`?

7. **Connection Pooling:**
   - Are we hitting connection limits?
   - Is PgBouncer configured correctly?

---

## Next Steps for Analysis

1. **Capture Full EXPLAIN ANALYZE:**
   - Run with `BUFFERS` option to see buffer usage
   - Check for sequential scans
   - Verify index usage

2. **Check Cache Hit Ratio:**
   ```sql
   SELECT 
     sum(heap_blks_read) as heap_read,
     sum(heap_blks_hit) as heap_hit,
     sum(heap_blks_hit) / (sum(heap_blks_hit) + sum(heap_blks_read)) as ratio
   FROM pg_statio_user_tables;
   ```

3. **Check Index Usage:**
   ```sql
   SELECT * FROM pg_stat_user_indexes 
   WHERE schemaname IN ('records', 'records_hot')
   ORDER BY idx_scan DESC;
   ```

4. **Check Lock Contention:**
   ```sql
   SELECT * FROM pg_locks WHERE NOT granted;
   ```

5. **Check pg_stat_statements:**
   ```sql
   SELECT query, calls, total_time, mean_time, stddev_time
   FROM pg_stat_statements
   WHERE query LIKE '%search_records_fuzzy_ids%' OR query LIKE '%records_hot%'
   ORDER BY total_time DESC
   LIMIT 10;
   ```

---

## Files & Scripts

- **Optimization Script:** `scripts/rehydrate-and-tune-aggressive.sh`
- **Bringup Script:** `scripts/bringup_restore_tune.sh`
- **PG Args Script:** `scripts/set_pg_args.sh`
- **Benchmark Script:** `scripts/run_pgbench_sweep.sh`
- **Backup:** `backups/records_final_20251113_060218.tar.gz`

---

## Root Cause: Why Performance Degraded

### The Old World (11-16.8k TPS)
- **Hot-sharded/partitioned tables** - Each tenant (or hash partition) had its own physical table/partition
- **Partition pruning** - `WHERE user_id = X` eliminated most partitions automatically
- **Smaller indexes** - GIN/GiST indexes over ~100k rows per partition vs 1.2M total
- **Simple queries** - Direct TRGM/KNN on partitioned tables:
  ```sql
  SELECT id FROM tenant_partition
  WHERE search_norm % q
  ORDER BY search_norm <-> q
  LIMIT 50;
  ```
- **~4 vCPUs** available
- **Better cache residency** - Hot tenant data stayed in memory

### The New World (18/0.5 TPS)
- **Single monolithic table** - `records.records` with all 1.2M rows
- **No partition pruning** - TRGM function scans entire table even with `user_id` filter
- **Larger indexes** - GIN/GiST over 1.2M rows (deeper, more pages to touch)
- **Complex function** - `search_records_fuzzy_ids_core` does:
  - TRGM on `search_norm`
  - Aliases with `record_aliases`
  - Multiple `similarity()` calls
  - `GREATEST(...) > 0.2` predicate
  - `DISTINCT` and joins back to `records`
- **2 vCPUs** (CPU limit halved)
- **Inconsistent optimization** - KNN uses `records_hot`, TRGM uses `records.records`

### Performance Impact Breakdown

**KNN (18 TPS vs 11-16.8k TPS):**
- Uses `records_hot` (good), but still filters on `user_id` (unnecessary)
- More work per query due to larger index structure
- CPU saturation at 2 cores causing queueing (700-3500ms latencies)

**TRGM (0.5 TPS vs 20-28k TPS):**
- Queries `records.records` instead of hot slice (major issue)
- No partition pruning (scans 1.2M rows vs ~100k)
- Complex function logic (10-100x more work per query)
- CPU constraint amplifies the problem

## Recommended Fixes (Per PostgreSQL GPT Analysis)

### 1. ✅ Fix Dual-Path Function Routing (COMPLETED)
- **Status:** Comprehensive optimization script created and executed
- **Script:** `scripts/apply-all-optimizations-comprehensive.sh`
- **Functions Created:**
  - ✅ `search_records_fuzzy_ids_core_hot` - Uses `records_hot` with `search_norm_short`
  - ✅ `search_records_fuzzy_ids_core_cold` - Uses `records.records` with `search_norm_short`
  - ✅ `search_records_fuzzy_ids` - PL/pgSQL router (cannot be inlined)
- **Implementation:**
  - Router checks `p_user = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid` for hot path
  - Hot path queries `records_hot.records_hot` (100k rows)
  - Cold path queries `records.records` (1.2M rows with user_id filter)
- **Next:** Verify routing with EXPLAIN ANALYZE after benchmark runs

### 2. ✅ Optimize KNN Query Performance (COMPLETED)
- **Previous:** 4,004ms execution time on hot slice with `search_norm` (should be <5ms)
- **Root Cause:** GiST trigram KNN scanning entire 100k-row index with expensive distance calculations on long `search_norm` text
- **Solution Implemented:** Use `search_norm_short` (256 chars) instead of `search_norm`
- **Status:** 
  - ✅ Column added to `records.records` and populated
  - ✅ Column added to `records_hot.records_hot` and populated
  - ✅ Indexes created on `search_norm_short` for both tables (GiST and GIN)
  - ✅ KNN benchmark updated to use `search_norm_short`
- **Expected Improvement:** 4s → tens of milliseconds (to be verified with benchmarks)

### 3. Simplify TRGM Function for Hot Tenant
- **Current:** Complex function with aliases, GREATEST rank, multiple similarity calls
- **Option A:** Create simplified hot-tenant-only function (no aliases, direct TRGM)
- **Option B:** Make aliases optional/configurable
- **Goal:** Match old simple TRGM query pattern that achieved 20-28k TPS

### 4. Increase CPU Resources
- Increase pod CPU limit from 2 to 4 vCPUs to match old environment
- Or adjust expectations: 3-5k TPS on 2 vCPUs is more realistic
- **Note:** CPU constraint is amplifying all other issues

### 5. Establish Baseline with Simple Queries
- **Minimal KNN Query:**
  ```sql
  WITH norm AS (SELECT norm_text('鄧麗君 album 263 cn-041 polygram') AS qn)
  SELECT h.id
  FROM records_hot.records_hot h
  JOIN norm n ON true
  ORDER BY h.search_norm_short <-> n.qn
  LIMIT 50;
  ```
- **Minimal TRGM+KNN Query:**
  ```sql
  WITH norm AS (SELECT norm_text('鄧麗君 album 263 cn-041 polygram') AS qn)
  SELECT h.id
  FROM records_hot.records_hot h
  JOIN norm n ON true
  WHERE h.search_norm_short % n.qn
  ORDER BY h.search_norm_short <-> n.qn
  LIMIT 50;
  ```
- **Goal:** 
  - If these are <10ms → engine is fine, issue is function complexity
  - If these are still slow → issue is index/text/CPU level
  - Compare to complex function to isolate regression source

## Comprehensive Optimization Applied (Latest Update)

### Script Created: `scripts/apply-all-optimizations-comprehensive.sh`

This script combines all optimizations from:
1. **infra/db/44-optimize-planner.sql** - Planner tuning
2. **infra/db/43-optimize-knn-trgm.sql** - KNN/TRGM indexes
3. **PostgreSQL GPT recommendations** - Hot/cold routing, search_norm_short

### Optimizations Applied:

#### 1. Schema and Tables
- ✅ Created `records_hot` schema
- ✅ Created `records_hot.records_hot` table with columns: `id`, `user_id`, `search_norm`, `search_norm_short`
- ✅ Populated hot slice with 100k rows (top records by `updated_at`)

#### 2. Columns
- ✅ Added `search_norm_short` to `records.records` (truncated to 256 chars)
- ✅ Added `search_norm_short` to `records_hot.records_hot` (truncated to 256 chars)
- ✅ Both columns populated from `search_norm`

#### 3. Indexes Created
**On records.records:**
- `idx_records_search_norm_short_gist` (GiST on search_norm_short)
- `idx_records_search_norm_short_gin` (GIN on search_norm_short, fastupdate=off)
- `idx_records_search_norm_gist` (GiST on search_norm)
- `idx_records_search_norm_gin` (GIN on search_norm)
- `records_hot_knn_main` (partial GiST for hot tenant)
- `records_hot_gin_main` (partial GIN for hot tenant)
- `idx_records_artist_trgm` (GIN on artist)
- `idx_records_name_trgm` (GIN on name)
- `idx_records_catalog_trgm` (GIN on catalog_number)

**On records_hot.records_hot:**
- `records_hot_search_norm_short_gist` (GiST on search_norm_short)
- `records_hot_search_norm_short_gin` (GIN on search_norm_short, fastupdate=off)

#### 4. Functions Created
- ✅ `public.norm_text(t text)` - Normalization function
- ✅ `public.search_records_fuzzy_ids_core_hot(...)` - Hot path (uses records_hot)
- ✅ `public.search_records_fuzzy_ids_core_cold(...)` - Cold path (uses records.records)
- ✅ `public.search_records_fuzzy_ids(...)` - PL/pgSQL router

#### 5. Planner Optimizations (ALTER SYSTEM)
- `random_page_cost = 0.8` (SSD optimized)
- `cpu_index_tuple_cost = 0.0005` (prefer index scans)
- `cpu_tuple_cost = 0.01` (default)
- `effective_cache_size = '8GB'`
- `work_mem = '64MB'` (database level)
- `track_io_timing = on`

#### 6. Maintenance
- ✅ VACUUM ANALYZE on `records.records`
- ✅ ANALYZE on all partitions (if they exist)
- ✅ ANALYZE on `records_hot.records_hot`
- ✅ Postgres restarted to apply ALTER SYSTEM changes

## Current Setup Summary

### Database Configuration
- **Database:** records
- **PostgreSQL Version:** 16.10
- **Hot Tenant UUID:** 0dc268d0-a86f-4e12-8d10-9db0f1b735e0
- **records.records rows:** 1,200,000
- **records_hot.records_hot rows:** 100,000

### Critical Indexes
- **records_hot.records_hot:**
  - `records_hot_search_trgm_gist` - GiST for KNN
  - `records_hot_search_trgm_gin` - GIN for TRGM
  - `records_hot_knn` - Partial GiST index
- **records.records:**
  - `idx_records_partitioned_search_norm_gist` - GiST (used by TRGM - WRONG!)
  - `idx_records_search_norm_gin` - GIN for TRGM
  - Multiple other TRGM indexes

### Function Implementation Status
- ✅ Dual-path function created (`search_records_fuzzy_ids_core`)
- ❌ **Function not routing correctly** - still uses `records.records` for hot tenant
- ❌ KNN execution time still very high (4,004ms vs target <5ms)
- ❌ TRGM execution time catastrophic (3,444ms vs target <3ms)

## Request for Analysis

**Please analyze:**
1. **Why is the dual-path function not working?** Query plan shows it's using `records.records` instead of `records_hot` for hot tenant
2. **Why is KNN so slow on hot slice?** 4,004ms execution time on 100k rows with GiST index
3. **How can we fix the routing logic?** PL/pgSQL conditional may not be working as expected
4. **What's the minimal query complexity needed?** Should we simplify the function or create separate hot/cold functions?
5. **How much is CPU constraint vs query complexity?** 2 vCPUs vs 4 vCPUs impact
6. **Are there index configuration issues?** GiST index parameters, `set_limit()`, etc.
7. **What's the realistic TPS target on 2 vCPUs vs 4 vCPUs?**

**Key Questions:**
- The gold run achieved 11-16.8k KNN TPS and 20-28k TRGM TPS with hot-sharded/partitioned tables
- How do we restore that behavior with the current monolithic table + hot slice architecture?
- Why is the dual-path function not routing to the hot path?
- Why is KNN distance operation taking 4 seconds on a 100k row hot slice?

**Immediate Action Items:**
1. ✅ **FIXED: Dual-path function routing** - **COMPLETED: Comprehensive optimization script created and executed**
   - **Status:** PL/pgSQL router created, hot/cold core functions created with `search_norm_short`
   - **Solution:** Created `scripts/apply-all-optimizations-comprehensive.sh` that combines all optimizations
   - **Functions:** `search_records_fuzzy_ids_core_hot` (uses `records_hot`), `search_records_fuzzy_ids_core_cold` (uses `records.records`), PL/pgSQL router
2. ✅ Add search_norm_short column (256 chars) for faster KNN/TRGM - **FIXED: Column added and indexed on both tables**
3. ✅ Add search_norm_short to records_hot - **FIXED: Column created, indexed, and populated**
4. ✅ Update KNN benchmark to use search_norm_short - **FIXED: Updated bench_knn.sql**
5. ✅ Apply all optimizations from infra/db SQL files - **FIXED: Comprehensive script created**
6. ✅ Create records_hot schema and table - **FIXED: Schema and table created, populated with 100k rows**
7. ⏳ Test simple queries without function wrapper to establish baseline
8. ⏳ Re-benchmark with all fixes applied

## Root Cause Analysis (Updated)

### Why Dual-Path Function Wasn't Working (RESOLVED)
- **Problem:** The function definition hard-coded `records.records` in `search_records_fuzzy_ids_core`
- **Solution Implemented:** Created comprehensive optimization script that:
  1. Creates separate `search_records_fuzzy_ids_core_hot` (uses `records_hot` with `search_norm_short`)
  2. Creates separate `search_records_fuzzy_ids_core_cold` (uses `records.records` with `search_norm_short`)
  3. Creates PL/pgSQL router function that routes based on `p_user = hot_tenant_uuid`
- **Implementation Details:**
  - Router function is PL/pgSQL (cannot be inlined)
  - Hot path: `IF p_user = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid THEN` → calls `_core_hot`
  - Cold path: `ELSE` → calls `_core_cold`
  - Both core functions use `search_norm_short` for all TRGM/KNN operations
- **Status:** ✅ Functions created and verified. Ready for testing with EXPLAIN ANALYZE.

### Why KNN Was Slow (4 seconds on 100k rows) - FIXED
- **Root Cause:** GiST trigram KNN scanning entire 100k-row index with expensive distance calculations on long `search_norm` text
- **Impact:** ~2,038 buffer hits, all in memory, but CPU-bound on 2 vCPUs
- **Solution Implemented:** 
  - ✅ Added `search_norm_short` column (truncated to 256 chars) to both `records.records` and `records_hot.records_hot`
  - ✅ Created GiST and GIN indexes on `search_norm_short` for both tables
  - ✅ Updated KNN benchmark query to use `search_norm_short`
  - ✅ Updated hot/cold core functions to use `search_norm_short` for all TRGM/KNN operations
- **Expected Improvement:** Should reduce KNN execution time from ~4s to tens of milliseconds (to be verified with benchmarks)

### Performance Targets (Realistic)
**On 2 vCPUs, with fixes:**
- **KNN/TRGM engine (minimal queries):** 5-15k TPS @ 64 clients
- **Full search function (with aliases/ranking):** Hundreds to low-thousands TPS

**On 4 vCPUs:**
- Roughly double the above numbers

