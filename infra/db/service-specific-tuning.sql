-- Service-Specific Database Tuning
-- Each database gets tuning optimized for its workload

-- ============================================================
-- SOCIAL SERVICE (Port 5434) - Write-Heavy, Messaging
-- ============================================================

-- Composite indexes for user + message lookups
CREATE INDEX IF NOT EXISTS idx_messages_user_created 
  ON social.messages (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_recipient_created 
  ON social.messages (recipient_id, created_at DESC) 
  WHERE recipient_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_group_created 
  ON social.messages (group_id, created_at DESC) 
  WHERE group_id IS NOT NULL;

-- Forum posts indexes
CREATE INDEX IF NOT EXISTS idx_forum_posts_created 
  ON social.forum_posts (created_at DESC, flair);

CREATE INDEX IF NOT EXISTS idx_forum_posts_user_created 
  ON social.forum_posts (user_id, created_at DESC);

-- Partial index for active messages
CREATE INDEX IF NOT EXISTS idx_messages_active_user 
  ON social.messages (user_id, created_at DESC) 
  WHERE created_at > NOW() - INTERVAL '90 days';

-- Autovacuum (write-heavy)
ALTER TABLE IF EXISTS social.messages SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_scale_factor = 0.05
);

ALTER TABLE IF EXISTS social.forum_posts SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_scale_factor = 0.05
);

ANALYZE social.messages;
ANALYZE social.forum_posts;

-- ============================================================
-- AUTH SERVICE (Port 5437) - Read-Heavy, User Lookups
-- ============================================================

-- User lookup indexes (most common query)
CREATE INDEX IF NOT EXISTS idx_users_email 
  ON auth.users (email) 
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_id 
  ON auth.users (id);

-- OAuth tokens (read-heavy)
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user 
  ON auth.oauth_tokens (user_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_oauth_tokens_token 
  ON auth.oauth_tokens (token) 
  WHERE token IS NOT NULL;

-- JWT revocation (write-heavy during logout)
CREATE INDEX IF NOT EXISTS idx_token_revocations_token 
  ON auth.token_revocations (token);

-- Partial index for active tokens
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_active 
  ON auth.oauth_tokens (user_id, expires_at) 
  WHERE expires_at > NOW();

-- Autovacuum (read-heavy, less aggressive)
ALTER TABLE IF EXISTS auth.users SET (
  autovacuum_vacuum_scale_factor = 0.2,
  autovacuum_analyze_scale_factor = 0.1
);

ANALYZE auth.users;
ANALYZE auth.oauth_tokens;

-- ============================================================
-- ANALYTICS SERVICE (Port 5438) - Read-Heavy, Aggregations
-- ============================================================

-- Time-series indexes (for price snapshots, analytics)
CREATE INDEX IF NOT EXISTS idx_price_snapshots_timestamp 
  ON analytics.price_snapshots (timestamp DESC, item_id);

CREATE INDEX IF NOT EXISTS idx_price_snapshots_item_timestamp 
  ON analytics.price_snapshots (item_id, timestamp DESC);

-- User behavior indexes
CREATE INDEX IF NOT EXISTS idx_user_behavior_user_timestamp 
  ON analytics.user_behavior (user_id, timestamp DESC);

-- Partial index for recent data (most queries)
CREATE INDEX IF NOT EXISTS idx_price_snapshots_recent 
  ON analytics.price_snapshots (timestamp DESC, item_id) 
  WHERE timestamp > NOW() - INTERVAL '90 days';

-- GIN index for metadata (JSON queries)
CREATE INDEX IF NOT EXISTS idx_user_behavior_metadata 
  ON analytics.user_behavior USING gin (metadata) 
  WHERE metadata IS NOT NULL;

-- Autovacuum (read-heavy, append-only)
ALTER TABLE IF EXISTS analytics.price_snapshots SET (
  autovacuum_vacuum_scale_factor = 0.2,
  autovacuum_analyze_scale_factor = 0.1
);

ANALYZE analytics.price_snapshots;
ANALYZE analytics.user_behavior;

-- ============================================================
-- AUCTION MONITOR SERVICE (Port 5439) - Read-Heavy, Price Tracking
-- ============================================================

-- Auction results indexes
CREATE INDEX IF NOT EXISTS idx_auction_results_item_timestamp 
  ON auction_monitor.auction_results (item_id, sold_at DESC);

CREATE INDEX IF NOT EXISTS idx_auction_results_sold_at 
  ON auction_monitor.auction_results (sold_at DESC, price);

-- Watchlist indexes (linked to listings)
CREATE INDEX IF NOT EXISTS idx_watchlist_user_source 
  ON listings.watchlist (user_id, source, query);

-- Partial index for recent auctions
CREATE INDEX IF NOT EXISTS idx_auction_results_recent 
  ON auction_monitor.auction_results (sold_at DESC) 
  WHERE sold_at > NOW() - INTERVAL '90 days';

-- Full-text search on auction results
CREATE INDEX IF NOT EXISTS idx_auction_results_search 
  ON auction_monitor.auction_results USING gin (
    to_tsvector('simple', COALESCE(title, '') || ' ' || COALESCE(artist, '') || ' ' || COALESCE(label, ''))
  );

-- Autovacuum (read-heavy)
ALTER TABLE IF EXISTS auction_monitor.auction_results SET (
  autovacuum_vacuum_scale_factor = 0.2,
  autovacuum_analyze_scale_factor = 0.1
);

ANALYZE auction_monitor.auction_results;

-- ============================================================
-- PYTHON AI SERVICE (Port 5440) - Read/Write Mix, AI Data
-- ============================================================

-- Inference log indexes
CREATE INDEX IF NOT EXISTS idx_inference_log_timestamp 
  ON python_ai.inference_log (timestamp DESC, user_id);

CREATE INDEX IF NOT EXISTS idx_inference_log_user_timestamp 
  ON python_ai.inference_log (user_id, timestamp DESC);

-- Analytics cache indexes (read-heavy)
CREATE INDEX IF NOT EXISTS idx_analytics_cache_key 
  ON python_ai.analytics_cache (cache_key);

CREATE INDEX IF NOT EXISTS idx_analytics_cache_updated 
  ON python_ai.analytics_cache (updated_at DESC);

-- Partial index for recent inferences
CREATE INDEX IF NOT EXISTS idx_inference_log_recent 
  ON python_ai.inference_log (timestamp DESC) 
  WHERE timestamp > NOW() - INTERVAL '30 days';

-- Autovacuum (balanced)
ALTER TABLE IF EXISTS python_ai.inference_log SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_scale_factor = 0.05
);

ALTER TABLE IF EXISTS python_ai.analytics_cache SET (
  autovacuum_vacuum_scale_factor = 0.2,
  autovacuum_analyze_scale_factor = 0.1
);

ANALYZE python_ai.inference_log;
ANALYZE python_ai.analytics_cache;
