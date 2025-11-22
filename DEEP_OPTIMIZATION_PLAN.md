# Deep Optimization Plan: Hashing, Partitioning, Partial Indexes

**Goal:** Achieve 20ms execution time for fuzzy search queries  
**Current:** 640ms (32x slower than target)  
**Dataset:** 1.2M rows, single tenant benchmark has ~1M+ records

## Current State Analysis

### What Worked in Past (Empty DB)
- Old benchmark (`bench_sweep_20251119_022950.csv`) showed high TPS
- Likely because database was empty or had minimal data
- Current 1.2M row dataset exposes real performance bottlenecks

### Current Bottlenecks
1. **Large Index Size:** 199MB GiST index for single tenant
2. **High Buffer Reads:** 26k buffers (~200MB) per query
3. **Inefficient Index Usage:** GIN % still reading too many pages
4. **No Physical Locality:** Table not clustered by search pattern

## Optimization Strategies

### 1. Partitioning by user_id

**Strategy:** Partition the `records.records` table by `user_id` to create smaller, more manageable partitions.

**Benefits:**
- Smaller indexes per partition (199MB → ~20-50MB per partition)
- Faster index scans (less data to traverse)
- Better cache locality
- Can drop/archive old partitions easily

**Implementation:**
```sql
-- Create partitioned table
CREATE TABLE records.records_partitioned (
  LIKE records.records INCLUDING ALL
) PARTITION BY HASH (user_id);

-- Create partitions (e.g., 8 partitions)
CREATE TABLE records.records_p0 PARTITION OF records.records_partitioned
  FOR VALUES WITH (MODULUS 8, REMAINDER 0);

CREATE TABLE records.records_p1 PARTITION OF records.records_partitioned
  FOR VALUES WITH (MODULUS 8, REMAINDER 1);
-- ... repeat for p2-p7

-- Create partial indexes per partition
CREATE INDEX idx_records_p0_search_norm_gin
ON records.records_p0
USING gin (search_norm gin_trgm_ops)
WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;
```

**Expected Impact:**
- Index size: 199MB → ~25MB per partition (8 partitions)
- Buffer reads: 26k → ~3k per partition
- Execution time: 640ms → ~80-100ms (8x improvement)

### 2. Hash-Based Pre-filtering

**Strategy:** Add a hash column on normalized search text to create a fast pre-filter before trigram matching.

**Benefits:**
- Fast hash comparison (O(1)) before expensive trigram operations
- Reduces candidate set dramatically
- Can use btree index on hash (very fast)

**Implementation:**
```sql
-- Add hash column
ALTER TABLE records.records
ADD COLUMN search_norm_hash integer;

-- Populate hash (using PostgreSQL hash function)
UPDATE records.records
SET search_norm_hash = hashtext(search_norm)
WHERE search_norm_hash IS NULL;

-- Create btree index on hash
CREATE INDEX idx_records_search_norm_hash_btree
ON records.records (user_id, search_norm_hash);

-- Modified function uses hash pre-filter
CREATE OR REPLACE FUNCTION public.search_records_fuzzy_ids(
  p_user uuid,
  p_q text,
  p_limit bigint DEFAULT 100,
  p_offset bigint DEFAULT 0
) RETURNS TABLE(id uuid, rank real)
AS $$
DECLARE
  qn text;
  qn_hash integer;
BEGIN
  qn := public.norm_text(COALESCE(p_q, ''));
  qn_hash := hashtext(qn);
  
  RETURN QUERY
  WITH hash_candidates AS (
    -- Fast hash pre-filter (btree index scan)
    SELECT r.id
    FROM records.records r
    WHERE r.user_id = p_user
      AND r.search_norm_hash = qn_hash  -- Fast btree lookup
    LIMIT 1000  -- Cap hash matches
  ),
  trigram_candidates AS (
    -- Expensive trigram matching only on hash matches
    SELECT
      r.id,
      GREATEST(
        similarity(r.artist_norm, qn),
        similarity(r.name_norm, qn),
        similarity(r.search_norm, qn)
      ) AS sim
    FROM hash_candidates hc
    JOIN records.records r ON r.id = hc.id
    WHERE r.search_norm % qn  -- GIN trigram on small set
    ORDER BY sim DESC
    LIMIT 300
  )
  SELECT tc.id, tc.sim::real AS rank
  FROM trigram_candidates tc
  WHERE tc.sim >= 0.20
  ORDER BY tc.sim DESC
  LIMIT p_limit;
END;
$$;
```

**Expected Impact:**
- Hash lookup: ~1ms (btree index)
- Trigram matching: Only on ~1000 hash matches (vs 1M+ rows)
- Execution time: 640ms → ~20-50ms (12-32x improvement)

### 3. Composite Partial Indexes

**Strategy:** Create composite indexes that combine user_id filtering with search_norm indexing.

**Benefits:**
- Single index covers both filter and search
- Better index selectivity
- Reduced index size (only relevant rows)

**Implementation:**
```sql
-- Composite GIN index (user_id + search_norm)
-- Note: GIN can't directly index user_id, but we can use partial index
CREATE INDEX idx_records_user_search_gin
ON records.records
USING gin (search_norm gin_trgm_ops)
WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;

-- For hash approach, composite btree
CREATE INDEX idx_records_user_hash_btree
ON records.records (user_id, search_norm_hash)
WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;
```

**Expected Impact:**
- Index size: Smaller (only tenant's rows)
- Query plan: Single index scan (no filter step)
- Execution time: 10-20% improvement

### 4. pgvector + HNSW Alternative

**Strategy:** Use pgvector with HNSW index for approximate nearest neighbor search.

**Benefits:**
- HNSW is optimized for fast similarity search
- Can handle high-dimensional vectors
- Very fast approximate search

**Implementation:**
```sql
-- Install pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Add vector column (embed search_norm as vector)
ALTER TABLE records.records
ADD COLUMN search_vector vector(1536);  -- Adjust dimension based on embedding model

-- Populate vectors (using text embedding model)
-- This would require external service or model
UPDATE records.records
SET search_vector = embed_text(search_norm)  -- Pseudo-function
WHERE search_vector IS NULL;

-- Create HNSW index
CREATE INDEX idx_records_search_vector_hnsw
ON records.records
USING hnsw (search_vector vector_cosine_ops)
WITH (m = 16, ef_construction = 64)
WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;

-- Modified function uses vector similarity
CREATE OR REPLACE FUNCTION public.search_records_fuzzy_ids(
  p_user uuid,
  p_q text,
  p_limit bigint DEFAULT 100,
  p_offset bigint DEFAULT 0
) RETURNS TABLE(id uuid, rank real)
AS $$
DECLARE
  qn text;
  qv vector;
BEGIN
  qn := public.norm_text(COALESCE(p_q, ''));
  qv := embed_text(qn);  -- Convert query to vector
  
  RETURN QUERY
  SELECT
    r.id,
    (1 - (r.search_vector <=> qv))::real AS rank  -- Cosine distance
  FROM records.records r
  WHERE r.user_id = p_user
    AND r.search_vector IS NOT NULL
  ORDER BY r.search_vector <=> qv  -- HNSW index scan
  LIMIT p_limit;
END;
$$;
```

**Expected Impact:**
- HNSW index: Very fast approximate search
- Execution time: Potentially <20ms
- Trade-off: Requires embedding model, approximate results

### 5. Multi-Stage Filtering Strategy

**Strategy:** Combine multiple techniques: hash pre-filter → trigram matching → similarity scoring.

**Benefits:**
- Leverages strengths of each approach
- Fast pre-filtering reduces expensive operations
- Optimal balance of speed and accuracy

**Implementation:**
```sql
CREATE OR REPLACE FUNCTION public.search_records_fuzzy_ids(
  p_user uuid,
  p_q text,
  p_limit bigint DEFAULT 100,
  p_offset bigint DEFAULT 0
) RETURNS TABLE(id uuid, rank real)
AS $$
DECLARE
  qn text;
  qn_hash integer;
  old_limit real;
BEGIN
  qn := public.norm_text(COALESCE(p_q, ''));
  qn_hash := hashtext(qn);
  old_limit := show_limit();
  PERFORM set_limit(0.60);
  
  RETURN QUERY
  WITH stage1_hash AS (
    -- Stage 1: Fast hash pre-filter (btree)
    SELECT r.id
    FROM records.records r
    WHERE r.user_id = p_user
      AND r.search_norm_hash = qn_hash
    LIMIT 2000  -- Cap hash matches
  ),
  stage2_trigram AS (
    -- Stage 2: Trigram matching on hash matches (GIN)
    SELECT
      r.id,
      GREATEST(
        similarity(r.artist_norm, qn),
        similarity(r.name_norm, qn),
        similarity(r.search_norm, qn)
      ) AS sim
    FROM stage1_hash h
    JOIN records.records r ON r.id = h.id
    WHERE r.search_norm % qn  -- GIN trigram
    ORDER BY sim DESC
    LIMIT 500  -- Cap trigram matches
  )
  SELECT
    s.id,
    s.sim::real AS rank
  FROM stage2_trigram s
  WHERE s.sim >= 0.20
  ORDER BY s.sim DESC
  OFFSET GREATEST(0, p_offset)
  LIMIT p_limit;
  
  PERFORM set_limit(old_limit);
END;
$$;
```

**Expected Impact:**
- Stage 1 (hash): ~1ms, reduces 1M → 2k candidates
- Stage 2 (trigram): ~10-20ms on 2k candidates
- Total: ~20-30ms (target achieved!)

## Recommended Implementation Order

### Phase 1: Quick Wins (1-2 days)
1. ✅ **High-threshold GIN %** (already done, 640ms)
2. **Add hash column + btree index** (expected: 640ms → 50-100ms)
3. **Multi-stage filtering** (expected: 50-100ms → 20-30ms)

### Phase 2: Structural Changes (3-5 days)
4. **Partitioning by user_id** (expected: 20-30ms → 10-20ms)
5. **Composite partial indexes** (expected: 10-20ms → 5-15ms)

### Phase 3: Advanced (1-2 weeks)
6. **pgvector + HNSW** (if needed, expected: <20ms)
7. **Materialized views for hot tenants** (caching layer)

## Testing Strategy

### Parameter Tuning
```bash
# Test different combinations
./scripts/tune-function-parameters.sh

# Measure:
# - Execution time
# - Buffer reads
# - Rows processed
# - Recall/precision
```

### Benchmark Suite
```bash
# Run full benchmark
TRGM_THRESHOLD=0.60 ./scripts/run_pgbench_sweep.sh

# Compare:
# - TPS (transactions per second)
# - Latency (avg, p95, p99)
# - Buffer hit ratio
```

## Expected Final Performance

**Target:** 20ms execution time

**Path to Target:**
1. Current: 640ms
2. + Hash pre-filter: ~50-100ms (6-12x improvement)
3. + Multi-stage: ~20-30ms (2-3x improvement)
4. + Partitioning: ~10-20ms (1.5-2x improvement)
5. + Composite indexes: ~5-15ms (1.3-2x improvement)

**Total Expected Improvement:** 32-128x faster than current

## Next Steps

1. **Implement hash pre-filtering** (highest ROI)
2. **Test multi-stage filtering**
3. **Measure improvements**
4. **Consider partitioning if still not at target**
5. **Evaluate pgvector if needed**

## Notes

- **Disk Space:** Cannot cluster due to space constraints
- **Partitioning:** Requires schema migration (plan carefully)
- **pgvector:** Requires embedding model (external dependency)
- **Hash Collisions:** Monitor for false positives (should be rare)

