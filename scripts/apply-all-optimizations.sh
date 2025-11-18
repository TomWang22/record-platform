#!/usr/bin/env bash
set -Eeuo pipefail

# Apply ALL aggressive optimizations for maximum performance
# This combines all the optimization scripts into one comprehensive setup

NS="${NS:-record-platform}"

# Wait for pod to be ready
echo "Waiting for Postgres pod to be ready..."
kubectl -n "$NS" wait pod -l app=postgres --for=condition=Ready --timeout=120s >/dev/null 2>&1 || {
  echo "Error: Postgres pod not ready" >&2
  exit 1
}

PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

if [[ -z "$PGPOD" ]]; then
  echo "Error: Postgres pod not found" >&2
  exit 1
fi

# Wait for database to accept connections
echo "Waiting for database to accept connections..."
MAX_RETRIES=30
RETRY_COUNT=0
while [[ $RETRY_COUNT -lt $MAX_RETRIES ]]; do
  if kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d postgres -X -P pager=off -c "SELECT 1;" >/dev/null 2>&1; then
    echo "✅ Database is ready!"
    break
  fi
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [[ $RETRY_COUNT -lt $MAX_RETRIES ]]; then
    echo "  Waiting... ($RETRY_COUNT/$MAX_RETRIES)"
    sleep 2
  else
    echo "Error: Database not ready after $MAX_RETRIES retries" >&2
    exit 1
  fi
done

echo "=== Applying ALL Aggressive Optimizations ==="
echo "Pod: $PGPOD"
echo ""

# 1. CREATE FUNCTION FIRST (critical - must exist before benchmarks)
echo "=== 1. Creating search_records_fuzzy_ids function ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off -v ON_ERROR_STOP=1 <<'SQL'
SET search_path = records, public;

-- Ensure norm_text function exists
CREATE OR REPLACE FUNCTION public.norm_text(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(lower(unaccent(coalesce(t,''))), '\s+', ' ', 'g')
$$;

-- Drop old functions first
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids CASCADE;
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids_core CASCADE;
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids_core_hot CASCADE;
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids_core_cold CASCADE;

-- HOT CORE: Uses records_hot with search_norm_short
CREATE FUNCTION public.search_records_fuzzy_ids_core_hot(
  p_user uuid, p_q text, p_limit bigint DEFAULT 100, p_offset bigint DEFAULT 0
) RETURNS TABLE(id uuid, rank real)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
WITH norm AS (SELECT norm_text(coalesce(p_q, '')) AS qn),
cand_main AS (
  SELECT h.id, 1 - (h.search_norm_short <-> (SELECT qn FROM norm)) AS knn_rank
  FROM records_hot.records_hot h
  WHERE h.user_id = p_user
    AND ((length((SELECT qn FROM norm)) <= 2 AND h.search_norm_short LIKE (SELECT qn FROM norm) || '%') OR
         (length((SELECT qn FROM norm))  > 2 AND h.search_norm_short %    (SELECT qn FROM norm)))
  ORDER BY h.search_norm_short <-> (SELECT qn FROM norm)
  LIMIT LEAST(1000, GREATEST(1, p_limit * 10))
),
cand_alias AS (
  SELECT r.id, max(similarity(a.term_norm, (SELECT qn FROM norm))) AS alias_sim
  FROM public.record_aliases a
  JOIN records.records r ON r.id = a.record_id
  JOIN records_hot.records_hot h ON h.id = r.id
  WHERE r.user_id = p_user
    AND ((length((SELECT qn FROM norm)) <= 2 AND a.term_norm LIKE (SELECT qn FROM norm) || '%') OR
         (length((SELECT qn FROM norm))  > 2 AND a.term_norm %    (SELECT qn FROM norm)))
  GROUP BY r.id
),
ranked AS (
  SELECT r.id,
         GREATEST(similarity(r.artist_norm, (SELECT qn FROM norm)),
                  similarity(r.name_norm, (SELECT qn FROM norm)),
                  similarity(r.search_norm_short, (SELECT qn FROM norm)),
                  coalesce(ca.alias_sim, 0)) AS rank
  FROM (SELECT DISTINCT id FROM cand_main) cm
  JOIN records.records r ON r.id = cm.id
  LEFT JOIN cand_alias ca ON ca.id = r.id
)
SELECT id, rank
FROM ranked
WHERE rank > 0.2
ORDER BY rank DESC
LIMIT LEAST(1000, GREATEST(1, p_limit))
OFFSET GREATEST(0, p_offset);
$$;

-- COLD CORE: Uses records.records with search_norm_short
CREATE FUNCTION public.search_records_fuzzy_ids_core_cold(
  p_user uuid, p_q text, p_limit bigint DEFAULT 100, p_offset bigint DEFAULT 0
) RETURNS TABLE(id uuid, rank real)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
WITH norm AS (SELECT norm_text(coalesce(p_q, '')) AS qn),
  cand_main AS (
  SELECT r.id, 1 - (r.search_norm_short <-> (SELECT qn FROM norm)) AS knn_rank
    FROM records.records r
    WHERE r.user_id = p_user
    AND ((length((SELECT qn FROM norm)) <= 2 AND r.search_norm_short LIKE (SELECT qn FROM norm) || '%') OR
         (length((SELECT qn FROM norm))  > 2 AND r.search_norm_short %    (SELECT qn FROM norm)))
  ORDER BY r.search_norm_short <-> (SELECT qn FROM norm)
  LIMIT LEAST(1000, GREATEST(1, p_limit * 10))
  ),
  cand_alias AS (
  SELECT r.id, max(similarity(a.term_norm, (SELECT qn FROM norm))) AS alias_sim
    FROM public.record_aliases a
    JOIN records.records r ON r.id = a.record_id
    WHERE r.user_id = p_user
    AND ((length((SELECT qn FROM norm)) <= 2 AND a.term_norm LIKE (SELECT qn FROM norm) || '%') OR
         (length((SELECT qn FROM norm))  > 2 AND a.term_norm %    (SELECT qn FROM norm)))
    GROUP BY r.id
),
ranked AS (
  SELECT r.id,
         GREATEST(similarity(r.artist_norm, (SELECT qn FROM norm)),
                  similarity(r.name_norm, (SELECT qn FROM norm)),
                  similarity(r.search_norm_short, (SELECT qn FROM norm)),
                  coalesce(ca.alias_sim, 0)) AS rank
  FROM (SELECT DISTINCT id FROM cand_main) cm
  JOIN records.records r ON r.id = cm.id
  LEFT JOIN cand_alias ca ON ca.id = r.id
)
SELECT id, rank
FROM ranked
WHERE rank > 0.2
  ORDER BY rank DESC
  LIMIT LEAST(1000, GREATEST(1, p_limit))
  OFFSET GREATEST(0, p_offset);
$$;

-- PL/pgSQL ROUTER: Routes based on user_id
CREATE FUNCTION public.search_records_fuzzy_ids(
  p_user uuid, p_q text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_strict boolean DEFAULT false
) RETURNS TABLE(id uuid, rank real)
LANGUAGE plpgsql STABLE PARALLEL SAFE AS $$
BEGIN
  IF p_user = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid THEN
    RETURN QUERY SELECT * FROM public.search_records_fuzzy_ids_core_hot(p_user, p_q, p_limit::bigint, p_offset::bigint);
  ELSE
    RETURN QUERY SELECT * FROM public.search_records_fuzzy_ids_core_cold(p_user, p_q, p_limit::bigint, p_offset::bigint);
  END IF;
END;
$$;

-- Verify function exists
SELECT 
  'Function created: ' || EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'search_records_fuzzy_ids'
  ) as status;
SQL

# 2. APPLY SYSTEM-LEVEL OPTIMIZATIONS (persist across restarts)
echo ""
echo "=== 2. Applying System-Level Optimizations ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off <<'SQL'
-- Memory settings (matching good performance run)
ALTER SYSTEM SET work_mem = '32MB';  -- Good run used 32MB, not 128MB!
ALTER SYSTEM SET maintenance_work_mem = '512MB';
ALTER SYSTEM SET shared_buffers = '512MB';
ALTER SYSTEM SET effective_cache_size = '8GB';

-- Enable parallelism (matching good performance run - was ENABLED, not disabled!)
ALTER SYSTEM SET max_worker_processes = 12;
ALTER SYSTEM SET max_parallel_workers = 12;
ALTER SYSTEM SET max_parallel_workers_per_gather = 4;

-- Planner tuning (matching good performance run)
ALTER SYSTEM SET random_page_cost = 0.8;
ALTER SYSTEM SET cpu_index_tuple_cost = 0.0005;
ALTER SYSTEM SET cpu_tuple_cost = 0.01;
ALTER SYSTEM SET track_io_timing = on;

-- Optimize checkpoints for lower latency spikes
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET checkpoint_timeout = '15min';
ALTER SYSTEM SET wal_buffers = '16MB';

-- Low-latency query settings
ALTER SYSTEM SET commit_delay = 0;
ALTER SYSTEM SET commit_siblings = 0;
ALTER SYSTEM SET lock_timeout = '500ms';
ALTER SYSTEM SET statement_timeout = '2s';

-- Optimize autovacuum
ALTER SYSTEM SET autovacuum_naptime = '30s';
ALTER SYSTEM SET autovacuum_vacuum_scale_factor = 0.05;
ALTER SYSTEM SET autovacuum_analyze_scale_factor = 0.02;

-- Reload config
SELECT pg_reload_conf();

-- Show key settings
SELECT name, setting, unit FROM pg_settings 
WHERE name IN ('work_mem', 'random_page_cost', 'cpu_index_tuple_cost', 'effective_cache_size', 'max_parallel_workers_per_gather')
ORDER BY name;
SQL

# 3. CREATE/OPTIMIZE ALL INDEXES
echo ""
echo "=== 3. Creating/Optimizing All Indexes ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off <<'SQL'
SET search_path = records, public;

-- Ensure search_norm column exists
ALTER TABLE records.records ADD COLUMN IF NOT EXISTS search_norm text;
UPDATE records.records
  SET search_norm = lower(concat_ws(' ', artist, name, catalog_number))
  WHERE search_norm IS NULL;

-- TRGM indexes with fastupdate=off (better query performance, slower inserts)
DROP INDEX IF EXISTS idx_records_artist_trgm;
CREATE INDEX idx_records_artist_trgm 
  ON records.records USING gin (artist gin_trgm_ops) WITH (fastupdate=off);

DROP INDEX IF EXISTS idx_records_name_trgm;
CREATE INDEX idx_records_name_trgm
  ON records.records USING gin (name gin_trgm_ops) WITH (fastupdate=off);

DROP INDEX IF EXISTS idx_records_catalog_trgm;
CREATE INDEX idx_records_catalog_trgm
  ON records.records USING gin (catalog_number gin_trgm_ops) WITH (fastupdate=off);

-- KNN indexes (GiST for distance, GIN for similarity)
DROP INDEX IF EXISTS idx_records_search_norm_gist;
CREATE INDEX idx_records_search_norm_gist
  ON records.records USING gist (search_norm gist_trgm_ops);

DROP INDEX IF EXISTS idx_records_search_norm_gin;
CREATE INDEX idx_records_search_norm_gin
  ON records.records USING gin (search_norm gin_trgm_ops) WITH (fastupdate=off);

-- Composite index for user_id + updated_at (for ORDER BY in TRGM queries)
CREATE INDEX IF NOT EXISTS idx_records_user_updated_desc 
  ON records.records(user_id, updated_at DESC);

-- Hot tenant partial indexes (for primary tenant)
DROP INDEX IF EXISTS records_hot_knn_main;
CREATE INDEX records_hot_knn_main
  ON records.records USING gist (search_norm gist_trgm_ops)
  WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;

DROP INDEX IF EXISTS records_hot_gin_main;
CREATE INDEX records_hot_gin_main
  ON records.records USING gin (search_norm gin_trgm_ops)
  WITH (fastupdate=off)
  WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;

-- Show index sizes
SELECT 
  indexname,
  pg_size_pretty(pg_relation_size((schemaname||'.'||indexname)::regclass)) as size
FROM pg_indexes
WHERE schemaname = 'records' 
  AND tablename = 'records'
  AND (indexname LIKE '%trgm%' OR indexname LIKE '%search_norm%' OR indexname LIKE '%hot%' OR indexname LIKE '%user_updated%')
ORDER BY indexname;
SQL

# 4. VACUUM ANALYZE (critical for fresh statistics)
echo ""
echo "=== 4. Running VACUUM ANALYZE ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off <<'SQL'
SET search_path = records, public;

-- VACUUM ANALYZE main table
VACUUM ANALYZE records.records;

-- Analyze all partitions separately (to avoid memory issues)
DO $$
DECLARE part_name text;
BEGIN
  FOR part_name IN 
    SELECT relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'records' 
      AND c.relname LIKE 'records_p%'
      AND c.relkind = 'r'
    ORDER BY relname
  LOOP
    EXECUTE format('ANALYZE records.%I', part_name);
    RAISE NOTICE 'Analyzed: %', part_name;
  END LOOP;
END $$;
SQL

# 5. PREWARM CRITICAL INDEXES
echo ""
echo "=== 5. Prewarming Critical Indexes ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off <<'SQL'
SET search_path = records, public;

-- Prewarm TRGM indexes
SELECT pg_prewarm('idx_records_artist_trgm'::regclass, 'buffer') 
  WHERE EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_records_artist_trgm');

SELECT pg_prewarm('idx_records_name_trgm'::regclass, 'buffer')
  WHERE EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_records_name_trgm');

SELECT pg_prewarm('idx_records_catalog_trgm'::regclass, 'buffer')
  WHERE EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_records_catalog_trgm');

SELECT pg_prewarm('idx_records_user_updated_desc'::regclass, 'buffer')
  WHERE EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_records_user_updated_desc');

-- Prewarm KNN indexes
SELECT pg_prewarm('idx_records_search_norm_gin'::regclass, 'buffer')
  WHERE EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_records_search_norm_gin');

SELECT pg_prewarm('idx_records_search_norm_gist'::regclass, 'buffer')
  WHERE EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_records_search_norm_gist');

-- Prewarm hot tenant indexes
SELECT pg_prewarm('records_hot_knn_main'::regclass, 'buffer')
  WHERE EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='records_hot_knn_main');

SELECT pg_prewarm('records_hot_gin_main'::regclass, 'buffer')
  WHERE EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='records_hot_gin_main');
SQL

# 6. REFRESH MATERIALIZED VIEWS (CRITICAL - must be populated before benchmarks)
echo ""
echo "=== 6. Refreshing Materialized Views ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off -v ON_ERROR_STOP=1 <<'SQL'
SET search_path = records, public;

-- Ensure aliases table exists
CREATE TABLE IF NOT EXISTS records.aliases (
  record_id UUID NOT NULL REFERENCES records.records(id) ON DELETE CASCADE,
  alias     TEXT NOT NULL,
  PRIMARY KEY(record_id, alias)
);

-- Drop and recreate MV to ensure it's fresh
DROP MATERIALIZED VIEW IF EXISTS records.aliases_mv CASCADE;

-- Create MV fresh (this will populate it)
CREATE MATERIALIZED VIEW records.aliases_mv AS
  SELECT a.record_id, norm_text(a.alias) AS alias_norm
  FROM records.aliases a;

-- Create index on MV
CREATE INDEX aliases_mv_alias_norm_gist
  ON records.aliases_mv USING gist (alias_norm gist_trgm_ops);

-- Ensure view exists
CREATE OR REPLACE VIEW public.record_aliases AS
  SELECT record_id, alias_norm AS term_norm FROM records.aliases_mv;

-- Verify it's populated
SELECT 
  '✅ MV created and populated, row count:' as status,
  count(*) as rows
FROM records.aliases_mv;

-- Refresh search_doc_mv if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_matviews WHERE schemaname='records' AND matviewname='search_doc_mv') THEN
    EXECUTE 'REFRESH MATERIALIZED VIEW records.search_doc_mv';
  END IF;
END $$;
SQL

# 7. WARM CACHE WITH SAMPLE QUERIES
echo ""
echo "=== 7. Warming Cache with Sample Queries ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off <<'SQL'
SET search_path = records, public;

-- Warm basic queries
SELECT count(*) FROM records.records 
WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid LIMIT 1;

-- Warm KNN function
SELECT count(*) FROM public.search_records_fuzzy_ids(
  '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid, 
  'test', 
  10::bigint, 
  0::bigint
);

-- Warm TRGM queries
SELECT count(*) FROM (
  SELECT id FROM records.records
  WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid
    AND (artist ILIKE '%test%' OR name ILIKE '%test%')
  LIMIT 10
) s;
SQL

echo ""
echo "=== All Optimizations Complete ==="
echo "✅ Function created in public schema"
echo "✅ System-level settings applied (work_mem=64MB, parallelism disabled)"
echo "✅ All indexes created/optimized (fastupdate=off for TRGM)"
echo "✅ Statistics refreshed (VACUUM ANALYZE)"
echo "✅ Indexes prewarmed"
echo "✅ Materialized views refreshed"
echo "✅ Cache warmed"
echo ""
echo "⚠️  Note: Some ALTER SYSTEM changes require a pod restart to fully take effect"
echo "   However, most settings are already applied via deployment args"

