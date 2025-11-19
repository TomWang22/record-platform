# KNN Performance Issues & Solutions

## Current Problem
- KNN benchmark showing 0.0 TPS (hanging queries)
- Postgres pod OOM killed (exit code 137) during benchmark
- `search_records_fuzzy_ids()` function may not exist or is inefficient

## Root Causes

### 1. Missing Function
The `search_records_fuzzy_ids()` function may not be created. Check:
```sql
SELECT proname FROM pg_proc WHERE proname LIKE '%fuzzy%';
```

### 2. Missing Indexes
KNN requires GiST index on `search_norm`:
```sql
CREATE INDEX idx_records_search_norm_gist
  ON records.records USING gist (search_norm gist_trgm_ops);
```

### 3. Query Plan Issues
The function may be doing:
- Full table scans instead of index scans
- Not using hot slice (`records_hot.records_hot`)
- Not pruning partitions correctly

### 4. Memory Issues
- OOM kill suggests queries are too memory-intensive
- May need to reduce `work_mem` or query complexity
- Consider using `LIMIT` more aggressively

## Solutions

### Immediate Fixes

1. **Verify function exists:**
```sql
SELECT proname, pronamespace::regnamespace 
FROM pg_proc 
WHERE proname = 'search_records_fuzzy_ids';
```

2. **Create missing indexes:**
```sql
-- Main GiST index for KNN
CREATE INDEX IF NOT EXISTS idx_records_search_norm_gist
  ON records.records USING gist (search_norm gist_trgm_ops);

-- Hot tenant partial index
CREATE INDEX IF NOT EXISTS records_hot_knn_main
  ON records.records USING gist (search_norm gist_trgm_ops)
  WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;
```

3. **Run VACUUM ANALYZE:**
```sql
VACUUM ANALYZE records.records;
```

4. **Check query plan:**
```sql
SET enable_seqscan = off;
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM records.records
WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid
ORDER BY search_norm <-> 'test query'
LIMIT 50;
```

### Long-term Optimizations

1. **Use hot slice first:**
   - Check `records_hot.records_hot` before full table
   - Fall back to partition scan only if hot slice misses

2. **Partition pruning:**
   - Ensure `user_id` filter happens before KNN
   - Use partition-aware query planning

3. **Reduce memory usage:**
   - Lower `work_mem` for KNN queries
   - Use smaller `LIMIT` values
   - Consider materialized views for common queries

4. **Cache aggressively:**
   - Redis cache for KNN results
   - Prewarm hot queries
   - Use LISTEN/NOTIFY for invalidation

## TRGM Optimization for 5.1k TPS

### Current: ~3.8k TPS
### Target: 5.1k TPS at 64 clients, 12 threads

1. **Optimize indexes:**
```sql
-- Ensure fastupdate=off for better query performance
CREATE INDEX idx_records_artist_trgm 
  ON records.records USING gin (artist gin_trgm_ops) WITH (fastupdate=off);

CREATE INDEX idx_records_name_trgm
  ON records.records USING gin (name gin_trgm_ops) WITH (fastupdate=off);
```

2. **Reduce tail latency:**
   - Use `work_mem` tuning
   - Ensure partition pruning
   - Prewarm shared buffers

3. **Query optimization:**
   - Use `LIMIT` early
   - Avoid unnecessary joins
   - Use covering indexes where possible

