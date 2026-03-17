-- Listings lifecycle: seller-ended, did_not_sell, sold (eBay-style)
-- Run on port 5435 (listings instance). Adds ended_at and OBO window.
--
-- Database name: use the DB that has the listings schema (K8s: "listings", docker-compose sometimes "records").
-- To avoid GSSAPI errors on Mac, set PGOPTIONS before running:
--
--   export PGOPTIONS='-c gssencmode=disable'
--   PGPASSWORD=postgres psql -h localhost -p 5435 -U postgres -d listings -f infra/db/23-listings-lifecycle-status.sql
--
-- If "listings" does not exist, create it first: -d postgres -f infra/db/00-create-listings-database.sql
-- Then run 05-listings-schema.sql (and extended) against -d listings, then run this file against -d listings.

SET ROLE postgres;

-- ended_at: when seller chose to take listing down (ended)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'listings' AND table_name = 'listings' AND column_name = 'ended_at') THEN
    ALTER TABLE listings.listings ADD COLUMN ended_at TIMESTAMPTZ;
    COMMENT ON COLUMN listings.listings.ended_at IS 'When seller ended the listing (took it down); NULL = not ended by seller';
  END IF;
END $$;

-- OBO window: optional end time for accepting best offers
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'listings' AND table_name = 'listings' AND column_name = 'obo_until') THEN
    ALTER TABLE listings.listings ADD COLUMN obo_until TIMESTAMPTZ;
    COMMENT ON COLUMN listings.listings.obo_until IS 'Optional OBO/best-offer window end (listing_type obo/best_offer)';
  END IF;
END $$;

-- Ensure stock_quantity exists (may already be in 05-listings-schema-extended)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'listings' AND table_name = 'listings' AND column_name = 'stock_quantity') THEN
    ALTER TABLE listings.listings ADD COLUMN stock_quantity INT DEFAULT 1;
    COMMENT ON COLUMN listings.listings.stock_quantity IS 'Available quantity (0 = sold out); shown in API and frontend';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_listings_ended_at ON listings.listings(ended_at) WHERE ended_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listings_obo_until ON listings.listings(obo_until) WHERE obo_until IS NOT NULL;

-- visible_until: add if missing (may be added by 05-listings-timeline-duration.sql; ensure idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'listings' AND table_name = 'listings' AND column_name = 'visible_until') THEN
    ALTER TABLE listings.listings ADD COLUMN visible_until TIMESTAMPTZ;
  END IF;
END $$;
COMMENT ON COLUMN listings.listings.visible_until IS 'When listing stops being visible (duration_days from visible_from); past = did_not_sell if not sold';

-- Offers table already has: offer_amount, message (justification), expires_at, status
-- No schema change needed for OBO offers; listing.obo_until defines the window.

COMMENT ON COLUMN listings.listings.sold_at IS 'When listing was sold (stock_quantity went to 0 or last unit sold)';
