#!/usr/bin/env bash
set -Eeuo pipefail

# Test minimal KNN and TRGM queries to establish baseline

NS="${NS:-record-platform}"

PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

if [[ -z "$PGPOD" ]]; then
  echo "Error: Postgres pod not found" >&2
  exit 1
fi

echo "=== Testing Minimal Queries (Baseline) ==="
echo ""

kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off <<'SQL'
SET search_path = records, public;
SET enable_seqscan = off;
SET work_mem = '256MB';
SET random_page_cost = 0.8;
SET plan_cache_mode = 'force_custom_plan';

\echo '=== Minimal KNN on Hot Slice (search_norm_short) ==='
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
WITH norm AS (
  SELECT norm_text('鄧麗君 album 263 cn-041 polygram') AS qn
)
SELECT h.id
FROM records_hot.records_hot h
JOIN norm n ON true
ORDER BY h.search_norm_short <-> n.qn
LIMIT 50;

\echo ''
\echo '=== Minimal TRGM+KNN on Hot Slice (search_norm_short) ==='
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
WITH norm AS (
  SELECT norm_text('鄧麗君 album 263 cn-041 polygram') AS qn
)
SELECT h.id
FROM records_hot.records_hot h
JOIN norm n ON true
WHERE h.search_norm_short % n.qn
ORDER BY h.search_norm_short <-> n.qn
LIMIT 50;
SQL

echo ""
echo "✅ Minimal queries tested"

