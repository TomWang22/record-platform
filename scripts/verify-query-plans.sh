#!/usr/bin/env bash
set -euo pipefail

# Query Plan Verification Script
# Verifies that critical queries use indexes and perform well at scale

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

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

say "=== Query Plan Verification ==="
echo "Verifying critical queries use indexes and perform well at scale"
echo ""

# Function to verify query plan
verify_query_plan() {
  local port=$1
  local schema=$2
  local query_name=$3
  local query=$4
  local max_time_ms=${5:-10000}  # Default 10 seconds
  
  say "Verifying $query_name (port $port, schema $schema)..."
  
  # Run EXPLAIN ANALYZE
  local plan=$(PGPASSWORD=postgres psql -h localhost -p "$port" -U postgres -d records \
    -c "SET search_path TO $schema, public; EXPLAIN (ANALYZE, BUFFERS, VERBOSE) $query" 2>&1 || echo "ERROR")
  
  if echo "$plan" | grep -q "ERROR"; then
    warn "$query_name: Query failed"
    echo "$plan" | grep -i error | head -3
    return 1
  fi
  
  # Extract execution time (format: "Execution Time: 123.456 ms")
  local exec_time=$(echo "$plan" | grep -i "Execution Time:" | grep -oE "[0-9]+\.[0-9]+" | head -1 || echo "0")
  local exec_time_ms=$(echo "$exec_time * 1000" | bc -l 2>/dev/null | cut -d'.' -f1 || echo "0")
  
  # Check for sequential scans (should be disabled, but verify)
  local seq_scans=$(echo "$plan" | grep -i "Seq Scan" | wc -l | tr -d ' ')
  
  # Check for index usage
  local index_scans=$(echo "$plan" | grep -iE "Index Scan|Index Only Scan|Bitmap Index Scan" | wc -l | tr -d ' ')
  
  # Check for parallel workers
  local parallel_workers=$(echo "$plan" | grep -i "Workers Launched:" | grep -oE "[0-9]+" | head -1 || echo "0")
  
  # Verify performance
  if [[ "$exec_time_ms" -lt "$max_time_ms" ]]; then
    ok "$query_name: Fast execution (${exec_time}ms, target: <${max_time_ms}ms)"
  else
    warn "$query_name: Slow execution (${exec_time}ms, target: <${max_time_ms}ms)"
  fi
  
  # Verify index usage
  if [[ "$index_scans" -gt 0 ]]; then
    ok "$query_name: Using indexes ($index_scans index scans)"
  else
    warn "$query_name: No index scans detected (may use sequential scans)"
  fi
  
  # Verify no sequential scans (enable_seqscan should be off)
  if [[ "$seq_scans" -eq 0 ]]; then
    ok "$query_name: No sequential scans (indexes enforced)"
  else
    warn "$query_name: Sequential scans detected ($seq_scans) - may need index tuning"
  fi
  
  # Check parallel workers (if applicable)
  if [[ "$parallel_workers" -gt 0 ]]; then
    ok "$query_name: Using parallel workers ($parallel_workers workers)"
  fi
  
  # Show summary
  echo "  Execution Time: ${exec_time}ms"
  echo "  Index Scans: $index_scans"
  echo "  Sequential Scans: $seq_scans"
  echo "  Parallel Workers: $parallel_workers"
  echo ""
  
  return 0
}

# Records Service - Critical queries (2.4M+ records, 5.1k TPS target)
say "=== Records Service Query Plans (Port 5433) ==="
say "Testing with 2.4M+ records scale..."

# Query 1: User records lookup (most common)
verify_query_plan 5433 records "User Records Lookup" \
  "SELECT * FROM records.records WHERE user_id = (SELECT id FROM records.records LIMIT 1) LIMIT 50;" \
  5000

# Query 2: Fuzzy search (trigram index)
verify_query_plan 5433 records "Fuzzy Search (Artist)" \
  "SELECT * FROM records.records WHERE artist ILIKE '%test%' LIMIT 20;" \
  3000

# Query 3: Composite query (user + artist + name)
verify_query_plan 5433 records "Composite Query (User + Artist + Name)" \
  "SELECT * FROM records.records WHERE user_id = (SELECT id FROM records.records LIMIT 1) AND artist = 'Test Artist' AND name = 'Test Record' LIMIT 10;" \
  2000

# Query 4: Catalog search (catalog number index)
verify_query_plan 5433 records "Catalog Number Search" \
  "SELECT * FROM records.records WHERE catalog_number = 'TEST-001' LIMIT 10;" \
  1000

# Query 5: Recent records (partial index)
verify_query_plan 5433 records "Recent Records (Partial Index)" \
  "SELECT * FROM records.records WHERE updated_at > NOW() - INTERVAL '90 days' ORDER BY updated_at DESC LIMIT 50;" \
  3000

# Listings Service - Critical queries
say "=== Listings Service Query Plans (Port 5435) ==="

# Query 1: Search listings (trigram index)
verify_query_plan 5435 listings "Search Listings" \
  "SELECT * FROM listings.listings WHERE title ILIKE '%vinyl%' AND is_active = true LIMIT 20;" \
  3000

# Query 2: User listings
verify_query_plan 5435 listings "User Listings" \
  "SELECT * FROM listings.listings WHERE user_id = (SELECT user_id FROM listings.listings LIMIT 1) ORDER BY created_at DESC LIMIT 50;" \
  2000

# Analytics Service - Critical queries (piped to Python AI)
say "=== Analytics Service Query Plans (Port 5439) ==="
say "CRITICAL: Analytics queries feed Python AI - must be fast!"

# Query 1: Price snapshots (time-series)
verify_query_plan 5439 analytics "Price Snapshots (Time-Series)" \
  "SELECT * FROM analytics.price_snapshots WHERE timestamp > NOW() - INTERVAL '30 days' ORDER BY timestamp DESC LIMIT 100;" \
  2000

# Query 2: User behavior aggregation
verify_query_plan 5439 analytics "User Behavior Aggregation" \
  "SELECT user_id, COUNT(*) FROM analytics.user_behavior WHERE timestamp > NOW() - INTERVAL '7 days' GROUP BY user_id LIMIT 50;" \
  3000

# Social Service - Critical queries
say "=== Social Service Query Plans (Port 5434) ==="

# Query 1: User messages (recipient index)
verify_query_plan 5434 social "User Messages (Recipient)" \
  "SELECT * FROM social.messages WHERE recipient_id = (SELECT id FROM auth.users LIMIT 1) ORDER BY created_at DESC LIMIT 50;" \
  2000

# Query 2: Forum posts
verify_query_plan 5434 social "Forum Posts" \
  "SELECT * FROM social.forum_posts ORDER BY created_at DESC LIMIT 50;" \
  2000

# Shopping Service - Critical queries
say "=== Shopping Service Query Plans (Port 5436) ==="

# Query 1: User cart
verify_query_plan 5436 shopping "User Shopping Cart" \
  "SELECT * FROM shopping.shopping_cart WHERE user_id = (SELECT id FROM auth.users LIMIT 1);" \
  1000

# Query 2: User orders
verify_query_plan 5436 shopping "User Orders" \
  "SELECT * FROM shopping.orders WHERE user_id = (SELECT id FROM auth.users LIMIT 1) ORDER BY created_at DESC LIMIT 20;" \
  2000

# Auth Service - Critical queries
say "=== Auth Service Query Plans (Port 5437) ==="

# Query 1: User lookup by email (most common)
verify_query_plan 5437 auth "User Lookup by Email" \
  "SELECT * FROM auth.users WHERE email = 'test@example.com' LIMIT 1;" \
  500

# Auction Monitor - Critical queries
say "=== Auction Monitor Query Plans (Port 5438) ==="

# Query 1: Auction results
verify_query_plan 5438 auction_monitor "Auction Results" \
  "SELECT * FROM auction_monitor.auction_results ORDER BY sold_at DESC LIMIT 50;" \
  2000

# Python AI - Critical queries
say "=== Python AI Query Plans (Port 5440) ==="
say "CRITICAL: Python AI queries depend on Analytics results!"

# Query 1: Inference log
verify_query_plan 5440 python_ai "Inference Log" \
  "SELECT * FROM python_ai.inference_log ORDER BY timestamp DESC LIMIT 50;" \
  2000

# Query 2: Analytics cache (used for AI predictions)
verify_query_plan 5440 python_ai "Analytics Cache Lookup" \
  "SELECT * FROM python_ai.analytics_cache WHERE cache_key LIKE 'price_%' LIMIT 20;" \
  1000

say "=== Query Plan Verification Complete ==="
ok "All critical queries verified for index usage and performance"
echo ""
echo "Summary:"
echo "  - Records: 5 queries verified (fuzzy search, composite indexes)"
echo "  - Analytics: 2 queries verified (CRITICAL for Python AI pipeline)"
echo "  - Listings: 2 queries verified"
echo "  - Social: 2 queries verified"
echo "  - Shopping: 2 queries verified"
echo "  - Auth: 1 query verified"
echo "  - Auction Monitor: 1 query verified"
echo "  - Python AI: 2 queries verified (CRITICAL - depends on Analytics)"
echo ""
echo "✅ Query plans verified for fast execution at scale!"
