#!/usr/bin/env bash
set -euo pipefail

# Comprehensive Query Analysis
# - Check for sequential scans
# - Analyze execution times
# - Identify slow queries
# - Suggest optimizations for large client loads (256+)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="/tmp/query-analysis-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RESULTS_DIR"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; }

# Database port mapping
declare -A DB_PORTS
DB_PORTS[records]="5433"
DB_PORTS[social]="5434"
DB_PORTS[listings]="5435"
DB_PORTS[shopping]="5436"
DB_PORTS[auth]="5437"
DB_PORTS[auction_monitor]="5438"
DB_PORTS[analytics]="5439"
DB_PORTS[python_ai]="5440"

say "=== Comprehensive Query Analysis ==="
echo "Results directory: $RESULTS_DIR"
echo "Target: Optimize for 256+ clients (pgbench), measure p90-p9999999, p100"
echo ""

# Function to analyze a query
analyze_query() {
  local port=$1
  local schema=$2
  local query_name=$3
  local query=$4
  local results_file="$RESULTS_DIR/${schema}-${query_name// /_}.txt"
  
  {
    echo "=== Query: $query_name ==="
    echo "Schema: $schema"
    echo "Port: $port"
    echo "Query: $query"
    echo ""
    echo "--- EXPLAIN ANALYZE ---"
    PGPASSWORD=postgres psql -h localhost -p "$port" -U postgres -d records \
      -c "SET search_path TO $schema, public; EXPLAIN (ANALYZE, BUFFERS, VERBOSE, TIMING) $query" 2>&1 || echo "Query failed"
    echo ""
    echo "--- Index Usage Analysis ---"
    PGPASSWORD=postgres psql -h localhost -p "$port" -U postgres -d records \
      -c "SET search_path TO $schema, public; SELECT 'Seq Scan' as scan_type, count(*) as occurrences FROM (EXPLAIN (ANALYZE, BUFFERS) $query) AS plan WHERE plan ~* 'Seq Scan';" 2>&1 || echo "Analysis failed"
    echo ""
  } > "$results_file"
  
  # Extract key metrics
  local plan_output=$(PGPASSWORD=postgres psql -h localhost -p "$port" -U postgres -d records \
    -c "SET search_path TO $schema, public; EXPLAIN (ANALYZE, BUFFERS) $query" 2>&1 || echo "")
  
  local exec_time=$(echo "$plan_output" | grep -i "Execution Time:" | grep -oE "[0-9]+\.[0-9]+" | head -1 || echo "0")
  local seq_scans=$(echo "$plan_output" | grep -ic "Seq Scan" || echo "0")
  local index_scans=$(echo "$plan_output" | grep -icE "Index Scan|Index Only Scan|Bitmap Index Scan" || echo "0")
  local parallel_workers=$(echo "$plan_output" | grep -i "Workers Launched:" | grep -oE "[0-9]+" | head -1 || echo "0")
  
  echo "$query_name|$exec_time|$seq_scans|$index_scans|$parallel_workers" >> "$RESULTS_DIR/summary.csv"
  
  # Check for issues
  if [[ "$seq_scans" -gt 0 ]]; then
    warn "$query_name: Sequential scans detected ($seq_scans)"
  fi
  
  local exec_time_ms=$(echo "$exec_time * 1000" | bc -l 2>/dev/null | cut -d'.' -f1 || echo "0")
  if [[ "$exec_time_ms" -gt 5000 ]]; then
    warn "$query_name: Slow execution (${exec_time}ms > 5000ms)"
  fi
}

# Initialize summary CSV
echo "Query|Execution Time (ms)|Seq Scans|Index Scans|Parallel Workers" > "$RESULTS_DIR/summary.csv"

say "=== Records Service Analysis (Port 5433) ==="
say "Critical: 2.4M+ records, 5.1k TPS target, 256+ clients"

# Records queries
analyze_query 5433 records "User Records Lookup" \
  "SELECT * FROM records.records WHERE user_id = (SELECT id FROM records.records LIMIT 1) LIMIT 50;"

analyze_query 5433 records "Fuzzy Search Artist" \
  "SELECT * FROM records.records WHERE artist ILIKE '%test%' LIMIT 20;"

analyze_query 5433 records "Composite Query User Artist Name" \
  "SELECT * FROM records.records WHERE user_id = (SELECT id FROM records.records LIMIT 1) AND artist = 'Test Artist' AND name = 'Test Record' LIMIT 10;"

analyze_query 5433 records "Recent Records 90 Days" \
  "SELECT * FROM records.records WHERE updated_at > NOW() - INTERVAL '90 days' ORDER BY updated_at DESC LIMIT 50;"

analyze_query 5433 records "Catalog Number Search" \
  "SELECT * FROM records.records WHERE catalog_number = 'TEST-001' LIMIT 10;"

analyze_query 5433 records "Hot Tenant Records" \
  "SELECT * FROM records.records WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid ORDER BY updated_at DESC LIMIT 50;"

say "=== Listings Service Analysis (Port 5435) ==="
analyze_query 5435 listings "Search Listings" \
  "SELECT * FROM listings.listings WHERE title ILIKE '%vinyl%' AND is_active = true LIMIT 20;"

analyze_query 5435 listings "User Listings" \
  "SELECT * FROM listings.listings WHERE user_id = (SELECT user_id FROM listings.listings LIMIT 1) ORDER BY created_at DESC LIMIT 50;"

say "=== Analytics Service Analysis (Port 5439) ==="
say "CRITICAL: Analytics feeds Python AI - must be ultra-fast"

analyze_query 5439 analytics "Price Snapshots Time Series" \
  "SELECT * FROM analytics.price_snapshots WHERE timestamp > NOW() - INTERVAL '30 days' ORDER BY timestamp DESC LIMIT 100;"

analyze_query 5439 analytics "User Behavior Aggregation" \
  "SELECT user_id, COUNT(*) FROM analytics.user_behavior WHERE event_timestamp > NOW() - INTERVAL '7 days' GROUP BY user_id LIMIT 50;"

say "=== Social Service Analysis (Port 5434) ==="
analyze_query 5434 social "User Messages" \
  "SELECT * FROM social.messages WHERE recipient_id = (SELECT id FROM auth.users LIMIT 1) ORDER BY created_at DESC LIMIT 50;" 2>/dev/null || \
analyze_query 5434 social "Forum Posts" \
  "SELECT * FROM forum.posts ORDER BY created_at DESC LIMIT 50;"

say "=== Shopping Service Analysis (Port 5436) ==="
analyze_query 5436 shopping "User Shopping Cart" \
  "SELECT * FROM shopping.shopping_cart WHERE user_id = (SELECT id FROM auth.users LIMIT 1);"

say "=== Analyzing pg_stat_statements for Slow Queries ==="
for schema in "${!DB_PORTS[@]}"; do
  port="${DB_PORTS[$schema]}"
  say "Checking slow queries in $schema (port $port)..."
  
  PGPASSWORD=postgres psql -h localhost -p "$port" -U postgres -d records << EOF > "$RESULTS_DIR/${schema}-slow-queries.txt" 2>&1
SET search_path TO $schema, public;

-- Check if pg_stat_statements extension exists
SELECT CASE 
  WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') 
  THEN 'Extension exists' 
  ELSE 'Extension NOT installed' 
END as pg_stat_statements_status;

-- Get slow queries (if extension exists)
SELECT 
  query,
  calls,
  total_exec_time,
  mean_exec_time,
  max_exec_time,
  stddev_exec_time
FROM pg_stat_statements 
WHERE mean_exec_time > 100  -- Queries taking > 100ms on average
ORDER BY mean_exec_time DESC
LIMIT 20;
EOF
done

say "=== Checking for Sequential Scans ==="
for schema in "${!DB_PORTS[@]}"; do
  port="${DB_PORTS[$schema]}"
  say "Checking sequential scans in $schema (port $port)..."
  
  PGPASSWORD=postgres psql -h localhost -p "$port" -U postgres -d records << EOF > "$RESULTS_DIR/${schema}-sequential-scans.txt" 2>&1
SET search_path TO $schema, public;

-- Find tables with sequential scans
SELECT 
  schemaname,
  tablename,
  seq_scan,
  seq_tup_read,
  idx_scan,
  seq_tup_read / NULLIF(seq_scan, 0) as avg_seq_reads,
  CASE 
    WHEN seq_scan > idx_scan * 10 THEN '⚠️  Many sequential scans'
    WHEN seq_scan > 0 AND idx_scan = 0 THEN '❌ Only sequential scans'
    ELSE '✅ Mostly index scans'
  END as status
FROM pg_stat_user_tables
WHERE schemaname = '$schema'
  AND seq_scan > 0
ORDER BY seq_scan DESC;
EOF
done

say "=== Query Plan Summary ==="
echo ""
if [[ -f "$RESULTS_DIR/summary.csv" ]]; then
  echo "Summary of analyzed queries:"
  column -t -s'|' "$RESULTS_DIR/summary.csv" | head -20
fi

say "=== Analysis Complete ==="
ok "Results saved to: $RESULTS_DIR"
echo ""
echo "Next steps:"
echo "  1. Review slow queries (>5s execution time)"
echo "  2. Fix sequential scans (add indexes)"
echo "  3. Optimize for 256+ concurrent clients"
echo "  4. Consider materialized views for hot queries"
echo "  5. Review pg_stat_statements for real-world slow queries"
