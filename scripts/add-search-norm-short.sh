#!/usr/bin/env bash
set -Eeuo pipefail

# Add search_norm_short column (truncated to 256 chars) for faster KNN/TRGM
# This dramatically reduces trigram processing cost

NS="${NS:-record-platform}"

PGPOD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[?(@.status.phase=="Running")].metadata.name}' | awk 'NR==1{print $1}')

if [[ -z "$PGPOD" ]]; then
  echo "Error: Postgres pod not found" >&2
  exit 1
fi

echo "Adding search_norm_short column and indexes..."

kubectl -n "$NS" exec "$PGPOD" -c db -- psql -U postgres -d records -X -P pager=off -v ON_ERROR_STOP=1 <<'SQL'
SET search_path = records, public;

-- Add search_norm_short to records.records
ALTER TABLE records.records ADD COLUMN IF NOT EXISTS search_norm_short text;

-- Populate search_norm_short (truncate to 256 chars)
UPDATE records.records
SET search_norm_short = left(search_norm, 256)
WHERE search_norm_short IS NULL OR search_norm_short != left(search_norm, 256);

-- Add search_norm_short to records_hot.records_hot
ALTER TABLE records_hot.records_hot ADD COLUMN IF NOT EXISTS search_norm_short text;

-- Populate from main table (join on id)
UPDATE records_hot.records_hot h
SET search_norm_short = r.search_norm_short
FROM records.records r
WHERE h.id = r.id
  AND (h.search_norm_short IS NULL OR h.search_norm_short != r.search_norm_short);

-- Create indexes on search_norm_short
CREATE INDEX IF NOT EXISTS idx_records_search_norm_short_gist 
  ON records.records USING gist(search_norm_short gist_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_records_search_norm_short_gin 
  ON records.records USING gin(search_norm_short gin_trgm_ops) WITH (fastupdate=off);

CREATE INDEX IF NOT EXISTS records_hot_search_norm_short_gist 
  ON records_hot.records_hot USING gist(search_norm_short gist_trgm_ops);

CREATE INDEX IF NOT EXISTS records_hot_search_norm_short_gin 
  ON records_hot.records_hot USING gin(search_norm_short gin_trgm_ops) WITH (fastupdate=off);

-- Analyze
ANALYZE records.records;
ANALYZE records_hot.records_hot;

-- Verify
SELECT 
  'records.records' AS table_name,
  count(*) FILTER (WHERE search_norm_short IS NOT NULL) AS with_short,
  count(*) AS total
FROM records.records
UNION ALL
SELECT 
  'records_hot.records_hot',
  count(*) FILTER (WHERE search_norm_short IS NOT NULL),
  count(*)
FROM records_hot.records_hot;
SQL

echo "✅ search_norm_short column added and indexed"
echo "   - Truncated to 256 chars for faster trigram operations"
echo "   - Indexes created on both tables"

