-- Phase 9 delta: minimum offer floor for OBO listings.
-- Run on listings DB (port 5435):
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 5435 -U postgres -d listings -f infra/db/33-listings-obo-offers-delta.sql

ALTER TABLE listings.offer_settings
  ADD COLUMN IF NOT EXISTS min_offer_cents INTEGER
    CHECK (min_offer_cents IS NULL OR min_offer_cents > 0);

COMMENT ON COLUMN listings.offer_settings.min_offer_cents IS
  'Minimum buyer offer amount in cents; offers below are rejected.';
