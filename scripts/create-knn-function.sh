#!/usr/bin/env bash
set -Eeuo pipefail

# Create the canonical search_records_fuzzy_ids function
# HIGH-THRESHOLD GIN % STRATEGY: Uses high similarity threshold with GIN index
# This avoids the slow KNN GiST scan and leverages GIN's efficient % operator

NS="${NS:-record-platform}"
# Use psql_in_pod if NS is set and PGHOST is not explicitly set to localhost
# Otherwise use localhost:5433 (Docker)
if [[ -n "${NS:-}" ]] && [[ "${NS}" != "localhost" ]] && [[ -z "${PGHOST:-}" ]]; then
  # We're in Kubernetes mode - function will be created via psql_in_pod in run_pgbench_sweep.sh
  # This script should not run directly in Kubernetes mode
  echo "⚠️  This script should be called from run_pgbench_sweep.sh in Kubernetes mode" >&2
  exit 1
fi
: "${PGHOST:=localhost}"
: "${PGPORT:=5433}"  # Changed to 5433 to match Docker port (avoids Postgres.app conflict)
: "${PGUSER:=postgres}"
: "${PGDATABASE:=records}"
: "${PGPASSWORD:=postgres}"

echo "=== Creating search_records_fuzzy_ids function ==="
echo "Using Postgres at ${PGHOST}:${PGPORT}..."

PGPASSWORD="$PGPASSWORD" psql \
  -h "$PGHOST" -p "$PGPORT" \
  -U "$PGUSER" -d "$PGDATABASE" \
  -X -P pager=off -v ON_ERROR_STOP=1 <<'SQL'
SET search_path = records, public, pg_catalog;

-- Ensure pg_trgm extension exists
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Drop old function signatures (cleanup)
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids(uuid, text, integer, integer, boolean);
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids(uuid, text, integer, integer);
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids(uuid, text);
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids(uuid, text, bigint, bigint);
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids_core();
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids_core_hot();
DROP FUNCTION IF EXISTS public.search_records_fuzzy_ids_core_cold();

-- Ensure norm_text function exists
CREATE OR REPLACE FUNCTION public.norm_text(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(lower(coalesce(t,'')), '\s+', ' ', 'g');
$$;

-- Create ONLY the canonical 4-arg function (bigint, bigint)
-- FTS FILTER + TRIGRAM RANK STRATEGY: Uses tsvector GIN for selective filtering, trigram for ranking
-- This is MUCH faster than pure trigram on large datasets (2.4M+ rows)
CREATE FUNCTION public.search_records_fuzzy_ids(
  p_user   uuid,
  p_q      text,
  p_limit  bigint DEFAULT 100,
  p_offset bigint DEFAULT 0
) RETURNS TABLE(id uuid, rank real)
LANGUAGE plpgsql STABLE PARALLEL SAFE
SET search_path = records, public, pg_catalog
AS $function$
DECLARE
  qn            text;
  tsq           tsquery;
  candidate_cap integer := 150;  -- rows after FTS filter, before final offset/limit (reduced from 300 for better TPS)
  min_rank      real    := 0.20; -- minimum similarity rank to return
  has_aliases   boolean;
  sql           text;
BEGIN
  -- Normalize query
  qn := public.norm_text(COALESCE(p_q, ''));

  -- Build tsquery from query text (FTS filter - much more selective than trigram)
  -- plainto_tsquery is more lenient than websearch_to_tsquery for fuzzy matching
  -- It treats all words as AND terms, which works better for fuzzy search
  tsq := plainto_tsquery('simple', qn);

  -- Detect if aliases view/table exists AND is usable
  has_aliases := FALSE;
  BEGIN
    IF to_regclass('public.record_aliases') IS NOT NULL THEN
      PERFORM 1 FROM public.record_aliases LIMIT 1;
      has_aliases := TRUE;
    ELSIF to_regclass('public.aliases_mv') IS NOT NULL THEN
      PERFORM 1 FROM public.aliases_mv LIMIT 1;
      has_aliases := TRUE;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    has_aliases := FALSE;
  END;

  /*
    CRITICAL: Use dynamic SQL to inline p_user, qn, and tsq as literals.
    This allows Postgres to see predicates like:
      WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'
    at plan time, so per-tenant partial indexes (idx_records_search_tsv_bench) are usable.
    Note: tsquery must be cast to text and then back to tsquery in the SQL.
  */
  IF has_aliases THEN
    -- With aliases: include alias scoring
    sql := format($sql$
      WITH cand AS (
        SELECT
          r.id,
          GREATEST(
            similarity(r.artist_norm, %1$L),
            similarity(r.name_norm,   %1$L),
            similarity(r.search_norm, %1$L)
          ) AS sim
        FROM records.records AS r
        WHERE r.user_id = %2$L
          AND r.search_tsv @@ (%3$L::text)::tsquery          -- FTS filter (uses idx_records_search_tsv_bench)
        ORDER BY sim DESC
        LIMIT %4$s
      ),
      cand_alias AS (
        SELECT cm.id,
               max(similarity(a.term_norm, %1$L)) AS alias_sim
        FROM cand cm
        JOIN public.record_aliases a
          ON a.record_id = cm.id
        GROUP BY cm.id
      ),
      scored AS (
        SELECT
          c.id,
          GREATEST(
            c.sim,
            COALESCE(ca.alias_sim, 0)
          ) AS rank
        FROM cand c
        LEFT JOIN cand_alias ca
          ON ca.id = c.id
      )
      SELECT
        s.id,
        s.rank
      FROM scored s
      WHERE s.rank >= %5$s
      ORDER BY s.rank DESC
      OFFSET GREATEST(0, %6$s)
      LIMIT LEAST(1000, GREATEST(1, %7$s));
    $sql$,
      qn,                -- %1$L : normalized query (for similarity)
      p_user::text,      -- %2$L : user id as literal (enables partial index)
      tsq::text,         -- %3$L : tsquery as text (cast back to tsquery in SQL)
      candidate_cap,      -- %4$s
      min_rank,          -- %5$s
      p_offset,          -- %6$s
      p_limit            -- %7$s
    );
  ELSE
    -- No aliases: simpler version (hot path for benchmarks)
    sql := format($sql$
      WITH cand AS (
        SELECT
          r.id,
          GREATEST(
            similarity(r.artist_norm, %1$L),
            similarity(r.name_norm,   %1$L),
            similarity(r.search_norm, %1$L)
          ) AS sim
        FROM records.records AS r
        WHERE r.user_id = %2$L
          AND r.search_tsv @@ (%3$L::text)::tsquery          -- FTS filter (uses idx_records_search_tsv_bench)
        ORDER BY sim DESC
        LIMIT %4$s
      )
      SELECT
        c.id,
        c.sim::real AS rank
      FROM cand AS c
      WHERE c.sim >= %5$s
      ORDER BY c.sim DESC
      OFFSET GREATEST(0, %6$s)
      LIMIT LEAST(1000, GREATEST(1, %7$s));
    $sql$,
      qn,                -- %1$L : normalized query (for similarity)
      p_user::text,      -- %2$L : user id as literal (enables partial index)
      tsq::text,         -- %3$L : tsquery as text (cast back to tsquery in SQL)
      candidate_cap,      -- %4$s
      min_rank,          -- %5$s
      p_offset,          -- %6$s
      p_limit            -- %7$s
    );
  END IF;

  -- Execute dynamically-built query (allows planner to use partial FTS index)
  RETURN QUERY EXECUTE sql;
END;
$function$;

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
  AND p.pronargs = 4;

SQL

echo ""
echo "✅ Function created (canonical 4-arg version, FTS filter + trigram rank design)"
echo ""
echo "Strategy: Uses tsvector GIN for selective filtering, trigram similarity for ranking"
echo "This should dramatically reduce candidate set from 80k+ → hundreds/thousands"
echo "Expected performance: <100ms per query (vs 1.5-2.3s with pure trigram)"
