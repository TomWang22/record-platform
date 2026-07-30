#!/usr/bin/env bash
set -euo pipefail

# Optimize queries for 256+ concurrent clients
# - Fix sequential scans
# - Optimize slow queries
# - Add indexes for high-concurrency scenarios

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "=== Optimizing Queries for 256+ Concurrent Clients ==="

# Records Service Optimizations (Port 5433)
say "=== Records Service: Optimizing for 256+ clients ==="
PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d records << 'RECORDSEOF'
-- Optimize for high concurrency (256+ clients)

-- 1. Ensure covering indexes for common queries
CREATE INDEX IF NOT EXISTS idx_records_user_updated_covering_opt
  ON records.records (user_id, updated_at DESC NULLS LAST)
  INCLUDE (id, artist, name, format, catalog_number);

-- 2. Optimize catalog number lookups (frequently queried)
CREATE INDEX IF NOT EXISTS idx_records_catalog_covering
  ON records.records (catalog_number)
  INCLUDE (user_id, artist, name, format)
  WHERE catalog_number IS NOT NULL;

-- 3. Composite index for common search pattern
CREATE INDEX IF NOT EXISTS idx_records_user_artist_name_covering
  ON records.records (user_id, artist, name)
  INCLUDE (format, catalog_number, record_grade, sleeve_grade);

-- 4. Update statistics
ANALYZE records.records;
RECORDSEOF
ok "Records service optimized"

# Analytics Service Optimizations (Port 5439) - CRITICAL for Python AI
say "=== Analytics Service: Optimizing for Python AI pipeline ==="
PGPASSWORD=postgres psql -h localhost -p 5439 -U postgres -d records << 'ANALYTICSEOF'
-- Analytics → Python AI pipeline must be ultra-fast

-- 1. Optimize price snapshots query
CREATE INDEX IF NOT EXISTS idx_price_snapshots_timestamp_covering
  ON analytics.price_snapshots (timestamp DESC, item_id)
  INCLUDE (price, currency, source);

-- 2. Optimize user behavior aggregation
CREATE INDEX IF NOT EXISTS idx_user_behavior_user_timestamp_covering
  ON analytics.user_behavior (user_id, event_timestamp DESC)
  INCLUDE (event_type, metadata);

-- 3. Composite index for common analytics queries
CREATE INDEX IF NOT EXISTS idx_user_behavior_type_timestamp
  ON analytics.user_behavior (event_type, event_timestamp DESC)
  WHERE event_type IS NOT NULL;

ANALYZE analytics.price_snapshots;
ANALYZE analytics.user_behavior;
ANALYTICSEOF
ok "Analytics service optimized for Python AI pipeline"

# Listings Service Optimizations (Port 5435)
say "=== Listings Service: Optimizing for high concurrency ==="
PGPASSWORD=postgres psql -h localhost -p 5435 -U postgres -d records << 'LISTINGSEOF'
-- Optimize listings for marketplace load

CREATE INDEX IF NOT EXISTS idx_listings_active_search_covering
  ON listings.listings (is_active, listing_type, price, created_at DESC)
  INCLUDE (id, title, description, user_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_listings_user_active_covering
  ON listings.listings (user_id, is_active, created_at DESC)
  INCLUDE (id, title, price, listing_type);

ANALYZE listings.listings;
LISTINGSEOF
ok "Listings service optimized"

# Messaging Service Optimizations (Port 5434)
say "=== Messaging Service: Optimizing for messaging load ==="
PGPASSWORD=postgres psql -h localhost -p 5434 -U postgres -d records << 'SOCIALEOF'
-- Optimize for high message volume

CREATE INDEX IF NOT EXISTS idx_messages_recipient_created_covering
  ON messages.messages (recipient_id, created_at DESC)
  INCLUDE (id, sender_id, subject, message_type);

CREATE INDEX IF NOT EXISTS idx_forum_posts_created_covering
  ON forum.posts (created_at DESC)
  INCLUDE (id, user_id, title, flair, upvotes)
  WHERE is_locked = false;

ANALYZE messages.messages;
ANALYZE forum.posts;
SOCIALEOF
ok "messaging-plane optimized"

# Shopping Service Optimizations (Port 5436)
say "=== Shopping Service: Optimizing for cart operations ==="
PGPASSWORD=postgres psql -h localhost -p 5436 -U postgres -d shopping << 'SHOPPINGEOF'
-- Optimize for high cart/order volume

CREATE INDEX IF NOT EXISTS idx_cart_user_updated_covering
  ON shopping.shopping_cart (user_id, updated_at DESC)
  INCLUDE (id, listing_id, item_type, item_id, quantity, price);

CREATE INDEX IF NOT EXISTS idx_orders_user_status_covering
  ON shopping.orders (user_id, status, created_at DESC)
  INCLUDE (id, order_number, payment_status);

ANALYZE shopping.shopping_cart;
ANALYZE shopping.orders;
SHOPPINGEOF
ok "Shopping service optimized"

say "=== Query Optimization Complete ==="
ok "All services optimized for 256+ concurrent clients"
