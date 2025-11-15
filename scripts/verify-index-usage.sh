#!/usr/bin/env bash
set -Eeuo pipefail

# Verify that indexes are being used for TRGM and KNN queries
# Usage: ./scripts/verify-index-usage.sh

NS="${NS:-record-platform}"
PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

if [[ -z "$PGPOD" ]]; then
  echo "Error: Postgres pod not found" >&2
  exit 1
fi

USER_UUID="${USER_UUID:-0dc268d0-a86f-4e12-8d10-9db0f1b735e0}"

echo "=== Verifying Index Usage ==="
echo "Pod: $PGPOD"
echo ""

echo "--- 1. TRGM Query Plan (should use GIN index) ---"
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off <<SQL
SET search_path = records, public;
SET enable_seqscan = off;

EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT count(*) FROM (
  SELECT id
  FROM records.records
  WHERE user_id = '$USER_UUID'::uuid
    AND (
      artist ILIKE '%test%' OR
      name   ILIKE '%test%' OR
      catalog_number ILIKE '%test%'
    )
  ORDER BY updated_at DESC
  LIMIT 50
) s;
SQL

echo ""
echo "--- 2. KNN Query Plan (should use GiST index) ---"
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off <<SQL
SET search_path = records, public;
SET enable_seqscan = off;

EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
WITH has AS (
  SELECT
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_schema='records' AND table_name='records' AND column_name='search_norm') AS has_sn,
    EXISTS (SELECT 1
            FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname='norm_text' AND p.pronargs=1) AS has_norm
)
SELECT count(*) FROM (
  SELECT r.id
  FROM records.records r, has
  WHERE r.user_id = '$USER_UUID'::uuid
  ORDER BY
    (CASE WHEN has.has_sn THEN r.search_norm
          ELSE lower(concat_ws(' ', r.artist, r.name, r.catalog_number)) END)
    <-> (CASE WHEN has.has_norm THEN public.norm_text('test') ELSE lower('test') END)
  LIMIT 50
) s;
SQL

echo ""
echo "--- 3. Current Planner Settings ---"
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off -c "
SELECT name, setting, unit, short_desc
FROM pg_settings
WHERE name IN (
  'random_page_cost',
  'cpu_index_tuple_cost',
  'cpu_tuple_cost',
  'effective_cache_size',
  'shared_buffers',
  'work_mem',
  'enable_seqscan'
)
ORDER BY name;"

echo ""
echo "--- 4. Index Usage Statistics ---"
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off -c "
SELECT 
  schemaname, relname as tablename, indexrelname as indexname,
  idx_scan as times_used,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE schemaname = 'records' 
  AND relname = 'records'
  AND (indexrelname LIKE '%trgm%' OR indexrelname LIKE '%search_norm%' OR indexrelname LIKE '%hot%')
ORDER BY indexrelname;"

echo ""
echo "=== Verification Complete ==="

