#!/usr/bin/env bash
set -Eeuo pipefail

# Verify and fix search_norm_short on records_hot

NS="${NS:-record-platform}"

PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

if [[ -z "$PGPOD" ]]; then
  echo "Error: Postgres pod not found" >&2
  exit 1
fi

echo "=== Verifying search_norm_short on records_hot ==="

kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off -v ON_ERROR_STOP=1 <<'SQL'
SET search_path = records, public;

-- Check if column exists
\echo '=== Checking for search_norm_short column ==='
SELECT 
  table_schema,
  table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'records_hot' 
  AND table_name = 'records_hot'
  AND column_name LIKE '%search_norm%'
ORDER BY column_name;

-- Add if missing
\echo ''
\echo '=== Adding search_norm_short if missing ==='
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'records_hot' 
      AND table_name = 'records_hot' 
      AND column_name = 'search_norm_short'
  ) THEN
    ALTER TABLE records_hot.records_hot ADD COLUMN search_norm_short text;
    RAISE NOTICE 'Added search_norm_short column';
  ELSE
    RAISE NOTICE 'search_norm_short column already exists';
  END IF;
END $$;

-- Populate from main table
\echo ''
\echo '=== Populating search_norm_short ==='
UPDATE records_hot.records_hot h
SET search_norm_short = COALESCE(r.search_norm_short, left(h.search_norm, 256))
FROM records.records r
WHERE h.id = r.id 
  AND (h.search_norm_short IS NULL OR h.search_norm_short != COALESCE(r.search_norm_short, left(h.search_norm, 256)));

-- If no match, use left(search_norm, 256)
UPDATE records_hot.records_hot
SET search_norm_short = left(search_norm, 256)
WHERE search_norm_short IS NULL;

-- Verify population
\echo ''
\echo '=== Verification ==='
SELECT 
  'records_hot.records_hot' AS table_name,
  count(*) AS total_rows,
  count(*) FILTER (WHERE search_norm_short IS NOT NULL) AS with_short,
  count(*) FILTER (WHERE search_norm_short IS NULL) AS null_short,
  avg(length(search_norm_short)) AS avg_length
FROM records_hot.records_hot;

-- Create indexes if missing
\echo ''
\echo '=== Creating indexes on search_norm_short ==='
CREATE INDEX IF NOT EXISTS records_hot_search_norm_short_trgm_gist
ON records_hot.records_hot
USING gist (search_norm_short gist_trgm_ops);

CREATE INDEX IF NOT EXISTS records_hot_search_norm_short_trgm_gin
ON records_hot.records_hot
USING gin (search_norm_short gin_trgm_ops) WITH (fastupdate=off);

-- Analyze
ANALYZE records_hot.records_hot;

\echo ''
\echo '✅ search_norm_short verified and indexed'
SQL

echo ""
echo "✅ search_norm_short column verified on records_hot"

