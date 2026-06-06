#!/usr/bin/env bash
set -euo pipefail

# Script to analyze slow queries in analytics service
# Runs EXPLAIN ANALYZE on common queries

NS="${NS:-record-platform}"
ANALYTICS_POD=$(kubectl -n "$NS" get pods -l app=analytics-service -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

if [ -z "$ANALYTICS_POD" ]; then
  echo "❌ Analytics pod not found"
  exit 1
fi

echo "🔍 Analyzing Analytics Service Queries"
echo "======================================"
echo ""

# 1. Similar searches query
echo "📊 1. Similar Searches Query (getSimilarSearches)"
echo "-------------------------------------------------"
kubectl -n "$NS" exec "$ANALYTICS_POD" -- sh -c "
  psql \"\$POSTGRES_URL_LISTINGS\" -c \"
  EXPLAIN ANALYZE
  SELECT q as query, COUNT(*)::int as count,
         MAX(similarity(q, 'Beatles Abbey Road')) as similarity
  FROM listings.search_history
  WHERE q % 'Beatles Abbey Road'
    AND q != 'Beatles Abbey Road'
  GROUP BY q
  ORDER BY similarity DESC, count DESC
  LIMIT 10;
  \"
" 2>&1 | grep -A 20 "QUERY PLAN" || echo "  Query failed or no results"
echo ""

# 2. Trending searches query
echo "📊 2. Trending Searches Query (getTrendingSearches)"
echo "---------------------------------------------------"
kubectl -n "$NS" exec "$ANALYTICS_POD" -- sh -c "
  psql \"\$POSTGRES_URL_LISTINGS\" -c \"
  EXPLAIN ANALYZE
  SELECT q as query, COUNT(*)::int as count
  FROM listings.search_history
  WHERE created_at >= NOW() - INTERVAL '7 days'
  GROUP BY q
  ORDER BY count DESC
  LIMIT 20;
  \"
" 2>&1 | grep -A 20 "QUERY PLAN" || echo "  Query failed or no results"
echo ""

# 3. User search history query
echo "📊 3. User Search History Query (getUserSearchHistory)"
echo "------------------------------------------------------"
kubectl -n "$NS" exec "$ANALYTICS_POD" -- sh -c "
  psql \"\$POSTGRES_URL_LISTINGS\" -c \"
  EXPLAIN ANALYZE
  SELECT id, user_id, source, q, results, created_at
  FROM listings.search_history
  WHERE user_id IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 50;
  \"
" 2>&1 | grep -A 20 "QUERY PLAN" || echo "  Query failed or no results"
echo ""

# 4. Check indexes
echo "📋 4. Existing Indexes on search_history"
echo "-----------------------------------------"
kubectl -n "$NS" exec "$ANALYTICS_POD" -- sh -c "
  psql \"\$POSTGRES_URL_LISTINGS\" -c \"
  SELECT
    schemaname,
    tablename,
    indexname,
    indexdef
  FROM pg_indexes
  WHERE tablename = 'search_history'
    AND schemaname = 'listings'
  ORDER BY indexname;
  \"
" 2>&1 | grep -v "^$" || echo "  No indexes found or query failed"
echo ""

echo "✅ Query analysis complete"

