-- Listings Service Database Schema
-- Run on PostgreSQL port 5435
-- Database: records (or listings, depending on setup)
-- User: postgres / postgres

SET ROLE postgres;

-- Create schema
CREATE SCHEMA IF NOT EXISTS listings;

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ============================================================
-- LISTINGS SCHEMA
-- ============================================================

-- Listings table (user-created listings)
CREATE TABLE IF NOT EXISTS listings.listings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL, -- References auth.users(id) but cross-database, so no FK
  title           VARCHAR(512) NOT NULL,
  description     TEXT,
  price           NUMERIC(12,2) NOT NULL,
  currency        VARCHAR(3) NOT NULL DEFAULT 'USD',
  listing_type    VARCHAR(32) NOT NULL DEFAULT 'fixed_price' CHECK (listing_type IN ('fixed_price', 'auction', 'obo', 'best_offer')),
  condition       VARCHAR(64), -- e.g., "New", "Like New", "Very Good", "Good", "Fair"
  category        VARCHAR(128),
  location        VARCHAR(256), -- Seller location
  shipping_cost   NUMERIC(10,2) DEFAULT 0.0,
  shipping_method VARCHAR(128),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  is_featured     BOOLEAN NOT NULL DEFAULT FALSE,
  view_count      INT NOT NULL DEFAULT 0,
  watch_count     INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ, -- For auctions and time-limited listings
  sold_at         TIMESTAMPTZ, -- When listing was sold
  sold_to         UUID -- Buyer user_id
);

-- Auction-specific fields (for auction-type listings)
CREATE TABLE IF NOT EXISTS listings.auction_details (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id      UUID NOT NULL REFERENCES listings.listings(id) ON DELETE CASCADE,
  starting_bid    NUMERIC(12,2) NOT NULL,
  current_bid     NUMERIC(12,2),
  current_bidder  UUID, -- user_id of current highest bidder
  reserve_price   NUMERIC(12,2), -- Minimum price seller will accept
  bid_increment   NUMERIC(10,2) DEFAULT 1.00,
  start_time      TIMESTAMPTZ NOT NULL DEFAULT now(),
  end_time        TIMESTAMPTZ NOT NULL,
  bid_count       INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bids table (for auction listings)
CREATE TABLE IF NOT EXISTS listings.bids (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id      UUID NOT NULL REFERENCES listings.listings(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,
  bid_amount      NUMERIC(12,2) NOT NULL,
  is_winning      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(listing_id, user_id, bid_amount) -- Prevent duplicate bids at same amount
);

-- Listing images table
CREATE TABLE IF NOT EXISTS listings.listing_images (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id      UUID NOT NULL REFERENCES listings.listings(id) ON DELETE CASCADE,
  image_url       TEXT NOT NULL, -- URL to stored image (S3, R2, etc.)
  image_path      TEXT, -- Path in storage
  thumbnail_url   TEXT, -- Thumbnail URL
  display_order   INT NOT NULL DEFAULT 0, -- Order for displaying images
  is_primary      BOOLEAN NOT NULL DEFAULT FALSE, -- Primary/main image
  file_size       BIGINT, -- File size in bytes
  mime_type       VARCHAR(128), -- image/jpeg, image/png, etc.
  width           INT,
  height          INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Offers table (for OBO/Best Offer listings)
CREATE TABLE IF NOT EXISTS listings.offers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id      UUID NOT NULL REFERENCES listings.listings(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL, -- Buyer
  offer_amount    NUMERIC(12,2) NOT NULL,
  message         TEXT, -- Optional message with offer
  status          VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'countered', 'expired')),
  expires_at      TIMESTAMPTZ, -- Offer expiration
  responded_at    TIMESTAMPTZ, -- When seller responded
  counter_offer   NUMERIC(12,2), -- If seller counters
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Watchlist (users watching listings)
CREATE TABLE IF NOT EXISTS listings.watchlist (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  listing_id      UUID NOT NULL REFERENCES listings.listings(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, listing_id)
);

-- Listing views (track views for analytics)
CREATE TABLE IF NOT EXISTS listings.listing_views (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id      UUID NOT NULL REFERENCES listings.listings(id) ON DELETE CASCADE,
  user_id         UUID, -- NULL for anonymous views
  ip_address      INET,
  user_agent      TEXT,
  viewed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Listings indexes
CREATE INDEX IF NOT EXISTS idx_listings_user_id ON listings.listings(user_id);
CREATE INDEX IF NOT EXISTS idx_listings_listing_type ON listings.listings(listing_type);
CREATE INDEX IF NOT EXISTS idx_listings_is_active ON listings.listings(is_active);
CREATE INDEX IF NOT EXISTS idx_listings_created_at ON listings.listings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_price ON listings.listings(price);
CREATE INDEX IF NOT EXISTS idx_listings_category ON listings.listings(category);
CREATE INDEX IF NOT EXISTS idx_listings_location ON listings.listings(location);
CREATE INDEX IF NOT EXISTS idx_listings_title_trgm ON listings.listings USING gin(title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_listings_description_trgm ON listings.listings USING gin(description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_listings_active_created ON listings.listings(is_active, created_at DESC) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_listings_expires_at ON listings.listings(expires_at) WHERE expires_at IS NOT NULL;

-- Auction details indexes
CREATE INDEX IF NOT EXISTS idx_auction_details_listing_id ON listings.auction_details(listing_id);
-- Note: Partial index on end_time requires immutable function, so we'll create a regular index
-- Applications should filter for end_time > now() in queries
CREATE INDEX IF NOT EXISTS idx_auction_details_end_time ON listings.auction_details(end_time);
CREATE INDEX IF NOT EXISTS idx_auction_details_current_bidder ON listings.auction_details(current_bidder);

-- Bids indexes
CREATE INDEX IF NOT EXISTS idx_bids_listing_id ON listings.bids(listing_id);
CREATE INDEX IF NOT EXISTS idx_bids_user_id ON listings.bids(user_id);
CREATE INDEX IF NOT EXISTS idx_bids_created_at ON listings.bids(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bids_listing_winning ON listings.bids(listing_id, is_winning) WHERE is_winning = TRUE;

-- Listing images indexes
CREATE INDEX IF NOT EXISTS idx_listing_images_listing_id ON listings.listing_images(listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_images_display_order ON listings.listing_images(listing_id, display_order);
CREATE INDEX IF NOT EXISTS idx_listing_images_primary ON listings.listing_images(listing_id, is_primary) WHERE is_primary = TRUE;

-- Offers indexes
CREATE INDEX IF NOT EXISTS idx_offers_listing_id ON listings.offers(listing_id);
CREATE INDEX IF NOT EXISTS idx_offers_user_id ON listings.offers(user_id);
CREATE INDEX IF NOT EXISTS idx_offers_status ON listings.offers(status);
CREATE INDEX IF NOT EXISTS idx_offers_expires_at ON listings.offers(expires_at) WHERE expires_at IS NOT NULL;

-- Watchlist indexes
CREATE INDEX IF NOT EXISTS idx_watchlist_user_id ON listings.watchlist(user_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_listing_id ON listings.watchlist(listing_id);

-- Listing views indexes
CREATE INDEX IF NOT EXISTS idx_listing_views_listing_id ON listings.listing_views(listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_views_user_id ON listings.listing_views(user_id);
CREATE INDEX IF NOT EXISTS idx_listing_views_viewed_at ON listings.listing_views(viewed_at DESC);

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Update updated_at trigger function
CREATE OR REPLACE FUNCTION listings.touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS trg_listings_touch ON listings.listings;
CREATE TRIGGER trg_listings_touch
  BEFORE UPDATE ON listings.listings
  FOR EACH ROW
  EXECUTE FUNCTION listings.touch_updated_at();

DROP TRIGGER IF EXISTS trg_auction_details_touch ON listings.auction_details;
CREATE TRIGGER trg_auction_details_touch
  BEFORE UPDATE ON listings.auction_details
  FOR EACH ROW
  EXECUTE FUNCTION listings.touch_updated_at();

DROP TRIGGER IF EXISTS trg_offers_touch ON listings.offers;
CREATE TRIGGER trg_offers_touch
  BEFORE UPDATE ON listings.offers
  FOR EACH ROW
  EXECUTE FUNCTION listings.touch_updated_at();

-- Function to update view_count on listings
CREATE OR REPLACE FUNCTION listings.increment_view_count() RETURNS trigger AS $$
BEGIN
  UPDATE listings.listings SET view_count = view_count + 1 WHERE id = NEW.listing_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_listing_views_count ON listings.listing_views;
CREATE TRIGGER trg_listing_views_count
  AFTER INSERT ON listings.listing_views
  FOR EACH ROW
  EXECUTE FUNCTION listings.increment_view_count();

-- Function to update watch_count on listings
CREATE OR REPLACE FUNCTION listings.update_watch_count() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE listings.listings SET watch_count = watch_count + 1 WHERE id = NEW.listing_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE listings.listings SET watch_count = GREATEST(0, watch_count - 1) WHERE id = OLD.listing_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_watchlist_count ON listings.watchlist;
CREATE TRIGGER trg_watchlist_count
  AFTER INSERT OR DELETE ON listings.watchlist
  FOR EACH ROW
  EXECUTE FUNCTION listings.update_watch_count();

-- Function to handle auction bid updates
CREATE OR REPLACE FUNCTION listings.update_auction_bid() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Mark previous winning bid as not winning
    UPDATE listings.bids SET is_winning = FALSE WHERE listing_id = NEW.listing_id AND is_winning = TRUE;
    -- Mark new bid as winning
    NEW.is_winning = TRUE;
    -- Update auction details
    UPDATE listings.auction_details
    SET current_bid = NEW.bid_amount,
        current_bidder = NEW.user_id,
        bid_count = bid_count + 1,
        updated_at = now()
    WHERE listing_id = NEW.listing_id;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bids_auction_update ON listings.bids;
CREATE TRIGGER trg_bids_auction_update
  AFTER INSERT ON listings.bids
  FOR EACH ROW
  EXECUTE FUNCTION listings.update_auction_bid();

-- Function to ensure only one primary image per listing
CREATE OR REPLACE FUNCTION listings.ensure_primary_image() RETURNS trigger AS $$
BEGIN
  IF NEW.is_primary = TRUE THEN
    -- Unset other primary images for this listing
    UPDATE listings.listing_images
    SET is_primary = FALSE
    WHERE listing_id = NEW.listing_id AND id != NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_listing_images_primary ON listings.listing_images;
CREATE TRIGGER trg_listing_images_primary
  BEFORE INSERT OR UPDATE ON listings.listing_images
  FOR EACH ROW
  EXECUTE FUNCTION listings.ensure_primary_image();

-- Grant permissions (adjust user as needed)
-- GRANT USAGE ON SCHEMA listings TO record_app;
-- GRANT ALL ON ALL TABLES IN SCHEMA listings TO record_app;
-- GRANT ALL ON ALL SEQUENCES IN SCHEMA listings TO record_app;

