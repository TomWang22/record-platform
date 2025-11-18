#!/usr/bin/env bash
set -Eeuo pipefail

# Warm up Redis and database caches for the records service
# Usage: ./scripts/warm_cache.sh [user_uuid]

NS="${NS:-record-platform}"
USER_UUID="${1:-0dc268d0-a86f-4e12-8d10-9db0f1b735e0}"

# Wait for postgres pod to be ready
echo "Waiting for postgres pod to be ready..."
kubectl -n "$NS" wait pod -l app=postgres --for=condition=Ready --timeout=120s >/dev/null 2>&1 || {
  echo "Error: Postgres pod not ready" >&2
  exit 1
}

PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')
if [[ -z "$PGPOD" ]]; then
  echo "Error: Could not find postgres pod" >&2
  exit 1
fi

# Wait for database to be ready (retry up to 30 times, 2 seconds apart)
echo "Waiting for database to be ready..."
MAX_RETRIES=30
RETRY_COUNT=0
while [[ $RETRY_COUNT -lt $MAX_RETRIES ]]; do
  if kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d postgres -X -P pager=off -c "SELECT 1 FROM pg_database WHERE datname='records';" >/dev/null 2>&1; then
    # Database exists, now check if it's accepting connections
    if kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off -c "SELECT 1;" >/dev/null 2>&1; then
      echo "Database is ready!"
      break
    fi
  fi
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [[ $RETRY_COUNT -lt $MAX_RETRIES ]]; then
    echo "  Waiting for database... ($RETRY_COUNT/$MAX_RETRIES)"
    sleep 2
  else
    echo "Error: Database not ready after $MAX_RETRIES retries" >&2
    exit 1
  fi
done

echo "=== Refreshing materialized views ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off <<'SQL'
SET search_path = records, public;

-- Ensure unaccent extension exists
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Ensure norm_text function exists
CREATE OR REPLACE FUNCTION public.norm_text(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(lower(unaccent(coalesce(t,''))), '\s+', ' ', 'g')
$$;

-- Refresh materialized views (with error handling)
DO $$
BEGIN
  -- Refresh aliases_mv first (search_doc_mv may depend on it)
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'records' AND c.relname = 'aliases_mv' AND c.relkind = 'm'
  ) THEN
    BEGIN
      REFRESH MATERIALIZED VIEW records.aliases_mv;
      RAISE NOTICE 'Refreshed records.aliases_mv';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to refresh aliases_mv: %', SQLERRM;
      -- Try to create it if it doesn't exist or is broken
      RAISE NOTICE 'Attempting to recreate aliases_mv...';
    END;
  ELSE
    RAISE NOTICE 'aliases_mv does not exist, skipping';
  END IF;
  
  -- Refresh search_doc_mv if it exists
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'records' AND c.relname = 'search_doc_mv' AND c.relkind = 'm'
  ) THEN
    BEGIN
      REFRESH MATERIALIZED VIEW records.search_doc_mv;
      RAISE NOTICE 'Refreshed records.search_doc_mv';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to refresh search_doc_mv: %', SQLERRM;
    END;
  END IF;
END $$;

-- Verify aliases_mv is populated
SELECT 
  CASE 
    WHEN EXISTS (SELECT 1 FROM pg_matviews WHERE schemaname='records' AND matviewname='aliases_mv') THEN
      (SELECT COUNT(*) FROM records.aliases_mv)::text
    ELSE 'N/A (does not exist)'
  END as aliases_mv_count;
SQL

echo "=== Refreshing hot slice ==="
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off <<SQL
SET search_path = records, public;
BEGIN;
DELETE FROM records_hot.records_hot;
INSERT INTO records_hot.records_hot (id, user_id, search_norm)
SELECT id, user_id, search_norm
FROM records.records
WHERE user_id = '$USER_UUID'::uuid
ORDER BY updated_at DESC
LIMIT 100000;
COMMIT;
SELECT COUNT(*) as refreshed_count FROM records_hot.records_hot;
SQL

echo ""
echo "=== Warming database cache with SQL queries ==="
# Warm TRGM path
kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off <<SQL
SET search_path = records, public;
SELECT count(*) as trgm_count FROM (
  SELECT id FROM records.records
  WHERE user_id = '$USER_UUID'::uuid
    AND (artist ILIKE '%warner%' OR name ILIKE '%warner%' OR catalog_number ILIKE '%warner%')
  ORDER BY updated_at DESC LIMIT 50
) s;
SQL

# Warm fuzzy searches (ensure MV is refreshed in same session)
for query in "warner" "teresa" "鄧麗君 album 263 cn-041 polygram"; do
  echo "  Warming fuzzy: $query"
  kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off <<SQL
SET search_path = records, public;
-- Ensure MV is refreshed before using it
REFRESH MATERIALIZED VIEW IF EXISTS records.aliases_mv;
SELECT count(*) FROM public.search_records_fuzzy_ids(
  '$USER_UUID'::uuid, '$query', 10, 0, false
);
SQL
done

echo ""
echo "=== Warming API cache (if records-service is available) ==="
PF_LOG=/tmp/pf.records.warm.log
PF_PID=""
if kubectl -n "$NS" port-forward svc/records-service 4002:4002 >"$PF_LOG" 2>&1 & sleep 2; then
  PF_PID=$!
  BASE="http://127.0.0.1:4002"
  
  # Warm TRGM searches via API
  for query in "warner" "teresa"; do
    echo "  Warming API TRGM: $query"
    curl -sS -H "x-user-id: $USER_UUID" \
      "$BASE/records/search?user=$USER_UUID&q=$(printf '%s' "$query" | jq -sRr @uri)&limit=10&offset=0" >/dev/null 2>&1 || true
  done
  
  # Cleanup port-forward
  if [[ -n "$PF_PID" ]]; then
    kill "$PF_PID" 2>/dev/null || true
  fi
  rm -f "$PF_LOG"
else
  echo "  Skipping API warmup (port-forward failed)"
fi

echo ""
echo "=== Warmup complete ==="
echo "Hot slice: $(kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -t -c "SELECT COUNT(*) FROM records_hot.records_hot;") records"

