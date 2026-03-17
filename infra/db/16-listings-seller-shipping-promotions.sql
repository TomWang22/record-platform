-- Listings: shipping type (single/multiple/flexible), shipping options, seller country, promotions.
-- Run on port 5435 (listings DB). Price conversion by buyer location is application-level.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'listings' AND table_name = 'listings' AND column_name = 'shipping_type') THEN
    ALTER TABLE listings.listings ADD COLUMN shipping_type VARCHAR(32) NOT NULL DEFAULT 'single'
      CHECK (shipping_type IN ('single', 'multiple', 'flexible'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS listings.listing_shipping_options (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id   UUID NOT NULL REFERENCES listings.listings(id) ON DELETE CASCADE,
  label        VARCHAR(128) NOT NULL,
  cost         NUMERIC(10,2) NOT NULL DEFAULT 0,
  method       VARCHAR(128),
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_listing_shipping_options_listing ON listings.listing_shipping_options(listing_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'listings' AND table_name = 'listings' AND column_name = 'seller_country') THEN
    ALTER TABLE listings.listings ADD COLUMN seller_country CHAR(2);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'listings' AND table_name = 'listings' AND column_name = 'promotion_type') THEN
    ALTER TABLE listings.listings ADD COLUMN promotion_type VARCHAR(32);
    ALTER TABLE listings.listings ADD COLUMN promotion_ends_at TIMESTAMPTZ;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_listings_promotion_ends ON listings.listings(promotion_ends_at) WHERE promotion_ends_at IS NOT NULL;
