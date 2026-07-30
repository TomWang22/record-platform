#!/usr/bin/env bash
set -euo pipefail

# Comprehensive Index Optimizations for All Databases
# - Trigram indexes (fuzzy search)
# - Composite indexes (multi-column)
# - Hot tenant indexes (high-traffic users)
# - Hot sharding indexes (time-based partitioning)
# - Covering indexes (index-only scans)
# - Partial indexes (filtered)

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "=== Comprehensive Index Optimizations for All Databases ==="

# Records Service (Port 5433) - Most Critical
say "=== Records Service: Comprehensive Index Strategy ==="
PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d records << 'RECORDSEOF'
-- Ensure extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- TRIGRAM INDEXES (fuzzy search)
CREATE INDEX IF NOT EXISTS idx_records_artist_trgm
  ON records.records USING GIN (artist gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_records_name_trgm
  ON records.records USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_records_catalog_trgm
  ON records.records USING GIN (catalog_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_records_artist_name_trgm
  ON records.records USING GIN ((artist || ' ' || name) gin_trgm_ops);

-- COMPOSITE INDEXES
CREATE INDEX IF NOT EXISTS idx_records_user_updated_composite
  ON records.records (user_id, updated_at DESC NULLS LAST)
  INCLUDE (id, artist, name, format, catalog_number);

CREATE INDEX IF NOT EXISTS idx_records_user_artist_name_composite
  ON records.records (user_id, artist, name)
  INCLUDE (id, format, catalog_number, record_grade, sleeve_grade);

CREATE INDEX IF NOT EXISTS idx_records_artist_name_format_composite
  ON records.records (artist, name, format)
  INCLUDE (catalog_number, record_grade, sleeve_grade);

-- HOT TENANT INDEXES
CREATE INDEX IF NOT EXISTS idx_records_hot_tenant_recent
  ON records.records (user_id, updated_at DESC NULLS LAST)
  WHERE updated_at > CURRENT_DATE - INTERVAL '30 days'
  INCLUDE (id, artist, name, format, catalog_number);

CREATE INDEX IF NOT EXISTS idx_records_hot_tenant_all
  ON records.records (user_id, updated_at DESC NULLS LAST)
  INCLUDE (id, artist, name, format, catalog_number, record_grade, sleeve_grade);

-- HOT SHARDING INDEXES
CREATE INDEX IF NOT EXISTS idx_records_monthly_shard
  ON records.records (DATE_TRUNC('month', updated_at), user_id)
  INCLUDE (id, artist, name, format, catalog_number);

CREATE INDEX IF NOT EXISTS idx_records_yearly_shard
  ON records.records (DATE_TRUNC('year', updated_at), user_id)
  INCLUDE (id, artist, name, format, catalog_number);

ANALYZE records.records;
ok "Records service: Trigram, composite, hot tenant, hot sharding indexes created"
RECORDSEOF

# Listings Service (Port 5435)
say "=== Listings Service: Comprehensive Index Strategy ==="
PGPASSWORD=postgres psql -h localhost -p 5435 -U postgres -d records << 'LISTINGSEOF'
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram indexes for listings search
CREATE INDEX IF NOT EXISTS idx_listings_title_trgm
  ON listings.listings USING GIN (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_listings_artist_trgm
  ON listings.listings USING GIN (artist gin_trgm_ops);

-- Composite indexes
CREATE INDEX IF NOT EXISTS idx_listings_user_status_composite
  ON listings.listings (user_id, status, updated_at DESC)
  INCLUDE (id, title, artist, price, format);

-- Hot tenant index
CREATE INDEX IF NOT EXISTS idx_listings_hot_tenant
  ON listings.listings (user_id, updated_at DESC)
  WHERE status = 'active'
  INCLUDE (id, title, artist, price, format);

ANALYZE listings.listings;
ok "Listings service: Trigram, composite, hot tenant indexes created"
LISTINGSEOF

# Analytics Service (Port 5439) - Critical for Python AI
say "=== Analytics Service: Comprehensive Index Strategy ==="
PGPASSWORD=postgres psql -h localhost -p 5439 -U postgres -d records << 'ANALYTICSEOF'
-- Composite indexes for time-series queries
CREATE INDEX IF NOT EXISTS idx_price_snapshots_timestamp_item_composite
  ON analytics.price_snapshots (timestamp DESC, item_id)
  INCLUDE (price, currency, source);

-- Hot sharding index (time-based)
CREATE INDEX IF NOT EXISTS idx_price_snapshots_monthly_shard
  ON analytics.price_snapshots (DATE_TRUNC('month', timestamp), item_id)
  INCLUDE (price, currency);

-- User behavior composite
CREATE INDEX IF NOT EXISTS idx_user_behavior_user_timestamp_composite
  ON analytics.user_behavior (user_id, event_timestamp DESC)
  INCLUDE (event_type, metadata);

ANALYZE analytics.price_snapshots;
ANALYZE analytics.user_behavior;
ok "Analytics service: Composite, hot sharding indexes created"
ANALYTICSEOF

# Messaging Service (Port 5434)
say "=== Messaging Service: Comprehensive Index Strategy ==="
PGPASSWORD=postgres psql -h localhost -p 5434 -U postgres -d records << 'SOCIALEOF'
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram for forum posts search
CREATE INDEX IF NOT EXISTS idx_forum_posts_content_trgm
  ON forum.posts USING GIN (content gin_trgm_ops);

-- Composite indexes
CREATE INDEX IF NOT EXISTS idx_forum_posts_user_created_composite
  ON forum.posts (user_id, created_at DESC)
  INCLUDE (id, title, content);

-- Hot tenant index
CREATE INDEX IF NOT EXISTS idx_forum_posts_hot_tenant
  ON forum.posts (user_id, created_at DESC)
  WHERE created_at > CURRENT_DATE - INTERVAL '30 days'
  INCLUDE (id, title, content);

ANALYZE forum.posts;
ok "messaging-plane: Trigram, composite, hot tenant indexes created"
SOCIALEOF

# Shopping Service (Port 5436)
say "=== Shopping Service: Comprehensive Index Strategy ==="
PGPASSWORD=postgres psql -h localhost -p 5436 -U postgres -d shopping << 'SHOPPINGEOF'
-- Composite indexes for cart operations
CREATE INDEX IF NOT EXISTS idx_cart_user_updated_composite
  ON shopping.shopping_cart (user_id, updated_at DESC)
  INCLUDE (id, items, total_amount);

-- Hot tenant index
CREATE INDEX IF NOT EXISTS idx_cart_hot_tenant
  ON shopping.shopping_cart (user_id, updated_at DESC)
  WHERE updated_at > CURRENT_DATE - INTERVAL '7 days'
  INCLUDE (id, items, total_amount);

ANALYZE shopping.shopping_cart;
ok "Shopping service: Composite, hot tenant indexes created"
SHOPPINGEOF

# Auth Service (Port 5437)
say "=== Auth Service: Comprehensive Index Strategy ==="
PGPASSWORD=postgres psql -h localhost -p 5437 -U postgres -d records << 'AUTHEOF'
-- Composite indexes for user lookups
CREATE INDEX IF NOT EXISTS idx_users_email_composite
  ON auth.users (email, created_at DESC)
  INCLUDE (id, username, status);

-- Hot tenant index (active users)
CREATE INDEX IF NOT EXISTS idx_users_hot_active
  ON auth.users (status, last_login DESC)
  WHERE status = 'active'
  INCLUDE (id, email, username);

ANALYZE auth.users;
ok "Auth service: Composite, hot tenant indexes created"
AUTHEOF

# Auction Monitor Service (Port 5438)
say "=== Auction Monitor Service: Comprehensive Index Strategy ==="
PGPASSWORD=postgres psql -h localhost -p 5438 -U postgres -d records << 'AUCTIONEOF'
-- Composite indexes for auction queries
CREATE INDEX IF NOT EXISTS idx_auction_results_timestamp_item_composite
  ON auction_monitor.auction_results (timestamp DESC, item_id)
  INCLUDE (final_price, bid_count);

-- Hot sharding index
CREATE INDEX IF NOT EXISTS idx_auction_results_monthly_shard
  ON auction_monitor.auction_results (DATE_TRUNC('month', timestamp), item_id)
  INCLUDE (final_price, bid_count);

ANALYZE auction_monitor.auction_results;
ok "Auction monitor service: Composite, hot sharding indexes created"
AUCTIONEOF

# Python AI Service (Port 5440)
say "=== Python AI Service: Comprehensive Index Strategy ==="
PGPASSWORD=postgres psql -h localhost -p 5440 -U postgres -d records << 'PYTHONAIEEEOF'
-- Composite indexes for AI queries
CREATE INDEX IF NOT EXISTS idx_price_predictions_model_timestamp_composite
  ON ai.price_predictions (model_id, predicted_at DESC)
  INCLUDE (item_id, predicted_price, confidence);

-- Hot sharding index
CREATE INDEX IF NOT EXISTS idx_price_predictions_monthly_shard
  ON ai.price_predictions (DATE_TRUNC('month', predicted_at), model_id)
  INCLUDE (item_id, predicted_price);

ANALYZE ai.price_predictions;
ok "Python AI service: Composite, hot sharding indexes created"
PYTHONAIEEEOF

say "=== Comprehensive Index Optimizations Complete ==="
ok "All databases optimized with:"
ok "  - Trigram indexes (fuzzy search)"
ok "  - Composite indexes (multi-column)"
ok "  - Hot tenant indexes (high-traffic users)"
ok "  - Hot sharding indexes (time-based partitioning)"
ok "  - Covering indexes (index-only scans)"
ok "  - Partial indexes (filtered)"
