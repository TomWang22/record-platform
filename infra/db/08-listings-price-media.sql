-- Listings: discount/bundle pricing and video media (images already in listing_images).
-- Run on port 5435 (listings DB). DB updated when discount or bundle is applied.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'listings' AND table_name = 'listings' AND column_name = 'discount_price') THEN
    ALTER TABLE listings.listings ADD COLUMN discount_price NUMERIC(12,2);
    ALTER TABLE listings.listings ADD COLUMN sale_ends_at TIMESTAMPTZ;
    ALTER TABLE listings.listings ADD COLUMN bundle_id UUID;
    COMMENT ON COLUMN listings.listings.discount_price IS 'Current sale/discount price; when set, UI shows this instead of price until sale_ends_at';
    COMMENT ON COLUMN listings.listings.bundle_id IS 'When set, this listing is part of a bundle (same bundle_id = sold together)';
  END IF;
END $$;

-- Listing videos (alongside listing_images)
CREATE TABLE IF NOT EXISTS listings.listing_videos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id      UUID NOT NULL REFERENCES listings.listings(id) ON DELETE CASCADE,
  video_url       TEXT NOT NULL,
  thumbnail_url   TEXT,
  display_order   INT NOT NULL DEFAULT 0,
  duration_secs   INT,
  mime_type       VARCHAR(128),
  file_size       BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_videos_listing_id ON listings.listing_videos(listing_id);

COMMENT ON TABLE listings.listing_videos IS 'Video media for listings; listing_images holds images.';
