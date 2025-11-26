-- Extended Listings Schema
-- Adds media type, OBI, label type, and popularity fields
-- Run on PostgreSQL port 5435 (listings database)

SET ROLE postgres;

-- Ensure listings schema exists
CREATE SCHEMA IF NOT EXISTS listings;

-- ============================================================
-- EXTEND LISTINGS TABLE
-- ============================================================

-- Add new columns to listings table (if they don't exist)
DO $$ 
BEGIN
  -- Media type (LP, 12", 10", 7", CD, EP, etc.)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'listings' AND table_name = 'listings' AND column_name = 'media_type') THEN
    ALTER TABLE listings.listings ADD COLUMN media_type VARCHAR(32);
    COMMENT ON COLUMN listings.listings.media_type IS 'Media format: LP, 12", 10", 7", CD, EP, CASSETTE, etc.';
  END IF;

  -- OBI strip filter
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'listings' AND table_name = 'listings' AND column_name = 'has_obi') THEN
    ALTER TABLE listings.listings ADD COLUMN has_obi BOOLEAN DEFAULT FALSE;
    COMMENT ON COLUMN listings.listings.has_obi IS 'Whether the item has an OBI strip';
  END IF;

  -- Label type (for sorting)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'listings' AND table_name = 'listings' AND column_name = 'label_type') THEN
    ALTER TABLE listings.listings ADD COLUMN label_type VARCHAR(128);
    COMMENT ON COLUMN listings.listings.label_type IS 'Record label (e.g., "Columbia", "Atlantic", "Motown")';
  END IF;

  -- Popularity score (calculated from views, watches, bids)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'listings' AND table_name = 'listings' AND column_name = 'popularity_score') THEN
    ALTER TABLE listings.listings ADD COLUMN popularity_score INT DEFAULT 0;
    COMMENT ON COLUMN listings.listings.popularity_score IS 'Calculated popularity: view_count + (watch_count * 2) + (bid_count * 3)';
  END IF;

  -- Stock/availability tracking
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'listings' AND table_name = 'listings' AND column_name = 'stock_quantity') THEN
    ALTER TABLE listings.listings ADD COLUMN stock_quantity INT DEFAULT 1;
    COMMENT ON COLUMN listings.listings.stock_quantity IS 'Available quantity (0 = sold out)';
  END IF;
END $$;

-- Create indexes for new fields
CREATE INDEX IF NOT EXISTS idx_listings_media_type ON listings.listings(media_type);
CREATE INDEX IF NOT EXISTS idx_listings_has_obi ON listings.listings(has_obi) WHERE has_obi = TRUE;
CREATE INDEX IF NOT EXISTS idx_listings_label_type ON listings.listings(label_type);
CREATE INDEX IF NOT EXISTS idx_listings_popularity_score ON listings.listings(popularity_score DESC);
CREATE INDEX IF NOT EXISTS idx_listings_stock_quantity ON listings.listings(stock_quantity) WHERE stock_quantity > 0;

-- Function to calculate and update popularity score
CREATE OR REPLACE FUNCTION listings.update_popularity_score()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE listings.listings
  SET popularity_score = view_count + (watch_count * 2) + (
    SELECT COALESCE(bid_count, 0) * 3
    FROM listings.auction_details
    WHERE listing_id = listings.listings.id
  )
  WHERE id = COALESCE(NEW.listing_id, OLD.listing_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Trigger to update popularity when views change
DROP TRIGGER IF EXISTS trg_listings_update_popularity_views ON listings.listing_views;
CREATE TRIGGER trg_listings_update_popularity_views
  AFTER INSERT ON listings.listing_views
  FOR EACH ROW
  EXECUTE FUNCTION listings.update_popularity_score();

-- Trigger to update popularity when watchlist changes
DROP TRIGGER IF EXISTS trg_listings_update_popularity_watchlist ON listings.watchlist;
CREATE TRIGGER trg_listings_update_popularity_watchlist
  AFTER INSERT OR DELETE ON listings.watchlist
  FOR EACH ROW
  EXECUTE FUNCTION listings.update_popularity_score();

-- Trigger to update popularity when bids change
DROP TRIGGER IF EXISTS trg_listings_update_popularity_bids ON listings.bids;
CREATE TRIGGER trg_listings_update_popularity_bids
  AFTER INSERT ON listings.bids
  FOR EACH ROW
  EXECUTE FUNCTION listings.update_popularity_score();

-- Function to mark listing as sold out and clean up carts
CREATE OR REPLACE FUNCTION listings.mark_sold_out(listing_uuid UUID, buyer_uuid UUID)
RETURNS void AS $$
BEGIN
  -- Mark listing as sold
  UPDATE listings.listings
  SET sold_at = NOW(),
      sold_to = buyer_uuid,
      is_active = FALSE,
      stock_quantity = 0
  WHERE id = listing_uuid;

  -- Remove from all other users' carts (except buyer)
  -- Note: This requires access to shopping schema, so we'll handle it in application code
  -- But we can set a flag here
  
  -- Update popularity one last time
  UPDATE listings.listings
  SET popularity_score = view_count + (watch_count * 2) + (
    SELECT COALESCE(bid_count, 0) * 3
    FROM listings.auction_details
    WHERE listing_id = listings.listings.id
  )
  WHERE id = listing_uuid;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT ALL PRIVILEGES ON SCHEMA listings TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA listings TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA listings TO postgres;

ALTER DEFAULT PRIVILEGES IN SCHEMA listings GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA listings GRANT ALL ON SEQUENCES TO postgres;

