#!/usr/bin/env bash
set -euo pipefail

# Restore SQL Backups and Apply Database Tuning
# This script restores all database backups step by step, then applies tuning

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${SCRIPT_DIR}/../backups"
DB_TUNE_DIR="${SCRIPT_DIR}/../infra/db"

# Database mapping: backup file -> port -> database name
# Port mapping per README.md:
# 5433: Main DB (records schema)
# 5434: Social DB (social schema)
# 5435: Listings DB (listings schema)
# 5436: Shopping DB (shopping schema)
# 5437: Auth DB (auth schema)
# 5438: Auction Monitor DB (auction_monitor schema)
# 5439: Analytics DB (analytics schema)
# 5440: Python AI DB (python_ai schema)
declare -A DB_MAP
DB_MAP[record-platform-postgres-1-all-20260101-223214.sql]="5433:records"
DB_MAP[record-platform-postgres-auth-1-all-20260101-223214.sql]="5437:records"
DB_MAP[record-platform-postgres-social-1-all-20260101-223214.sql]="5434:records"
DB_MAP[record-platform-postgres-listings-1-all-20260101-223214.sql]="5435:records"
DB_MAP[record-platform-postgres-shopping-1-all-20260101-223214.sql]="5436:shopping"
DB_MAP[record-platform-postgres-analytics-1-all-20260101-223214.sql]="5439:records"
DB_MAP[record-platform-postgres-auction-monitor-1-all-20260101-223214.sql]="5438:records"
DB_MAP[record-platform-postgres-python-ai-1-all-20260101-223214.sql]="5440:records"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

# Step 1: Restore all databases
restore_databases() {
  say "=== Step 1: Restoring SQL Backups ==="
  
  for backup_file in "${!DB_MAP[@]}"; do
    IFS=':' read -r port db_name <<< "${DB_MAP[$backup_file]}"
    backup_path="${BACKUP_DIR}/${backup_file}"
    
    if [[ ! -f "$backup_path" ]]; then
      warn "Backup file not found: $backup_path"
      continue
    fi
    
    say "Restoring $backup_file to port $port (database: $db_name)..."
    
    # Check file size (skip if too large for interactive restore)
    file_size=$(du -h "$backup_path" | cut -f1)
    echo "  File size: $file_size"
    
    # Restore (this may take time for large files)
    if PGPASSWORD=postgres psql -h localhost -p "$port" -U postgres -d "$db_name" < "$backup_path" > /tmp/restore-${backup_file}.log 2>&1; then
      ok "Restored $backup_file"
    else
      warn "Restore failed for $backup_file (check /tmp/restore-${backup_file}.log)"
    fi
  done
  
  ok "Database restoration complete"
}

# Step 2: Extract and apply tuning from backups
extract_tuning_from_backups() {
  say "=== Step 2: Extracting Tuning Settings from Backups ==="
  
  # Extract autovacuum settings
  say "Extracting autovacuum settings..."
  grep -h "autovacuum.*=" "$BACKUP_DIR"/record-platform-postgres-*-all-20260101-223214.sql | sort -u > /tmp/autovacuum_settings.txt || true
  
  # Extract trigram indexes
  say "Extracting trigram index definitions..."
  grep -h "CREATE.*INDEX.*trgm\|CREATE.*INDEX.*gin.*trgm\|CREATE.*INDEX.*gist.*trgm" "$BACKUP_DIR"/record-platform-postgres-*-all-20260101-223214.sql | sort -u > /tmp/trigram_indexes.txt || true
  
  # Extract hot sharding/indexes
  say "Extracting hot sharding/index definitions..."
  grep -h "records_hot\|hot.*index\|hot.*shard" "$BACKUP_DIR"/record-platform-postgres-*-all-20260101-223214.sql -i | sort -u > /tmp/hot_definitions.txt || true
  
  ok "Tuning settings extracted (see /tmp/*.txt)"
}

# Step 3: Apply comprehensive tuning for each database
tune_database() {
  local port=$1
  local db_name=$2
  local service_name=$3
  
  say "Tuning database $db_name (port $port) for $service_name..."
  
  # Apply service-specific tuning based on workload
  case "$service_name" in
    records)
      apply_records_tuning "$port" "$db_name"  # Read-heavy, fuzzy search, 2.4M+ records
      ;;
    listings)
      apply_listings_tuning "$port" "$db_name"  # Write-heavy, auctions
      ;;
    shopping)
      apply_generic_tuning "$port" "$db_name"  # Write-heavy, carts/orders (covered in comprehensive)
      ;;
    *)
      apply_generic_tuning "$port" "$db_name"  # Generic tuning for others
      ;;
  esac
}

# Records service tuning (most complex - comprehensive)
apply_records_tuning() {
  local port=$1
  local db_name=$2
  
  say "Applying Records Service comprehensive tuning (read/write heavy)..."
  say "  - Partial indexes (hot tenant, recent records)"
  say "  - Composite indexes (multi-column queries)"
  say "  - Trigram indexes (fuzzy search)"
  say "  - Covering indexes (index-only scans)"
  say "  - Worker threads & memory (4 workers, 12 processes)"
  say "  - Disable sequential scans (force index usage)"
  say "  - Balanced autovacuum (read/write heavy - collectors constantly adding/updating)"
  
  # Apply comprehensive tuning SQL file
  if [[ -f "${SCRIPT_DIR}/../infra/db/comprehensive-db-tuning.sql" ]]; then
    PGPASSWORD=postgres psql -h localhost -p "$port" -U postgres -d "$db_name" \
      -f "${SCRIPT_DIR}/../infra/db/comprehensive-db-tuning.sql" \
      2>&1 | tee /tmp/tune-records.log
  else
    warn "comprehensive-db-tuning.sql not found, using basic tuning..."
    # Fallback to basic tuning
    PGPASSWORD=postgres psql -h localhost -p "$port" -U postgres -d "$db_name" << 'EOF' 2>&1 | tee /tmp/tune-records.log
CREATE EXTENSION IF NOT EXISTS pg_trgm;
ALTER TABLE records.records SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.05);
ANALYZE records.records;
EOF
  fi
  
  ok "Records service comprehensive tuning applied"
}

# Listings service tuning
apply_listings_tuning() {
  local port=$1
  local db_name=$2
  
  say "Applying Listings Service tuning..."
  
  PGPASSWORD=postgres psql -h localhost -p "$port" -U postgres -d "$db_name" << 'EOF' 2>&1 | tee /tmp/tune-listings.log
  
-- 1. Enable pg_trgm extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Trigram indexes for search
CREATE INDEX IF NOT EXISTS idx_search_q_trgm ON listings.search_history USING gin (q gin_trgm_ops);

-- 3. Autovacuum tuning (write-heavy workload)
ALTER TABLE listings.listings SET (autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE listings.auction_details SET (autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_scale_factor = 0.05);

-- 4. Statistics
ANALYZE listings.listings;
ANALYZE listings.auction_details;

EOF
  ok "Listings service tuning applied"
}

# Generic tuning for other services
apply_generic_tuning() {
  local port=$1
  local db_name=$2
  
  say "Applying generic tuning..."
  
  PGPASSWORD=postgres psql -h localhost -p "$port" -U postgres -d "$db_name" << 'EOF' 2>&1 | tee /tmp/tune-generic-${port}.log
  
-- Autovacuum tuning for write-heavy workloads
ALTER TABLE IF EXISTS shopping.shopping_cart SET (autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE IF EXISTS shopping.orders SET (autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE IF EXISTS shopping.purchase_history SET (autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_scale_factor = 0.05);

-- Update statistics
ANALYZE;

EOF
  ok "Generic tuning applied"
}

# Service-specific tuning functions
apply_social_tuning() {
  local port=$1
  local db_name=$2
  
  say "Applying Messaging Service tuning (write-heavy, messaging)..."
  say "  - Composite indexes for user + message lookups"
  say "  - Forum posts indexes"
  say "  - Autovacuum tuning (write-heavy)"
  
  PGPASSWORD=postgres psql -h localhost -p "$port" -U postgres -d "$db_name" << 'EOF' 2>&1 | tee /tmp/tune-social.log
-- messaging-plane specific tuning (write-heavy, messaging)
CREATE INDEX IF NOT EXISTS idx_messages_user_created ON social.messages (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_created ON social.messages (recipient_id, created_at DESC) WHERE recipient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_forum_posts_user_created ON social.forum_posts (user_id, created_at DESC);
ALTER TABLE IF EXISTS social.messages SET (autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE IF EXISTS social.forum_posts SET (autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_scale_factor = 0.05);
ANALYZE social.messages;
ANALYZE social.forum_posts;
EOF
  
  ok "messaging-plane tuning applied"
}

apply_auth_tuning() {
  local port=$1
  local db_name=$2
  
  say "Applying Auth Service tuning (read-heavy, user lookups)..."
  say "  - User lookup indexes (email, id)"
  say "  - OAuth token indexes"
  say "  - Autovacuum tuning (read-heavy)"
  
  PGPASSWORD=postgres psql -h localhost -p "$port" -U postgres -d "$db_name" << 'EOF' 2>&1 | tee /tmp/tune-auth.log
CREATE INDEX IF NOT EXISTS idx_users_email ON auth.users (email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user ON auth.oauth_tokens (user_id, expires_at);
ALTER TABLE IF EXISTS auth.users SET (autovacuum_vacuum_scale_factor = 0.2, autovacuum_analyze_scale_factor = 0.1);
ANALYZE auth.users;
EOF
  ok "Auth service tuning applied"
}

apply_analytics_tuning() {
  local port=$1
  local db_name=$2
  
  say "Applying Analytics Service tuning (read-heavy, aggregations)..."
  say "  - Time-series indexes"
  say "  - GIN index for metadata (JSON)"
  say "  - Autovacuum tuning (read-heavy)"
  
  PGPASSWORD=postgres psql -h localhost -p "$port" -U postgres -d "$db_name" << 'EOF' 2>&1 | tee /tmp/tune-analytics.log
CREATE INDEX IF NOT EXISTS idx_price_snapshots_timestamp ON analytics.price_snapshots (timestamp DESC, item_id);
CREATE INDEX IF NOT EXISTS idx_user_behavior_metadata ON analytics.user_behavior USING gin (metadata) WHERE metadata IS NOT NULL;
ALTER TABLE IF EXISTS analytics.price_snapshots SET (autovacuum_vacuum_scale_factor = 0.2, autovacuum_analyze_scale_factor = 0.1);
ANALYZE analytics.price_snapshots;
EOF
  ok "Analytics service tuning applied"
}

apply_auction_monitor_tuning() {
  local port=$1
  local db_name=$2
  
  say "Applying Auction Monitor tuning (read-heavy, price tracking)..."
  say "  - Auction results indexes"
  say "  - Full-text search indexes"
  say "  - Autovacuum tuning (read-heavy)"
  
  PGPASSWORD=postgres psql -h localhost -p "$port" -U postgres -d "$db_name" << 'EOF' 2>&1 | tee /tmp/tune-auction-monitor.log
CREATE INDEX IF NOT EXISTS idx_auction_results_item_timestamp ON auction_monitor.auction_results (item_id, sold_at DESC);
ALTER TABLE IF EXISTS auction_monitor.auction_results SET (autovacuum_vacuum_scale_factor = 0.2, autovacuum_analyze_scale_factor = 0.1);
ANALYZE auction_monitor.auction_results;
EOF
  ok "Auction Monitor tuning applied"
}

apply_python_ai_tuning() {
  local port=$1
  local db_name=$2
  
  say "Applying Python AI tuning (read/write mix)..."
  say "  - Inference log indexes"
  say "  - Analytics cache indexes"
  say "  - Autovacuum tuning (balanced)"
  
  PGPASSWORD=postgres psql -h localhost -p "$port" -U postgres -d "$db_name" << 'EOF' 2>&1 | tee /tmp/tune-python-ai.log
CREATE INDEX IF NOT EXISTS idx_inference_log_timestamp ON python_ai.inference_log (timestamp DESC, user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_cache_key ON python_ai.analytics_cache (cache_key);
ALTER TABLE IF EXISTS python_ai.inference_log SET (autovacuum_vacuum_scale_factor = 0.1, autovacuum_analyze_scale_factor = 0.05);
ANALYZE python_ai.inference_log;
EOF
  ok "Python AI tuning applied"
}

# Step 4: Apply tuning to all databases with service-specific tuning
apply_all_tuning() {
  say "=== Step 3: Applying Database Tuning (Service-Specific) ==="
  
  # Records (read/write heavy, fuzzy search, 2.4M+ records, collectors add/update) - comprehensive tuning
  tune_database 5433 records records
  
  # Social (write-heavy, messaging) - write-optimized
  apply_social_tuning 5434 records
  
  # Listings (write-heavy, auctions) - already handled in comprehensive tuning
  tune_database 5435 records listings
  
  # Shopping (write-heavy, carts/orders) - already handled in comprehensive tuning
  tune_database 5436 shopping shopping
  
  # Auth (read-heavy, user lookups) - read-optimized
  apply_auth_tuning 5437 records
  
  # Analytics (read-heavy, aggregations) - read-optimized
  apply_analytics_tuning 5439 records
  
  # Auction Monitor (read-heavy, price tracking) - read-optimized
  apply_auction_monitor_tuning 5438 records
  
  # Python AI (read/write mix) - balanced
  apply_python_ai_tuning 5440 records
  
  ok "All service-specific tuning applied"
}

# Step 5: Verify tuning
verify_tuning() {
  say "=== Step 4: Verifying Tuning ==="
  
  say "Checking indexes and extensions..."
  for backup_file in "${!DB_MAP[@]}"; do
    IFS=':' read -r port db_name <<< "${DB_MAP[$backup_file]}"
    service_name=$(echo "$backup_file" | sed -E 's/record-platform-postgres-(.*)-1-all.*/\1/')
    
    echo ""
    echo "=== $service_name (port $port) ==="
    PGPASSWORD=postgres psql -h localhost -p "$port" -U postgres -d "$db_name" -c "
      SELECT extname FROM pg_extension WHERE extname = 'pg_trgm';
      SELECT COUNT(*) as trigram_indexes FROM pg_indexes WHERE indexdef LIKE '%trgm%';
    " 2>&1 | head -5
  done
  
  ok "Tuning verification complete"
}

# Main execution
main() {
  say "=== Database Restore and Tuning Plan ==="
  say "This will restore all backups and apply comprehensive tuning"
  say ""
  echo "Steps:"
  echo "  1. Restore all SQL backup files"
  echo "  2. Extract tuning settings from backups"
  echo "  3. Apply comprehensive tuning (trigram, autovacuum, hot indexes)"
  echo "  4. Verify tuning"
  echo ""
  read -p "Continue? (y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 0
  fi
  
  restore_databases
  extract_tuning_from_backups
  apply_all_tuning
  verify_tuning
  
  say "=== Complete! ==="
  say "Next steps:"
  say "  1. Run smoke test: scripts/test-microservices-http2-http3.sh"
  say "  2. Run pgbench scripts for performance validation"
  say "  3. Monitor query plans: EXPLAIN ANALYZE on slow queries"
}

main "$@"
