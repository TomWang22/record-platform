-- T15.4B — Persisted auction AI risk signals with source_refs.
-- Run against auction_monitor DB (port 5438).

CREATE SCHEMA IF NOT EXISTS auction_monitor;

CREATE TABLE IF NOT EXISTS auction_monitor.ai_signals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    TEXT NOT NULL,
  signal_code   TEXT NOT NULL
    CHECK (signal_code IN (
      'bid_spike', 'ending_soon', 'proxy_bid_pressure',
      'reserve_not_met', 'likely_underpriced', 'stale_listing'
    )),
  severity      TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  confidence    NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  detail        TEXT,
  source_refs   JSONB NOT NULL DEFAULT '[]'::jsonb,
  detected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  outbox_id     UUID,
  published     BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (listing_id, signal_code)
);

CREATE INDEX IF NOT EXISTS idx_ai_signals_listing
  ON auction_monitor.ai_signals (listing_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_signals_unpublished
  ON auction_monitor.ai_signals (published, detected_at)
  WHERE published = false;

COMMENT ON TABLE auction_monitor.ai_signals IS 'Rule-derived auction risk signals; bidder identity never stored in detail text.';
