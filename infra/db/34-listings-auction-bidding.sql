-- Phase 10: first-class marketplace auction bidding (not amenities strings).
-- Run on listings DB (port 5435):
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 5435 -U postgres -d listings -f infra/db/34-listings-auction-bidding.sql

CREATE SCHEMA IF NOT EXISTS listings;

CREATE OR REPLACE FUNCTION listings.touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Retire legacy auction tables from 05-listings-schema.sql when present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'listings' AND table_name = 'bids'
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'listings' AND table_name = 'bids' AND column_name = 'bid_source'
      )
  ) THEN
    ALTER TABLE listings.bids RENAME TO legacy_bids_v0;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'listings' AND table_name = 'auction_details'
  ) THEN
    ALTER TABLE listings.auction_details RENAME TO legacy_auction_details_v0;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS listings.auction_settings (
  listing_id              UUID PRIMARY KEY REFERENCES listings.listings(id) ON DELETE CASCADE,
  starting_bid_cents      INTEGER NOT NULL CHECK (starting_bid_cents > 0),
  bid_increment_cents     INTEGER NOT NULL DEFAULT 100 CHECK (bid_increment_cents > 0),
  reserve_cents           INTEGER CHECK (reserve_cents IS NULL OR reserve_cents > 0),
  starts_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at                 TIMESTAMPTZ NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('scheduled', 'active', 'ended', 'cancelled')),
  current_bid_cents       INTEGER NOT NULL DEFAULT 0 CHECK (current_bid_cents >= 0),
  bid_count               INTEGER NOT NULL DEFAULT 0 CHECK (bid_count >= 0),
  high_bidder_user_id     UUID,
  reserve_met             BOOLEAN NOT NULL DEFAULT false,
  winner_user_id          UUID,
  finalized_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listings.bids (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id        UUID NOT NULL REFERENCES listings.listings(id) ON DELETE CASCADE,
  bidder_user_id    UUID NOT NULL,
  amount_cents      INTEGER NOT NULL CHECK (amount_cents > 0),
  bid_source        TEXT NOT NULL DEFAULT 'manual'
    CHECK (bid_source IN ('manual', 'proxy_auto')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listings.proxy_bids (
  listing_id        UUID NOT NULL REFERENCES listings.listings(id) ON DELETE CASCADE,
  bidder_user_id    UUID NOT NULL,
  max_bid_cents     INTEGER NOT NULL CHECK (max_bid_cents > 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (listing_id, bidder_user_id),
  CONSTRAINT proxy_bids_distinct_bidder CHECK (bidder_user_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS listings.bid_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id        UUID NOT NULL REFERENCES listings.listings(id) ON DELETE CASCADE,
  bid_id            UUID REFERENCES listings.bids(id) ON DELETE SET NULL,
  actor_user_id     UUID NOT NULL,
  event_type        TEXT NOT NULL
    CHECK (event_type IN (
      'bid_placed', 'outbid', 'auction_ended', 'auction_won', 'auction_lost', 'auction_sold'
    )),
  amount_cents      INTEGER,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auction_settings_status ON listings.auction_settings(status);
CREATE INDEX IF NOT EXISTS idx_auction_settings_ends_at ON listings.auction_settings(ends_at);
CREATE INDEX IF NOT EXISTS idx_bids_listing_id ON listings.bids(listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bids_bidder ON listings.bids(bidder_user_id);
CREATE INDEX IF NOT EXISTS idx_proxy_bids_listing ON listings.proxy_bids(listing_id);
CREATE INDEX IF NOT EXISTS idx_bid_events_listing ON listings.bid_events(listing_id, created_at);

DROP TRIGGER IF EXISTS trg_auction_settings_touch ON listings.auction_settings;
CREATE TRIGGER trg_auction_settings_touch
  BEFORE UPDATE ON listings.auction_settings
  FOR EACH ROW EXECUTE PROCEDURE listings.touch_updated_at();

DROP TRIGGER IF EXISTS trg_proxy_bids_touch ON listings.proxy_bids;
CREATE TRIGGER trg_proxy_bids_touch
  BEFORE UPDATE ON listings.proxy_bids
  FOR EACH ROW EXECUTE PROCEDURE listings.touch_updated_at();

COMMENT ON TABLE listings.auction_settings IS 'Phase 10 auction state per listing (source of truth, not amenities).';
COMMENT ON TABLE listings.bids IS 'Visible bid increments (manual or proxy_auto); never stores proxy max.';
COMMENT ON TABLE listings.proxy_bids IS 'Secret max bids for eBay-style proxy bidding.';
COMMENT ON TABLE listings.bid_events IS 'Append-only audit trail for auction transitions.';
