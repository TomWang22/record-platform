-- Phase 9: OBO offer model (first-class backend data, not amenities strings).
-- Run on listings DB (port 5435):
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 5435 -U postgres -d listings -f infra/db/32-listings-obo-offers.sql

CREATE SCHEMA IF NOT EXISTS listings;

CREATE OR REPLACE FUNCTION listings.touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Per-listing OBO configuration (replaces amenities-only offer settings).
CREATE TABLE IF NOT EXISTS listings.offer_settings (
  listing_id              UUID PRIMARY KEY REFERENCES listings.listings(id) ON DELETE CASCADE,
  obo_enabled             BOOLEAN NOT NULL DEFAULT false,
  max_offer_attempts      INTEGER NOT NULL DEFAULT 3 CHECK (max_offer_attempts >= 1 AND max_offer_attempts <= 20),
  min_auto_accept_cents   INTEGER CHECK (min_auto_accept_cents IS NULL OR min_auto_accept_cents > 0),
  min_auto_reject_cents   INTEGER CHECK (min_auto_reject_cents IS NULL OR min_auto_reject_cents > 0),
  offer_expiration_hours  INTEGER NOT NULL DEFAULT 48 CHECK (offer_expiration_hours >= 1 AND offer_expiration_hours <= 720),
  allow_counteroffers     BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listings.offers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id        UUID NOT NULL REFERENCES listings.listings(id) ON DELETE CASCADE,
  buyer_user_id     UUID NOT NULL,
  seller_user_id    UUID NOT NULL,
  amount_cents      INTEGER NOT NULL CHECK (amount_cents > 0),
  currency          TEXT NOT NULL DEFAULT 'USD',
  status            TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'countered', 'accepted', 'rejected', 'expired', 'withdrawn')),
  message           TEXT,
  expires_at        TIMESTAMPTZ,
  parent_offer_id   UUID REFERENCES listings.offers(id) ON DELETE SET NULL,
  attempt_number    INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at        TIMESTAMPTZ,
  CONSTRAINT offers_buyer_seller_distinct CHECK (buyer_user_id <> seller_user_id)
);

CREATE TABLE IF NOT EXISTS listings.offer_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id          UUID NOT NULL REFERENCES listings.offers(id) ON DELETE CASCADE,
  listing_id        UUID NOT NULL REFERENCES listings.listings(id) ON DELETE CASCADE,
  actor_user_id     UUID NOT NULL,
  event_type        TEXT NOT NULL
    CHECK (event_type IN ('created', 'countered', 'accepted', 'rejected', 'expired', 'withdrawn')),
  previous_status   TEXT,
  new_status        TEXT NOT NULL,
  amount_cents      INTEGER,
  message           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_offers_listing_id ON listings.offers(listing_id);
CREATE INDEX IF NOT EXISTS idx_offers_buyer_user_id ON listings.offers(buyer_user_id);
CREATE INDEX IF NOT EXISTS idx_offers_seller_user_id ON listings.offers(seller_user_id);
CREATE INDEX IF NOT EXISTS idx_offers_status ON listings.offers(status);
CREATE INDEX IF NOT EXISTS idx_offers_listing_status ON listings.offers(listing_id, status);
CREATE INDEX IF NOT EXISTS idx_offers_expires_at ON listings.offers(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_offers_parent_offer_id ON listings.offers(parent_offer_id) WHERE parent_offer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_offer_events_offer_id ON listings.offer_events(offer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_offer_events_listing_id ON listings.offer_events(listing_id, created_at);

DROP TRIGGER IF EXISTS trg_offer_settings_touch ON listings.offer_settings;
CREATE TRIGGER trg_offer_settings_touch
  BEFORE UPDATE ON listings.offer_settings
  FOR EACH ROW EXECUTE PROCEDURE listings.touch_updated_at();

DROP TRIGGER IF EXISTS trg_offers_touch ON listings.offers;
CREATE TRIGGER trg_offers_touch
  BEFORE UPDATE ON listings.offers
  FOR EACH ROW EXECUTE PROCEDURE listings.touch_updated_at();

COMMENT ON TABLE listings.offer_settings IS 'OBO configuration per listing (Phase 9).';
COMMENT ON TABLE listings.offers IS 'Buyer offers on OBO listings; immutable history via offer_events.';
COMMENT ON TABLE listings.offer_events IS 'Append-only audit trail for offer state transitions.';
