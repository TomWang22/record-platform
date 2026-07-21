-- Phase 34 Phase A: canonical listing lifecycle + immutable SALE_COMPLETED events.
-- Run against the listings database (e.g. port 5435, db listings).
--
--   export PGOPTIONS='-c gssencmode=disable'
--   PGPASSWORD=postgres psql -h localhost -p 5435 -U postgres -d listings \
--     -f infra/db/49-listings-sale-completed-lifecycle.sql

SET ROLE postgres;

-- Canonical lifecycle column (text + check). DB enum stays for backward compat;
-- application maps status/sold_at → lifecycle via phase34-listing-lifecycle.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'listings' AND table_name = 'listings' AND column_name = 'lifecycle_status'
  ) THEN
    ALTER TABLE listings.listings
      ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE';
    COMMENT ON COLUMN listings.listings.lifecycle_status IS
      'Canonical Phase 34 lifecycle: ACTIVE|ENDED_UNSOLD|SOLD|CANCELLED|EXPIRED|ARCHIVED';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'listings_lifecycle_status_check'
  ) THEN
    ALTER TABLE listings.listings
      ADD CONSTRAINT listings_lifecycle_status_check
      CHECK (lifecycle_status IN (
        'ACTIVE', 'ENDED_UNSOLD', 'SOLD', 'CANCELLED', 'EXPIRED', 'ARCHIVED'
      ));
  END IF;
END $$;

-- Backfill from legacy status / sold_at (never treat archived as sold).
UPDATE listings.listings
SET lifecycle_status = CASE
  WHEN sold_at IS NOT NULL THEN 'SOLD'
  WHEN status::text IN ('paused', 'archived') THEN 'ARCHIVED'
  WHEN status::text = 'closed' AND sold_at IS NULL THEN 'ENDED_UNSOLD'
  WHEN status::text = 'flagged' THEN 'ACTIVE'
  ELSE 'ACTIVE'
END
WHERE lifecycle_status = 'ACTIVE'
  OR lifecycle_status IS NULL;

CREATE INDEX IF NOT EXISTS idx_listings_lifecycle_status
  ON listings.listings (lifecycle_status);

-- Immutable SALE_COMPLETED event store (settlement-grade only).
CREATE TABLE IF NOT EXISTS listings.sale_completed_events (
  sale_event_id          TEXT PRIMARY KEY,
  market_event_id        TEXT NOT NULL,
  listing_id             UUID NOT NULL,
  order_id               UUID,
  purchase_id            UUID,
  payment_transaction_id TEXT,
  settlement_source      TEXT NOT NULL
    CHECK (settlement_source IN (
      'CHECKOUT_SETTLEMENT',
      'AUCTION_PAYMENT_SETTLEMENT',
      'OFFER_PAYMENT_SETTLEMENT'
    )),
  sale_mechanism         TEXT,
  completed_at           TIMESTAMPTZ NOT NULL,
  final_price            NUMERIC(12, 2) NOT NULL CHECK (final_price > 0),
  currency               TEXT NOT NULL DEFAULT 'USD',
  media_condition        TEXT,
  sleeve_condition       TEXT,
  artist                 TEXT,
  title                  TEXT,
  catalog_number         TEXT,
  label                  TEXT,
  release_id             TEXT,
  pressing_id            TEXT,
  authorization_scope    TEXT NOT NULL DEFAULT 'first_party_settlement',
  rights_status          TEXT NOT NULL DEFAULT 'FIRST_PARTY',
  deletion_status        TEXT NOT NULL DEFAULT 'ACTIVE',
  evidence_snapshot_id   TEXT NOT NULL,
  evidence_snapshot_hash TEXT NOT NULL,
  payload_hash           TEXT NOT NULL,
  payload                JSONB NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sale_completed_events_listing_fk
    FOREIGN KEY (listing_id) REFERENCES listings.listings(id)
);

CREATE INDEX IF NOT EXISTS idx_sale_completed_events_listing
  ON listings.sale_completed_events (listing_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_sale_completed_events_completed_at
  ON listings.sale_completed_events (completed_at DESC);

COMMENT ON TABLE listings.sale_completed_events IS
  'Phase A immutable SALE_COMPLETED events. Seed COMPLETED_SALE JSON is not stored here.';
