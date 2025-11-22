#!/usr/bin/env bash
set -Eeuo pipefail

# Test simple queries to establish baseline performance
# These match the old hot-sharded query patterns

NS="${NS:-record-platform}"
HOT_TENANT_UUID="${HOT_TENANT_UUID:-0dc268d0-a86f-4e12-8d10-9db0f1b735e0}"
QUERY="${QUERY:-鄧麗君 album 263 cn-041 polygram}"

PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

if [[ -z "$PGPOD" ]]; then
  echo "Error: Postgres pod not found" >&2
  exit 1
fi

echo "=== Testing Simple Queries (Baseline Performance) ==="
echo "Query: $QUERY"
echo ""

kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off <<SQL
SET search_path = records, public;
SET enable_seqscan = off;
SET work_mem = '256MB';
SET random_page_cost = 0.8;

\echo '=== 1. Simple KNN on Hot Table (No user_id filter) ==='
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id
FROM records_hot.records_hot
ORDER BY search_norm <-> norm_text('$QUERY')
LIMIT 50;

\echo ''
\echo '=== 2. Simple TRGM on Hot Table (No aliases, no GREATEST rank) ==='
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
WITH norm AS (SELECT norm_text('$QUERY') AS qn)
SELECT h.id
FROM records_hot.records_hot h
CROSS JOIN norm n
WHERE h.search_norm % n.qn
ORDER BY h.search_norm <-> n.qn
LIMIT 50;

\echo ''
\echo '=== 3. Complex Function (Current Implementation) ==='
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT count(*) FROM public.search_records_fuzzy_ids(
  '$HOT_TENANT_UUID'::uuid, 
  '$QUERY', 
  50, 0, false
);
SQL

echo ""
echo "=== Analysis ==="
echo "Compare execution times:"
echo "  - Simple KNN should be ~1-5ms (baseline)"
echo "  - Simple TRGM should be ~1-5ms (baseline)"
echo "  - Complex function shows overhead from aliases + ranking logic"
echo ""
echo "If simple queries are fast but complex function is slow,"
echo "the regression is from extra complexity, not index/table structure."

