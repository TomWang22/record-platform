-- Auction Monitor Extended Schema
-- Run as postgres (record_owner not created on this instance).
SET ROLE postgres;

-- Required for idx_normalized_listings_title_trgm (gin_trgm_ops)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Ensure auction_monitor schema exists
CREATE SCHEMA IF NOT EXISTS auction_monitor;

-- ============================================================================
-- STAGING LAYER: Raw data from platforms
-- ============================================================================

CREATE TABLE IF NOT EXISTS auction_monitor.raw_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform VARCHAR(50) NOT NULL,  -- 'ebay', 'discogs', 'buyee', 'yahoojp', 'carousellhk', 'recordcity'
  external_id VARCHAR(255) NOT NULL,  -- Platform-specific ID
  url TEXT NOT NULL,
  raw_data JSONB NOT NULL,  -- Original platform data
  ingestion_status VARCHAR(20) DEFAULT 'pending',  -- pending, processing, validated, failed
  validation_errors JSONB,  -- Array of validation errors
  ingested_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  CONSTRAINT uq_raw_listings_platform_external UNIQUE(platform, external_id)
);

CREATE INDEX IF NOT EXISTS idx_raw_listings_platform ON auction_monitor.raw_listings(platform);
CREATE INDEX IF NOT EXISTS idx_raw_listings_status ON auction_monitor.raw_listings(ingestion_status);
CREATE INDEX IF NOT EXISTS idx_raw_listings_ingested ON auction_monitor.raw_listings(ingested_at DESC);

-- ============================================================================
-- NORMALIZED LAYER: Unified schema, validated data
-- ============================================================================

CREATE TABLE IF NOT EXISTS auction_monitor.normalized_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_listing_id UUID REFERENCES auction_monitor.raw_listings(id) ON DELETE SET NULL,
  platform VARCHAR(50) NOT NULL,
  external_id VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  
  -- Core Fields (Required)
  title TEXT NOT NULL,
  description TEXT,
  current_price DECIMAL(10,2) NOT NULL,
  currency VARCHAR(3) NOT NULL,  -- ISO 4217
  condition VARCHAR(50),  -- Normalized: 'Mint', 'Near Mint', 'Very Good', etc.
  format VARCHAR(50),  -- 'LP', '7"', 'CD', 'Cassette', etc.
  
  -- Catalog Information
  artist VARCHAR(255),
  album VARCHAR(255),
  catalog_number VARCHAR(100),
  label VARCHAR(255),
  year INTEGER,
  
  -- Seller Information
  seller_id VARCHAR(255),
  seller_name VARCHAR(255),
  seller_feedback_score INTEGER,
  seller_location VARCHAR(255),
  
  -- Listing Details
  listing_type VARCHAR(50),  -- 'auction', 'buy_it_now', 'best_offer'
  starting_price DECIMAL(10,2),
  buy_it_now_price DECIMAL(10,2),
  bid_count INTEGER DEFAULT 0,
  watcher_count INTEGER DEFAULT 0,
  time_remaining INTERVAL,
  end_date TIMESTAMPTZ,
  
  -- Shipping & Costs
  shipping_cost DECIMAL(10,2),
  shipping_location VARCHAR(255),
  estimated_total DECIMAL(10,2),  -- price + shipping + fees
  
  -- Proxy Service (for Buyee, YahooJP)
  proxy_service VARCHAR(50),  -- 'buyee', 'zenmarket', etc.
  proxy_fee DECIMAL(10,2),
  consolidation_fee DECIMAL(10,2),
  international_shipping DECIMAL(10,2),
  
  -- Images
  images JSONB,  -- Array of image URLs
  thumbnail_url TEXT,
  
  -- Restrictions
  location_restrictions JSONB,  -- Array of allowed/blocked countries
  payment_restrictions JSONB,  -- Payment methods required
  review_restrictions JSONB,  -- Min feedback, account age, etc.
  
  -- Data Quality
  confidence_score DECIMAL(3,2) DEFAULT 0.5,  -- 0.0 to 1.0
  completeness_score DECIMAL(3,2) DEFAULT 0.5,
  data_quality_flags JSONB,  -- Array of quality issues
  
  -- Enrichment
  discogs_release_id INTEGER,  -- Matched Discogs release
  catalog_match_confidence DECIMAL(3,2),
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT uq_normalized_listings_platform_external UNIQUE(platform, external_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_normalized_listings_platform ON auction_monitor.normalized_listings(platform);
CREATE INDEX IF NOT EXISTS idx_normalized_listings_catalog ON auction_monitor.normalized_listings(catalog_number) WHERE catalog_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_normalized_listings_artist ON auction_monitor.normalized_listings(artist) WHERE artist IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_normalized_listings_price ON auction_monitor.normalized_listings(current_price);
CREATE INDEX IF NOT EXISTS idx_normalized_listings_confidence ON auction_monitor.normalized_listings(confidence_score);
CREATE INDEX IF NOT EXISTS idx_normalized_listings_updated ON auction_monitor.normalized_listings(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_normalized_listings_discogs ON auction_monitor.normalized_listings(discogs_release_id) WHERE discogs_release_id IS NOT NULL;

-- Full-text search index for titles
CREATE INDEX IF NOT EXISTS idx_normalized_listings_title_trgm ON auction_monitor.normalized_listings USING gin(title gin_trgm_ops);

-- ============================================================================
-- PRICE HISTORY: Time-series data
-- ============================================================================

CREATE TABLE IF NOT EXISTS auction_monitor.price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_listing_id UUID REFERENCES auction_monitor.normalized_listings(id) ON DELETE CASCADE,
  snapshot_at TIMESTAMPTZ DEFAULT NOW(),
  price DECIMAL(10,2) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  bid_count INTEGER,
  watcher_count INTEGER,
  time_remaining INTERVAL,
  status VARCHAR(50),  -- 'active', 'ended', 'sold', 'unsold'
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_price_history_listing ON auction_monitor.price_history(normalized_listing_id, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_snapshot ON auction_monitor.price_history(snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_status ON auction_monitor.price_history(status) WHERE status IS NOT NULL;

-- ============================================================================
-- USER WATCHES: User-defined search criteria
-- ============================================================================

CREATE TABLE IF NOT EXISTS auction_monitor.user_watches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
-- User ID references auth service (port 5437); no FK across instances
  user_id UUID NOT NULL,
  search_criteria JSONB NOT NULL,  -- Artist, title, format, condition, price range
  platforms JSONB NOT NULL,  -- Array of platforms to monitor: ['ebay', 'discogs', ...]
  notification_preferences JSONB,  -- Email, in-app, push
  status VARCHAR(20) DEFAULT 'active',  -- active, paused, expired
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_watches_user ON auction_monitor.user_watches(user_id);
CREATE INDEX IF NOT EXISTS idx_user_watches_status ON auction_monitor.user_watches(status);
CREATE INDEX IF NOT EXISTS idx_user_watches_expires ON auction_monitor.user_watches(expires_at) WHERE expires_at IS NOT NULL;

-- ============================================================================
-- WATCH MATCHES: Listings that match user watches
-- ============================================================================

CREATE TABLE IF NOT EXISTS auction_monitor.watch_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_id UUID REFERENCES auction_monitor.user_watches(id) ON DELETE CASCADE,
  normalized_listing_id UUID REFERENCES auction_monitor.normalized_listings(id) ON DELETE CASCADE,
  match_score DECIMAL(3,2),  -- How well it matches criteria (0.0 to 1.0)
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_watch_matches_watch_listing UNIQUE(watch_id, normalized_listing_id)
);

CREATE INDEX IF NOT EXISTS idx_watch_matches_watch ON auction_monitor.watch_matches(watch_id);
CREATE INDEX IF NOT EXISTS idx_watch_matches_listing ON auction_monitor.watch_matches(normalized_listing_id);
CREATE INDEX IF NOT EXISTS idx_watch_matches_notified ON auction_monitor.watch_matches(notified_at) WHERE notified_at IS NULL;

-- ============================================================================
-- PLATFORM HEALTH MONITORING
-- ============================================================================

CREATE TABLE IF NOT EXISTS auction_monitor.platform_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform VARCHAR(50) NOT NULL,
  check_type VARCHAR(50) NOT NULL,  -- 'api', 'scraping', 'rate_limit'
  status VARCHAR(20) NOT NULL,  -- 'healthy', 'degraded', 'down'
  response_time_ms INTEGER,
  error_message TEXT,
  checked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_health_platform ON auction_monitor.platform_health(platform, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_health_status ON auction_monitor.platform_health(status, checked_at DESC);

-- ============================================================================
-- DATA QUALITY METRICS
-- ============================================================================

CREATE TABLE IF NOT EXISTS auction_monitor.data_quality_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform VARCHAR(50) NOT NULL,
  metric_date DATE NOT NULL,
  total_listings INTEGER DEFAULT 0,
  validated_listings INTEGER DEFAULT 0,
  failed_validations INTEGER DEFAULT 0,
  avg_confidence_score DECIMAL(3,2),
  avg_completeness_score DECIMAL(3,2),
  duplicate_count INTEGER DEFAULT 0,
  enrichment_rate DECIMAL(5,2),  -- % with catalog number match
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_data_quality_platform_date UNIQUE(platform, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_data_quality_platform ON auction_monitor.data_quality_metrics(platform, metric_date DESC);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION auction_monitor.touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_normalized_listings_updated ON auction_monitor.normalized_listings;
CREATE TRIGGER trg_normalized_listings_updated
  BEFORE UPDATE ON auction_monitor.normalized_listings
  FOR EACH ROW
  EXECUTE FUNCTION auction_monitor.touch_updated_at();

-- Auto-update last_seen_at when listing is updated
CREATE OR REPLACE FUNCTION auction_monitor.touch_last_seen_at() RETURNS trigger AS $$
BEGIN
  NEW.last_seen_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_normalized_listings_seen ON auction_monitor.normalized_listings;
CREATE TRIGGER trg_normalized_listings_seen
  BEFORE UPDATE ON auction_monitor.normalized_listings
  FOR EACH ROW
  EXECUTE FUNCTION auction_monitor.touch_last_seen_at();

-- ============================================================================
-- GRANTS (only if record_app role exists on this instance)
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_app') THEN
    GRANT USAGE ON SCHEMA auction_monitor TO record_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auction_monitor TO record_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA auction_monitor TO record_app;
  END IF;
END $$;

RESET ROLE;

