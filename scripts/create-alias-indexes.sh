#!/usr/bin/env bash
# Create indexes for alias tables to optimize join performance
# These indexes ensure alias joins are cheap after candidate selection

set -Eeuo pipefail

: "${PGHOST:=localhost}"
: "${PGPORT:=5433}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=records}"
: "${PGPASSWORD:=postgres}"

echo "=== Creating Alias Indexes ==="
echo "Using Postgres at ${PGHOST}:${PGPORT}..."

PGPASSWORD="$PGPASSWORD" psql \
  -h "$PGHOST" -p "$PGPORT" \
  -U "$PGUSER" -d "$PGDATABASE" \
  -X -P pager=off -v ON_ERROR_STOP=1 <<SQL
SET search_path = public, records, pg_catalog;

-- Ensure pg_trgm extension exists
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1) Fast join from candidate IDs → aliases (CRITICAL for performance)
-- This is the most important index - used in every alias join
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_record_aliases_record_id
  ON public.record_aliases(record_id);

-- 2) Optional: if you ever search aliases directly (for future use)
-- This allows trigram search on alias terms if needed
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_record_aliases_term_norm_trgm
  ON public.record_aliases
  USING gin (term_norm gin_trgm_ops);

-- 3) If aliases_mv exists, ensure it has proper indexes
DO \$\$
BEGIN
  IF to_regclass('public.aliases_mv') IS NOT NULL THEN
    -- Index on record_id for joins
    CREATE INDEX IF NOT EXISTS idx_aliases_mv_record_id
      ON public.aliases_mv(record_id);
  END IF;
END \$\$;

-- Show index sizes
SELECT 
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size((schemaname||'.'||indexname)::regclass)) AS size
FROM pg_indexes
WHERE schemaname = 'public' 
  AND tablename IN ('record_aliases', 'aliases_mv')
ORDER BY pg_relation_size((schemaname||'.'||indexname)::regclass) DESC;
SQL

echo ""
echo "✅ Alias indexes created!"
echo "These indexes ensure fast joins after candidate selection"

