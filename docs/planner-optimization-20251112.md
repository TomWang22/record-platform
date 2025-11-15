# PostgreSQL Planner Optimization - November 12, 2025

## Problem
- TRGM performance below target: ~3.8k TPS instead of 4.7-5.1k TPS at 64 clients, 12 threads
- KNN queries showing weird/incorrect numbers
- Planner being too conservative, preferring sequential scans over index scans
- Statistics potentially stale after data loads

## Root Causes Identified

1. **Planner Cost Settings Too Conservative**
   - `random_page_cost = 1.2` (too high for SSD)
   - `cpu_index_tuple_cost` not set (defaults to 0.005, too high)
   - `effective_cache_size = 2GB` (too low, doesn't reflect actual cache)

2. **Stale Statistics**
   - No automatic `VACUUM ANALYZE` after data loads
   - Partition statistics not updated

3. **Index Usage Not Verified**
   - No verification that indexes are actually being used
   - Planner might be choosing sequential scans

## Solutions Applied

### 1. Aggressive Planner Tuning

**Deployment Changes** (`infra/k8s/base/postgres/deploy.yaml`):
```yaml
- random_page_cost=0.8          # Was 1.2 (40% lower - prefers indexes on SSD)
- cpu_index_tuple_cost=0.0005   # New (10x lower than default - strongly prefers indexes)
- effective_cache_size=8GB      # Was 2GB (4x higher - better planning)
```

**Impact:**
- Postgres will now strongly prefer index scans over sequential scans
- Better cost estimates for SSD I/O (random_page_cost closer to seq_page_cost)
- More accurate planning with higher effective_cache_size

### 2. Automatic VACUUM ANALYZE

**Benchmark Script Changes** (`scripts/run_pgbench_sweep.sh`):
- Added `VACUUM ANALYZE records.records` before benchmarks
- Added `ANALYZE` on all partitions
- Ensures fresh statistics for accurate query planning

### 3. Session-Level Settings

**PGOPTIONS_EXTRA** updated:
```bash
PGOPTIONS_EXTRA="-c jit=off -c random_page_cost=0.8 -c cpu_index_tuple_cost=0.0005 -c cpu_tuple_cost=0.01 -c effective_cache_size=8GB"
```

These settings are applied to each pgbench connection, ensuring consistent behavior.

### 4. Verification Script

Created `scripts/verify-index-usage.sh` to:
- Check TRGM query plans (should use GIN index)
- Check KNN query plans (should use GiST index)
- Display current planner settings
- Show index usage statistics

## Expected Performance Improvements

### TRGM (Substring Search)
- **Before:** ~3.8k TPS at 64 clients
- **Target:** 4.7-5.1k TPS at 64 clients
- **Expected:** 20-30% improvement from:
  - Better index usage (GIN indexes preferred)
  - Lower tail latency (faster index scans)
  - Better partition pruning

### KNN (Fuzzy Search)
- **Before:** Broken/weird numbers
- **Expected:** Should now work correctly with:
  - GiST index on `search_norm` being used
  - Proper query plans
  - Accurate results

## Next Steps

1. **Restart Postgres** to apply deployment changes:
   ```bash
   kubectl -n record-platform rollout restart deploy/postgres
   kubectl -n record-platform rollout status deploy/postgres
   ```

2. **Verify Index Usage**:
   ```bash
   ./scripts/verify-index-usage.sh
   ```
   
   Look for:
   - TRGM queries using `Bitmap Index Scan` on GIN indexes
   - KNN queries using `Index Scan` on GiST indexes
   - No sequential scans (`Seq Scan`)

3. **Run Benchmark**:
   ```bash
   ./scripts/run_pgbench_sweep.sh
   ```

4. **Check Results**:
   - TRGM should be 4.7-5.1k TPS at 64 clients
   - KNN should show reasonable numbers
   - Tail latency (P95, P99) should be lower

## Monitoring

After restart, verify settings:
```sql
SELECT name, setting, unit
FROM pg_settings
WHERE name IN (
  'random_page_cost',
  'cpu_index_tuple_cost',
  'effective_cache_size',
  'shared_buffers',
  'work_mem'
)
ORDER BY name;
```

## Troubleshooting

If performance doesn't improve:

1. **Check query plans:**
   ```sql
   SET enable_seqscan = off;
   EXPLAIN (ANALYZE, BUFFERS) <your_query>;
   ```
   Should show index scans, not sequential scans.

2. **Verify statistics are fresh:**
   ```sql
   SELECT schemaname, relname, last_analyze, n_live_tup
   FROM pg_stat_user_tables
   WHERE schemaname = 'records' AND relname = 'records';
   ```
   `last_analyze` should be recent.

3. **Check index usage:**
   ```sql
   SELECT indexname, idx_scan, idx_tup_read, idx_tup_fetch
   FROM pg_stat_user_indexes
   WHERE schemaname = 'records' AND tablename = 'records'
   ORDER BY idx_scan DESC;
   ```
   Indexes should have high `idx_scan` counts.

4. **Monitor shared_buffers hit ratio:**
   ```sql
   SELECT 
     sum(blks_hit) * 100.0 / NULLIF(sum(blks_hit) + sum(blks_read), 0) as hit_ratio
   FROM pg_stat_database
   WHERE datname = current_database();
   ```
   Should be > 99% for good performance.

## Files Changed

- `infra/k8s/base/postgres/deploy.yaml` - Planner settings
- `scripts/run_pgbench_sweep.sh` - VACUUM ANALYZE and PGOPTIONS
- `scripts/verify-index-usage.sh` - New verification script
- `infra/db/44-optimize-planner.sql` - SQL optimization script

