#!/usr/bin/env bash
set -Eeuo pipefail

# Tune function parameters to find optimal performance
# Tests different combinations of candidate_cap and high_trgm_limit

: "${PGHOST:=localhost}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=records}"
: "${PGPASSWORD:=postgres}"

BENCH_USER_UUID="${BENCH_USER_UUID:-0dc268d0-a86f-4e12-8d10-9db0f1b735e0}"
TEST_QUERY="${TEST_QUERY:-鄧麗君 album 263 cn-041 polygram}"

echo "=== Tuning Function Parameters ==="
echo "Testing different combinations of candidate_cap and high_trgm_limit"
echo ""

# Test different parameter combinations
for candidate_cap in 200 300 500; do
  for high_trgm_limit in 0.55 0.60 0.65; do
    echo "--- Testing: candidate_cap=$candidate_cap, high_trgm_limit=$high_trgm_limit ---"
    
    PGPASSWORD="$PGPASSWORD" psql \
      -h "$PGHOST" -p "$PGPORT" \
      -U "$PGUSER" -d "$PGDATABASE" \
      -X -P pager=off -t -A <<SQL | while IFS='|' read -r exec_time buffers rows; do
SET search_path = public, records, pg_catalog;
SET jit = off;

-- Temporarily modify function with these parameters
CREATE OR REPLACE FUNCTION public.search_records_fuzzy_ids_tune(
  p_user   uuid,
  p_q      text,
  p_limit  bigint DEFAULT 100,
  p_offset bigint DEFAULT 0
) RETURNS TABLE(id uuid, rank real)
LANGUAGE plpgsql STABLE
SET search_path = records, public, pg_catalog
AS \$\$
DECLARE
  qn              text;
  old_limit       real;
  candidate_cap   integer := $candidate_cap;
  hard_min_rank   real    := 0.20;
  high_trgm_limit real    := $high_trgm_limit;
BEGIN
  qn := public.norm_text(COALESCE(p_q, ''));
  old_limit := show_limit();
  PERFORM set_limit(high_trgm_limit);
  
  RETURN QUERY
  WITH cand AS (
    SELECT
      r.id,
      GREATEST(
        similarity(r.artist_norm, qn),
        similarity(r.name_norm,   qn),
        similarity(r.search_norm, qn)
      ) AS sim
    FROM records.records AS r
    WHERE r.user_id = p_user
      AND r.search_norm IS NOT NULL
      AND r.search_norm % qn
    ORDER BY sim DESC
    LIMIT candidate_cap
  )
  SELECT
    c.id,
    c.sim::real AS rank
  FROM cand c
  WHERE c.sim >= hard_min_rank
  ORDER BY c.sim DESC
  OFFSET GREATEST(0, p_offset)
  LIMIT LEAST(1000, GREATEST(1, p_limit));
  
  PERFORM set_limit(old_limit);
END;
\$\$;

EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT count(*)
FROM public.search_records_fuzzy_ids_tune(
  '$BENCH_USER_UUID'::uuid,
  '$TEST_QUERY',
  50::bigint,
  0::bigint
);
SQL
      echo "  Execution Time: ${exec_time}ms | Buffers: ${buffers} | Rows: ${rows}"
    done
  done
done

echo ""
echo "✅ Parameter tuning complete"
echo "Review results above to find optimal combination"

