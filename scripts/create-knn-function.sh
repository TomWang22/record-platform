#!/usr/bin/env bash
set -Eeuo pipefail

# Create search_records_fuzzy_ids function (canonical 4-arg version)
# Works with external Postgres (Docker) or K8s pod
NS="${NS:-record-platform}"

echo "=== Creating search_records_fuzzy_ids function ==="

# Always use localhost:5432 to match run_pgbench_sweep.sh
# This ensures function creation and verification use the same database
: "${PGHOST:=localhost}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=records}"
: "${PGPASSWORD:=postgres}"

echo "Using Postgres at ${PGHOST}:${PGPORT}..."
PGPASSWORD="$PGPASSWORD" psql \
  -h "$PGHOST" -p "$PGPORT" \
  -U "$PGUSER" -d "$PGDATABASE" \
  -X -P pager=off -v ON_ERROR_STOP=1 <<'SQL'
SET search_path = records, public;

-- Ensure pg_trgm extension is loaded (required for <-> operator)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Drop ALL old variants first (including 5-arg wrapper and any _core functions)
-- IMPORTANT: Drop the 4-arg version too if it exists without SET search_path
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids(uuid, text, integer, integer, boolean) CASCADE;
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids(uuid, text, integer, integer) CASCADE;
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids(uuid, text, bigint, bigint) CASCADE;
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids_core CASCADE;
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids_core_hot CASCADE;
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids_core_cold CASCADE;

-- Ensure norm_text exists
CREATE OR REPLACE FUNCTION public.norm_text(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(lower(coalesce(t,'')), '\s+', ' ', 'g');
$$;

-- Create ONLY the canonical 4-arg function (bigint, bigint)
-- Use PL/pgSQL to ensure search_path is properly set and function is always found
CREATE FUNCTION public.search_records_fuzzy_ids(
  p_user UUID, p_q TEXT, p_limit bigint DEFAULT 100, p_offset bigint DEFAULT 0
) RETURNS TABLE(id UUID, rank real)
LANGUAGE plpgsql STABLE PARALLEL SAFE
SET search_path = records, public, pg_catalog
AS $$
DECLARE
  qn TEXT;
BEGIN
  qn := public.norm_text(COALESCE(p_q,''));
  RETURN QUERY
  WITH cand_main AS (
    SELECT r.id, 1 - (r.search_norm <-> qn) AS knn_rank
    FROM records.records r
    WHERE r.user_id = p_user
      AND (
        (length(qn) <= 2 AND r.search_norm LIKE qn || '%') OR
        (length(qn)  > 2 AND r.search_norm % qn)
      )
    ORDER BY r.search_norm <-> qn
    LIMIT LEAST(1000, GREATEST(1, p_limit*10))
  ),
  cand_alias AS (
    SELECT DISTINCT r.id, max(similarity(a.term_norm, qn)) AS alias_sim
    FROM public.record_aliases a
    JOIN records.records r ON r.id = a.record_id
    WHERE r.user_id = p_user
      AND (
        (length(qn) <= 2 AND a.term_norm LIKE qn || '%') OR
        (length(qn)  > 2 AND a.term_norm % qn)
      )
    GROUP BY r.id
  )
  SELECT r.id,
         GREATEST(
           similarity(r.artist_norm, qn),
           similarity(r.name_norm,   qn),
           similarity(r.search_norm, qn),
           COALESCE(ca.alias_sim,0)
         ) AS rank
  FROM (SELECT DISTINCT cand_main.id FROM cand_main) cm
  JOIN records.records r ON r.id = cm.id
  LEFT JOIN cand_alias ca ON ca.id = r.id
  WHERE GREATEST(
    similarity(r.artist_norm, qn),
    similarity(r.name_norm,   qn),
    similarity(r.search_norm, qn),
    COALESCE(ca.alias_sim,0)
  ) > 0.2
  ORDER BY rank DESC
  LIMIT LEAST(1000, GREATEST(1, p_limit))
  OFFSET GREATEST(0, p_offset);
END;
$$;

-- Verify the canonical 4-arg function exists
SELECT 
  n.nspname,
  p.proname,
  p.pronargs,
  p.proargtypes::regtype[]::text AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' 
  AND p.proname = 'search_records_fuzzy_ids'
  AND p.pronargs = 4
  AND p.proargtypes[0] = 'uuid'::regtype::oid
  AND p.proargtypes[1] = 'text'::regtype::oid
  AND p.proargtypes[2] = 'bigint'::regtype::oid
  AND p.proargtypes[3] = 'bigint'::regtype::oid;
SQL
FUNC_EXIT=$?

if [[ $FUNC_EXIT -eq 0 ]]; then
  echo "✅ Function created (canonical 4-arg version)"
else
  echo "❌ Function creation failed!" >&2
  exit 1
fi
