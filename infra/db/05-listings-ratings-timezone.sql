-- Ratings and Time Preferences Extensions
-- Run on PostgreSQL port 5435 (listings database)

SET ROLE postgres;

-- ============================================================
-- RATINGS & REVIEWS
-- ============================================================

CREATE TABLE IF NOT EXISTS listings.ratings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id      UUID NOT NULL REFERENCES listings.listings(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL, -- Buyer who left the rating
  seller_id       UUID NOT NULL, -- Seller being rated
  rating          INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text     TEXT,
  transaction_id  UUID, -- Link to purchase/transaction
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(listing_id, user_id) -- One rating per user per listing
);

CREATE INDEX IF NOT EXISTS idx_ratings_listing_id ON listings.ratings(listing_id);
CREATE INDEX IF NOT EXISTS idx_ratings_seller_id ON listings.ratings(seller_id);
CREATE INDEX IF NOT EXISTS idx_ratings_user_id ON listings.ratings(user_id);
CREATE INDEX IF NOT EXISTS idx_ratings_created_at ON listings.ratings(created_at DESC);

-- Function to calculate average rating for a seller
CREATE OR REPLACE FUNCTION listings.calculate_seller_rating(seller_uuid UUID)
RETURNS NUMERIC AS $$
BEGIN
  RETURN (
    SELECT COALESCE(AVG(rating), 0)
    FROM listings.ratings
    WHERE seller_id = seller_uuid
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- Add average_rating to listings (denormalized for performance)
ALTER TABLE listings.listings ADD COLUMN IF NOT EXISTS seller_rating NUMERIC(3,2);
ALTER TABLE listings.listings ADD COLUMN IF NOT EXISTS seller_rating_count INT DEFAULT 0;

-- Trigger to update seller rating when new rating is added
CREATE OR REPLACE FUNCTION listings.update_seller_rating() RETURNS trigger AS $$
BEGIN
  UPDATE listings.listings
  SET seller_rating = listings.calculate_seller_rating(NEW.seller_id),
      seller_rating_count = (
        SELECT COUNT(*) FROM listings.ratings WHERE seller_id = NEW.seller_id
      )
  WHERE user_id = NEW.seller_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ratings_update_seller_rating ON listings.ratings;
CREATE TRIGGER trg_ratings_update_seller_rating
  AFTER INSERT OR UPDATE ON listings.ratings
  FOR EACH ROW
  EXECUTE FUNCTION listings.update_seller_rating();

-- ============================================================
-- TIME PREFERENCES (User Settings Extension)
-- ============================================================

-- Create user_settings table if it doesn't exist (from base schema)
CREATE TABLE IF NOT EXISTS listings.user_settings (
  user_id      UUID PRIMARY KEY,
  country_code TEXT DEFAULT 'US',
  currency     TEXT DEFAULT 'USD',
  fee_rate     NUMERIC(5,2) DEFAULT 0.0,
  duty_rate    NUMERIC(5,2) DEFAULT 0.0
);

-- Add timezone and auction preferences to user_settings
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'listings' AND table_name = 'user_settings' AND column_name = 'timezone') THEN
    ALTER TABLE listings.user_settings ADD COLUMN timezone VARCHAR(64) DEFAULT 'UTC';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'listings' AND table_name = 'user_settings' AND column_name = 'auction_deadline_reminder') THEN
    ALTER TABLE listings.user_settings ADD COLUMN auction_deadline_reminder BOOLEAN DEFAULT TRUE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'listings' AND table_name = 'user_settings' AND column_name = 'auction_deadline_hours_before') THEN
    ALTER TABLE listings.user_settings ADD COLUMN auction_deadline_hours_before INT DEFAULT 24;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'listings' AND table_name = 'user_settings' AND column_name = 'preferred_auction_end_time') THEN
    ALTER TABLE listings.user_settings ADD COLUMN preferred_auction_end_time TIME DEFAULT '20:00:00';
  END IF;
END $$;

COMMENT ON COLUMN listings.user_settings.timezone IS 'User timezone (e.g., America/New_York, UTC)';
COMMENT ON COLUMN listings.user_settings.auction_deadline_reminder IS 'Whether to send reminders for auction deadlines';
COMMENT ON COLUMN listings.user_settings.auction_deadline_hours_before IS 'Hours before auction end to send reminder';
COMMENT ON COLUMN listings.user_settings.preferred_auction_end_time IS 'Preferred time of day for auctions to end';

-- ============================================================
-- AUCTION DEADLINE VIEWS (for easy querying)
-- ============================================================

-- View for active auctions with time remaining
CREATE OR REPLACE VIEW listings.active_auctions AS
SELECT 
  l.id,
  l.title,
  l.user_id as seller_id,
  ad.current_bid,
  ad.starting_bid,
  ad.end_time,
  ad.bid_count,
  EXTRACT(EPOCH FROM (ad.end_time - NOW())) / 3600 as hours_remaining,
  CASE 
    WHEN ad.end_time < NOW() THEN 'ended'
    WHEN EXTRACT(EPOCH FROM (ad.end_time - NOW())) / 3600 < 1 THEN 'ending_soon'
    WHEN EXTRACT(EPOCH FROM (ad.end_time - NOW())) / 3600 < 24 THEN 'ending_today'
    ELSE 'active'
  END as status
FROM listings.listings l
JOIN listings.auction_details ad ON l.id = ad.listing_id
WHERE l.is_active = TRUE
  AND l.listing_type = 'auction'
  AND l.sold_at IS NULL
  AND ad.end_time > NOW();

-- Index for efficient auction deadline queries (using immutable function)
-- Note: Partial index with NOW() requires immutable function, so we'll use a regular index
-- Applications should filter for end_time > NOW() in queries
CREATE INDEX IF NOT EXISTS idx_auction_details_end_time 
  ON listings.auction_details(end_time);

-- ============================================================
-- GRANTS
-- ============================================================

GRANT ALL PRIVILEGES ON SCHEMA listings TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA listings TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA listings TO postgres;
GRANT SELECT ON listings.active_auctions TO postgres;

ALTER DEFAULT PRIVILEGES IN SCHEMA listings GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA listings GRANT ALL ON SEQUENCES TO postgres;

