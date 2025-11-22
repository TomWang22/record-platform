#!/usr/bin/env bash
set -Eeuo pipefail

# Comprehensive optimization script based on:
# - infra/db/44-optimize-planner.sql
# - infra/db/43-optimize-knn-trgm.sql
# - PostgreSQL GPT recommendations
# - Past backup configurations

NS="${NS:-record-platform}"
HOT_TENANT_UUID="${HOT_TENANT_UUID:-0dc268d0-a86f-4e12-8d10-9db0f1b735e0}"

PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

if [[ -z "$PGPOD" ]]; then
  echo "Error: Postgres pod not found" >&2
  exit 1
fi

echo "=== Comprehensive Optimization Script ==="
echo "Pod: $PGPOD"
echo "Hot tenant: $HOT_TENANT_UUID"
echo ""

kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off -v ON_ERROR_STOP=1 <<SQL
SET search_path = public, records;

-- ============================================================================
-- STEP 1: Create records_hot schema (table will be created by run_pgbench_sweep.sh)
-- ============================================================================
\echo '=== Step 1: Creating records_hot schema ==='
CREATE SCHEMA IF NOT EXISTS records_hot;

-- NOTE: records_hot.records_hot table will be created by run_pgbench_sweep.sh
-- We don't create it here to avoid conflicts with the proper CREATE TABLE AS

-- ============================================================================
-- STEP 2: Ensure search_norm_short exists on records.records
-- ============================================================================
\echo ''
\echo '=== Step 2: Ensuring search_norm_short on records.records ==='
ALTER TABLE records.records ADD COLUMN IF NOT EXISTS search_norm_short text;

-- Populate search_norm_short (truncate to 256 chars)
UPDATE records.records
SET search_norm_short = left(search_norm, 256)
WHERE search_norm_short IS NULL OR search_norm_short != left(search_norm, 256);

-- ============================================================================
-- STEP 3: Create indexes on search_norm_short (per PostgreSQL GPT)
-- ============================================================================
\echo ''
\echo '=== Step 3: Creating indexes on search_norm_short ==='

-- On records.records
CREATE INDEX IF NOT EXISTS idx_records_search_norm_short_gist 
  ON records.records USING gist(search_norm_short gist_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_records_search_norm_short_gin 
  ON records.records USING gin(search_norm_short gin_trgm_ops) WITH (fastupdate=off);

-- On records_hot.records_hot
CREATE INDEX IF NOT EXISTS records_hot_search_norm_short_gist 
  ON records_hot.records_hot USING gist(search_norm_short gist_trgm_ops);

CREATE INDEX IF NOT EXISTS records_hot_search_norm_short_gin 
  ON records_hot.records_hot USING gin(search_norm_short gin_trgm_ops) WITH (fastupdate=off);

-- Also ensure existing indexes exist (from 43-optimize-knn-trgm.sql)
CREATE INDEX IF NOT EXISTS idx_records_search_norm_gist
  ON records.records USING gist (search_norm gist_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_records_search_norm_gin
  ON records.records USING gin (search_norm gin_trgm_ops);

-- Hot tenant partial indexes (from 43-optimize-knn-trgm.sql)
CREATE INDEX IF NOT EXISTS records_hot_knn_main
  ON records.records USING gist (search_norm gist_trgm_ops)
  WHERE user_id = '${HOT_TENANT_UUID}'::uuid;

CREATE INDEX IF NOT EXISTS records_hot_gin_main
  ON records.records USING gin (search_norm gin_trgm_ops)
  WITH (fastupdate=off)
  WHERE user_id = '${HOT_TENANT_UUID}'::uuid;

-- TRGM indexes (from 43-optimize-knn-trgm.sql)
CREATE INDEX IF NOT EXISTS idx_records_artist_trgm 
  ON records.records USING gin (artist gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_records_name_trgm
  ON records.records USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_records_catalog_trgm
  ON records.records USING gin (catalog_number gin_trgm_ops);

-- ============================================================================
-- STEP 4: Create hot/cold core functions (per PostgreSQL GPT)
-- ============================================================================
\echo ''
\echo '=== Step 4: Creating hot/cold core functions ==='

-- Drop old functions
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids CASCADE;
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids_core CASCADE;
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids_core_hot CASCADE;
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids_core_cold CASCADE;

-- Ensure norm_text function exists
CREATE OR REPLACE FUNCTION public.norm_text(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS \$\$
  SELECT regexp_replace(lower(unaccent(coalesce(t,''))), '\s+', ' ', 'g')
\$\$;

-- HOT CORE: Uses records_hot with search_norm_short
CREATE FUNCTION public.search_records_fuzzy_ids_core_hot(
  p_user   uuid,
  p_q      text,
  p_limit  bigint DEFAULT 100,
  p_offset bigint DEFAULT 0
)
RETURNS TABLE(id uuid, rank real)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS \$\$
WITH norm AS (
  SELECT norm_text(coalesce(p_q, '')) AS qn
),
cand_main AS (
  SELECT h.id, 1 - (h.search_norm_short <-> (SELECT qn FROM norm)) AS knn_rank
  FROM records_hot.records_hot h
  WHERE h.user_id = p_user
    AND (
      (length((SELECT qn FROM norm)) <= 2 AND h.search_norm_short LIKE (SELECT qn FROM norm) || '%') OR
      (length((SELECT qn FROM norm))  > 2 AND h.search_norm_short %    (SELECT qn FROM norm))
    )
  ORDER BY h.search_norm_short <-> (SELECT qn FROM norm)
  LIMIT LEAST(1000, GREATEST(1, p_limit * 10))
),
cand_alias AS (
  SELECT r.id, max(similarity(a.term_norm, (SELECT qn FROM norm))) AS alias_sim
  FROM public.record_aliases a
  JOIN records.records r ON r.id = a.record_id
  JOIN records_hot.records_hot h ON h.id = r.id
  WHERE r.user_id = p_user
    AND (
      (length((SELECT qn FROM norm)) <= 2 AND a.term_norm LIKE (SELECT qn FROM norm) || '%') OR
      (length((SELECT qn FROM norm))  > 2 AND a.term_norm %    (SELECT qn FROM norm))
    )
  GROUP BY r.id
),
ranked AS (
  SELECT r.id,
         GREATEST(
           similarity(r.artist_norm,       (SELECT qn FROM norm)),
           similarity(r.name_norm,         (SELECT qn FROM norm)),
           similarity(r.search_norm_short, (SELECT qn FROM norm)),
           coalesce(ca.alias_sim, 0)
         ) AS rank
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
\$\$;

-- COLD CORE: Uses records.records with search_norm_short
CREATE FUNCTION public.search_records_fuzzy_ids_core_cold(
  p_user   uuid,
  p_q      text,
  p_limit  bigint DEFAULT 100,
  p_offset bigint DEFAULT 0
)
RETURNS TABLE(id uuid, rank real)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS \$\$
WITH norm AS (
  SELECT norm_text(coalesce(p_q, '')) AS qn
),
cand_main AS (
  SELECT r.id, 1 - (r.search_norm_short <-> (SELECT qn FROM norm)) AS knn_rank
  FROM records.records r
  WHERE r.user_id = p_user
    AND (
      (length((SELECT qn FROM norm)) <= 2 AND r.search_norm_short LIKE (SELECT qn FROM norm) || '%') OR
      (length((SELECT qn FROM norm))  > 2 AND r.search_norm_short %    (SELECT qn FROM norm))
    )
  ORDER BY r.search_norm_short <-> (SELECT qn FROM norm)
  LIMIT LEAST(1000, GREATEST(1, p_limit * 10))
),
cand_alias AS (
  SELECT r.id, max(similarity(a.term_norm, (SELECT qn FROM norm))) AS alias_sim
  FROM public.record_aliases a
  JOIN records.records r ON r.id = a.record_id
  WHERE r.user_id = p_user
    AND (
      (length((SELECT qn FROM norm)) <= 2 AND a.term_norm LIKE (SELECT qn FROM norm) || '%') OR
      (length((SELECT qn FROM norm))  > 2 AND a.term_norm %    (SELECT qn FROM norm))
    )
  GROUP BY r.id
),
ranked AS (
  SELECT r.id,
         GREATEST(
           similarity(r.artist_norm,       (SELECT qn FROM norm)),
           similarity(r.name_norm,         (SELECT qn FROM norm)),
           similarity(r.search_norm_short, (SELECT qn FROM norm)),
           coalesce(ca.alias_sim, 0)
         ) AS rank
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
\$\$;

-- PL/pgSQL ROUTER: Routes based on user_id
CREATE FUNCTION public.search_records_fuzzy_ids(
  p_user   uuid,
  p_q      text,
  p_limit  integer DEFAULT 100,
  p_offset integer DEFAULT 0,
  p_strict boolean DEFAULT false
)
RETURNS TABLE(id uuid, rank real)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS \$\$
BEGIN
  IF p_user = '${HOT_TENANT_UUID}'::uuid THEN
    RETURN QUERY
      SELECT * FROM public.search_records_fuzzy_ids_core_hot(
        p_user, p_q, p_limit::bigint, p_offset::bigint
      );
  ELSE
    RETURN QUERY
      SELECT * FROM public.search_records_fuzzy_ids_core_cold(
        p_user, p_q, p_limit::bigint, p_offset::bigint
      );
  END IF;
END;
\$\$;

-- ============================================================================
-- STEP 5: Apply planner optimizations (from 44-optimize-planner.sql)
-- ============================================================================
\echo ''
\echo '=== Step 5: Applying planner optimizations ==='

-- Aggressive planner tuning for SSD (from 44-optimize-planner.sql)
ALTER SYSTEM SET random_page_cost = 0.8;
ALTER SYSTEM SET cpu_index_tuple_cost = 0.0005;
ALTER SYSTEM SET cpu_tuple_cost = 0.01;
ALTER SYSTEM SET effective_cache_size = '8GB';

-- Also set at database level for immediate effect
ALTER DATABASE records SET random_page_cost = 0.8;
ALTER DATABASE records SET cpu_index_tuple_cost = 0.0005;
ALTER DATABASE records SET cpu_tuple_cost = 0.01;
ALTER DATABASE records SET effective_cache_size = '8GB';
ALTER DATABASE records SET work_mem = '64MB';
ALTER DATABASE records SET track_io_timing = on;

-- ============================================================================
-- STEP 6: VACUUM ANALYZE (from 44-optimize-planner.sql)
-- ============================================================================
\echo ''
\echo '=== Step 6: Running VACUUM ANALYZE ==='

VACUUM ANALYZE records.records;

-- Analyze all partitions if they exist
DO \$\$
DECLARE
  part_name text;
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
END \$\$;

ANALYZE records_hot.records_hot;

-- ============================================================================
-- STEP 7: Verify everything
-- ============================================================================
\echo ''
\echo '=== Step 7: Verification ==='

SELECT 
  'Functions' AS category,
  count(*) FILTER (WHERE proname LIKE 'search_records_fuzzy_ids%') AS count
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
UNION ALL
SELECT 
  'Indexes on search_norm_short',
  count(*)
FROM pg_indexes
WHERE schemaname IN ('records', 'records_hot')
  AND indexname LIKE '%search_norm_short%'
UNION ALL
SELECT 
  'records_hot rows',
  count(*)
FROM records_hot.records_hot;

\echo ''
\echo '✅ Comprehensive optimization complete!'
\echo '   Restart Postgres to apply ALTER SYSTEM changes.'
SQL

echo ""
echo "✅ All optimizations applied!"
echo ""
echo "Next steps:"
echo "  1. Restart Postgres to apply ALTER SYSTEM changes"
echo "  2. Populate records_hot.records_hot with hot slice data"
echo "  3. Warm cache"
echo "  4. Run benchmarks"

