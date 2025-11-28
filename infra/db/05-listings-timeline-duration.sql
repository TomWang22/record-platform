-- Listings Timeline and Duration Extensions
-- Run on PostgreSQL port 5435 (listings database)

SET ROLE postgres;

-- Add duration and visibility timeline fields
DO $$ 
BEGIN
  -- Duration (how long listing will be active/visible)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'listings' AND table_name = 'listings' AND column_name = 'duration_days') THEN
    ALTER TABLE listings.listings ADD COLUMN duration_days INT DEFAULT 30;
    COMMENT ON COLUMN listings.listings.duration_days IS 'Number of days listing will be visible/active';
  END IF;

  -- Visibility start time (when listing becomes visible)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'listings' AND table_name = 'listings' AND column_name = 'visible_from') THEN
    ALTER TABLE listings.listings ADD COLUMN visible_from TIMESTAMPTZ DEFAULT now();
    COMMENT ON COLUMN listings.listings.visible_from IS 'When listing becomes visible to users';
  END IF;

  -- Visibility end time (calculated: visible_from + duration_days)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'listings' AND table_name = 'listings' AND column_name = 'visible_until') THEN
    ALTER TABLE listings.listings ADD COLUMN visible_until TIMESTAMPTZ;
    COMMENT ON COLUMN listings.listings.visible_until IS 'When listing stops being visible (visible_from + duration_days)';
  END IF;
END $$;

-- Function to calculate visible_until from visible_from + duration_days
CREATE OR REPLACE FUNCTION listings.calculate_visible_until()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.visible_from IS NOT NULL AND NEW.duration_days IS NOT NULL THEN
    NEW.visible_until = NEW.visible_from + (NEW.duration_days || ' days')::INTERVAL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-calculate visible_until
DROP TRIGGER IF EXISTS trg_listings_calculate_visible_until ON listings.listings;
CREATE TRIGGER trg_listings_calculate_visible_until
  BEFORE INSERT OR UPDATE ON listings.listings
  FOR EACH ROW
  WHEN (NEW.visible_from IS NOT NULL AND NEW.duration_days IS NOT NULL)
  EXECUTE FUNCTION listings.calculate_visible_until();

-- Update existing listings to have visible_until
UPDATE listings.listings
SET visible_until = created_at + (COALESCE(duration_days, 30) || ' days')::INTERVAL
WHERE visible_until IS NULL AND created_at IS NOT NULL;

-- Index for efficient visibility queries
CREATE INDEX IF NOT EXISTS idx_listings_visible_from ON listings.listings(visible_from);
CREATE INDEX IF NOT EXISTS idx_listings_visible_until ON listings.listings(visible_until);
CREATE INDEX IF NOT EXISTS idx_listings_visible_range ON listings.listings(visible_from, visible_until) 
  WHERE is_active = TRUE AND sold_at IS NULL;

-- View for currently visible listings
CREATE OR REPLACE VIEW listings.visible_listings AS
SELECT l.*
FROM listings.listings l
WHERE l.is_active = TRUE
  AND l.stock_quantity > 0
  AND l.sold_at IS NULL
  AND (l.visible_from IS NULL OR l.visible_from <= NOW())
  AND (l.visible_until IS NULL OR l.visible_until >= NOW());

GRANT SELECT ON listings.visible_listings TO postgres;

