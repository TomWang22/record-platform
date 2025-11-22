#!/usr/bin/env bash
set -Eeuo pipefail

# Test and tune function parameters with EXPLAIN ANALYZE
# Tests different combinations and reports performance metrics

: "${PGHOST:=localhost}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=records}"
: "${PGPASSWORD:=postgres}"

BENCH_USER_UUID="${BENCH_USER_UUID:-0dc268d0-a86f-4e12-8d10-9db0f1b735e0}"
TEST_QUERY="${TEST_QUERY:-鄧麗君 album 263 cn-041 polygram}"

echo "=== Testing and Tuning Function ==="
echo "Bench user: $BENCH_USER_UUID"
echo "Test query: $TEST_QUERY"
echo ""

# Test different parameter combinations
echo "Testing different threshold values..."
echo ""

for threshold in 0.55 0.60 0.65 0.70; do
  echo "--- Threshold: $threshold ---"
  
  PGPASSWORD="$PGPASSWORD" psql \
    -h "$PGHOST" -p "$PGPORT" \
    -U "$PGUSER" -d "$PGDATABASE" \
    -X -P pager=off -t -A <<SQL | while IFS='|' read -r exec_time buffers rows; do
SET search_path = public, records, pg_catalog;
SET jit = off;

-- Temporarily modify function with this threshold
CREATE OR REPLACE FUNCTION public.search_records_fuzzy_ids_test(
  p_user uuid, p_q text, p_limit bigint DEFAULT 100, p_offset bigint DEFAULT 0
) RETURNS TABLE(id uuid, rank real)
LANGUAGE plpgsql STABLE
SET search_path = records, public, pg_catalog
AS \$\$
DECLARE
  qn text;
  old_limit real;
  candidate_cap integer := 300;
  hard_min_rank real := 0.20;
  high_trgm_limit real := $threshold;
BEGIN
  qn := public.norm_text(COALESCE(p_q, ''));
  old_limit := show_limit();
  PERFORM set_limit(high_trgm_limit);
  
  RETURN QUERY
  WITH cand AS (
    SELECT r.id,
           GREATEST(
             similarity(r.artist_norm, qn),
             similarity(r.name_norm, qn),
             similarity(r.search_norm, qn)
           ) AS sim
    FROM records.records AS r
    WHERE r.user_id = p_user
      AND r.search_norm IS NOT NULL
      AND r.search_norm % qn
    ORDER BY sim DESC
    LIMIT candidate_cap
  )
  SELECT c.id, c.sim::real AS rank
  FROM cand c
  WHERE c.sim >= hard_min_rank
  ORDER BY c.sim DESC
  OFFSET GREATEST(0, p_offset)
  LIMIT LEAST(1000, GREATEST(1, p_limit));
  
  PERFORM set_limit(old_limit);
END;
\$\$;

-- Run EXPLAIN ANALYZE
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT count(*)
FROM public.search_records_fuzzy_ids_test(
  '$BENCH_USER_UUID'::uuid,
  '$TEST_QUERY',
  50::bigint,
  0::bigint
);
SQL
    # Parse EXPLAIN output (simplified - actual parsing would be more complex)
    echo "  Results: exec_time=${exec_time}ms, buffers=${buffers}, rows=${rows}"
  done
  
  # Also check match count at this threshold
  PGPASSWORD="$PGPASSWORD" psql \
    -h "$PGHOST" -p "$PGPORT" \
    -U "$PGUSER" -d "$PGDATABASE" \
    -t -A <<SQL
SET search_path = public, records, pg_catalog;
DO \$\$
DECLARE
  qn text;
  cnt bigint;
BEGIN
  qn := public.norm_text(lower('$TEST_QUERY'));
  PERFORM set_limit($threshold);
  SELECT count(*) INTO cnt
  FROM records.records r
  WHERE r.user_id = '$BENCH_USER_UUID'::uuid
    AND r.search_norm IS NOT NULL
    AND r.search_norm % qn;
  RAISE NOTICE 'Matches at threshold %: %', $threshold, cnt;
END\$\$;
SQL
  echo ""
done

echo "✅ Testing complete"
echo ""
echo "Review results above to find optimal threshold"

