# Current Optimization Status

**Date:** 2024-11-19  
**Target:** 20ms execution time  
**Current:** 640ms (high-threshold GIN %, threshold 0.60)

## ⚠️ CRITICAL BLOCKER: Disk Space

**Issue:** PostgreSQL data directory is out of disk space
- Cannot create new indexes
- Cannot add columns
- Cannot cluster tables
- Function updates failing

**Error Messages:**
```
ERROR: could not extend file "base/16384/...": No space left on device
```

**Impact:** Many optimizations cannot be implemented until disk space is freed.

## What's Working

### ✅ Completed Optimizations
1. **High-Threshold GIN % Strategy**
   - Function uses `set_limit(0.60)` to reduce candidate set
   - Threshold 0.60 gives ~136 matches (optimal balance)
   - Performance: 640ms (down from 1200ms+)
   - **No disk space required** ✅

2. **Partial Indexes**
   - `idx_records_search_norm_gist_user0`: 199MB (GiST, KNN)
   - `idx_records_search_norm_gin_user0`: 71MB (GIN, trigram)
   - Already created, working ✅

3. **Function Design**
   - KNN-first approach (avoided)
   - High-threshold GIN % (current)
   - Supports hash pre-filtering (when column exists)
   - Gracefully handles missing hash column ✅

## What's Blocked (Needs Disk Space)

### ❌ Hash Pre-Filtering
- **Script:** `scripts/add-hash-pre-filter.sh`
- **What it does:** Adds `search_norm_hash` column + btree indexes
- **Expected improvement:** 640ms → 50-100ms (6-12x faster)
- **Status:** Blocked - cannot add column

### ❌ Table Clustering
- **Script:** `scripts/cluster-table-for-knn.sh`
- **What it does:** Physically reorders table by index
- **Expected improvement:** Better locality, fewer buffer reads
- **Status:** Blocked - cannot create temporary index

### ⚠️ Partitioning
- **What it does:** Splits table into smaller partitions
- **Expected improvement:** 199MB indexes → ~25MB per partition
- **Status:** May require significant space for migration

## Deep Optimization Plan

**Document:** `DEEP_OPTIMIZATION_PLAN.md`

**Strategies Documented:**
1. ✅ Hash-based pre-filtering (ready to implement)
2. ✅ Partitioning by user_id (8 partitions)
3. ✅ Composite partial indexes
4. ✅ pgvector + HNSW alternative
5. ✅ Multi-stage filtering

**Expected Final Performance:** 10-20ms (when all optimizations applied)

## Immediate Actions Required

### 1. Free Up Disk Space (CRITICAL)
```bash
# Check Docker volume size
docker system df

# Check PostgreSQL data directory size
du -sh $(docker volume inspect pgdata | jq -r '.[0].Mountpoint')

# Options:
# - Remove unused Docker images/containers
# - Expand Docker volume
# - Move PostgreSQL data to external storage
# - Clean up old backups/logs
```

### 2. Once Space Available
```bash
# Step 1: Add hash pre-filtering
./scripts/add-hash-pre-filter.sh

# Step 2: Recreate function (uses hash)
./scripts/create-knn-function.sh

# Step 3: Test performance
PGHOST=localhost PGPORT=5432 PGUSER=postgres PGDATABASE=records PGPASSWORD=postgres \
psql -c "EXPLAIN ANALYZE SELECT count(*) FROM public.search_records_fuzzy_ids(...)"

# Step 4: Tune parameters if needed
./scripts/tune-function-parameters.sh
```

### 3. If Still Not at Target
- Consider partitioning (see `DEEP_OPTIMIZATION_PLAN.md`)
- Evaluate pgvector/HNSW (see plan)
- Further parameter tuning

## Current Function Configuration

**Strategy:** High-threshold GIN % with optional hash pre-filtering

**Parameters:**
- `high_trgm_limit`: 0.60 (optimal balance, ~136 matches)
- `candidate_cap`: 300 rows
- `hard_min_rank`: 0.20

**Function Design:**
- Uses `set_limit(0.60)` to reduce GIN % matches
- Optionally uses hash pre-filtering if column exists
- Gracefully falls back if hash column missing
- Supports aliases if view exists

## Performance Metrics

### Current (High-Threshold GIN %)
- **Execution time:** 640ms
- **Buffer reads:** 26k buffers (~200MB)
- **Rows processed:** ~136 candidates → 50 results
- **Index used:** `idx_records_search_norm_gin_user0` (GIN)

### Target
- **Execution time:** 20ms
- **Buffer reads:** <1k buffers (<10MB)
- **Rows processed:** <500 candidates → 50 results

### Expected After Hash Pre-Filtering
- **Execution time:** 50-100ms (6-12x improvement)
- **Buffer reads:** ~2-5k buffers (~20-40MB)
- **Rows processed:** ~2k hash matches → ~136 trigram → 50 results

## Files Created

1. **DEEP_OPTIMIZATION_PLAN.md** - Complete optimization strategy
2. **PERFORMANCE_OPTIMIZATION_STATUS.md** - Detailed status tracking
3. **scripts/add-hash-pre-filter.sh** - Hash pre-filtering setup
4. **scripts/tune-function-parameters.sh** - Parameter tuning tool
5. **scripts/create-knn-function.sh** - Updated function (supports hash)
6. **scripts/cluster-table-for-knn.sh** - Table clustering (blocked)

## Next Steps Summary

1. **FREE UP DISK SPACE** ⚠️ (critical blocker)
2. Run hash pre-filtering script
3. Test performance improvement
4. Tune parameters if needed
5. Consider partitioning if still not at target
6. Evaluate pgvector/HNSW if needed

## Notes

- Function is designed to work with/without hash column
- All optimizations are documented and ready to implement
- Current 640ms is best achievable without disk space
- Expected 32-128x improvement when optimizations can be applied

