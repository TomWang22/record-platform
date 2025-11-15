# Benchmark Fixes - November 12, 2025

## Issues Fixed

### 1. KNN Benchmark Using Wrong Query Path
**Problem:** The KNN benchmark was calling a raw KNN query that scanned the entire partition, resulting in ~1.5 TPS instead of the expected 200+ TPS.

**Fix:** Updated `scripts/run_pgbench_sweep.sh` to use `search_records_fuzzy_ids()` - the same function the API uses. This function:
- Uses the hot slice (`records_hot.records_hot`) when available
- Falls back to adaptive search paths
- Matches the production query path exactly

**Change:**
```sql
-- OLD (raw KNN scan)
SELECT count(*) FROM (
  SELECT r.id FROM records.records r
  WHERE r.user_id = :uid::uuid
  ORDER BY r.search_norm <-> :q
  LIMIT :lim
) s;

-- NEW (uses API function)
SELECT count(*) FROM (
  SELECT id FROM public.search_records_fuzzy_ids(
    :uid::uuid, :q::text, :lim::integer, 0::integer, false::boolean
  )
) s;
```

### 2. Missing Metrics in Benchmark Results
**Problem:** `active_sessions` and `cpu_share_pct` were empty in CSV output.

**Fix:** Added proper calculations:
- `active_sessions`: `delta_stmt_total_ms / (duration_s * 1000)` - average concurrent sessions
- `cpu_share_pct`: `(delta_stmt_total_ms - io_total_ms) / delta_stmt_total_ms * 100` - CPU vs I/O time percentage

### 3. Missing `disc_grade` Column
**Problem:** Prisma schema expected `disc_grade` but column didn't exist in database, causing API errors.

**Fix:** Added `disc_grade VARCHAR(16)` column to `records.record_media` table.

### 4. Stale Query Plans
**Problem:** Query plans may have been stale after partition migration.

**Fix:** Ran `VACUUM ANALYZE` on:
- Main partitioned table: `records.records`
- All 32 child partitions: `records_p00` through `records_p31`

## Redis Cache Verification

Redis is configured and accessible:
- URL: `redis://redis.record-platform.svc.cluster.local:6379`
- Lua singleflight script: `singleflight_cache.lua` (loaded via `cache.ts`)
- Cache invalidation: LISTEN/NOTIFY on `records_invalidate` channel

**Note:** Redis requires authentication. The records-service handles this via `REDIS_PASSWORD` env var.

## Expected Performance Improvements

With these fixes, KNN should now:
- Use the same query path as production API
- Hit Redis cache for repeated queries
- Use hot slice when available
- Show proper metrics (CPU share, active sessions)

**Target:** KNN TPS should improve from ~1.5 to 200+ TPS (matching previous 237-260 TPS reference).

## Next Steps

1. **Run benchmark:** `./scripts/run_pgbench_sweep.sh`
2. **Verify metrics:** Check that `active_sessions` and `cpu_share_pct` are populated
3. **Compare results:** KNN should now match API performance characteristics
4. **Monitor Redis:** Check cache hit rates via Redis INFO stats

## Additional Optimizations (Future)

Consider these for further improvements:
- Phonetic/n-gram tokenization for spelling variants
- Weighted scoring (first-press, rare editions)
- Autovacuum threshold tuning
- TOAST storage optimization
- I/O budgeting (shared_buffers, effective_io_concurrency)

