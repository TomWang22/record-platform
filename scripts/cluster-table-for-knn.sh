#!/usr/bin/env bash
set -Eeuo pipefail

# Cluster the table by the GiST index to improve KNN query performance
# This physically reorders rows to match index order, improving locality

: "${PGHOST:=localhost}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=records}"
: "${PGPASSWORD:=postgres}"

BENCH_USER_UUID="${BENCH_USER_UUID:-0dc268d0-a86f-4e12-8d10-9db0f1b735e0}"

echo "=== Clustering Table for KNN Performance ==="
echo "This will physically reorder the table by the GiST index"
echo "WARNING: This locks the table and can take a while on large datasets"
echo ""

read -p "Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Cancelled"
  exit 1
fi

PGPASSWORD="$PGPASSWORD" psql \
  -h "$PGHOST" -p "$PGPORT" \
  -U "$PGUSER" -d "$PGDATABASE" \
  -X -P pager=off -v ON_ERROR_STOP=1 <<SQL
SET search_path = records, public, pg_catalog;

-- NOTE: PostgreSQL cannot cluster on partial indexes
-- Instead, we'll create a temporary global GiST index for clustering,
-- then drop it after clustering is complete

-- Create temporary global GiST index for clustering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_records_search_norm_gist_temp_cluster
ON records.records
USING gist (search_norm gist_trgm_ops);

-- Cluster by the temporary global index (this is the expensive operation)
-- This physically reorders the table to match index order
CLUSTER records.records USING idx_records_search_norm_gist_temp_cluster;

-- Drop the temporary index after clustering
DROP INDEX IF EXISTS idx_records_search_norm_gist_temp_cluster;

-- ANALYZE after clustering
ANALYZE records.records;

-- Show table size
SELECT 
  pg_size_pretty(pg_total_relation_size('records.records')) AS total_size,
  pg_size_pretty(pg_relation_size('records.records')) AS table_size,
  pg_size_pretty(pg_indexes_size('records.records')) AS indexes_size;

SQL

echo ""
echo "✅ Table clustered by GiST index"
echo "This should significantly improve KNN query performance"

