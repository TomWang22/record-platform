-- Transactional outbox for auction-monitor service. Run against database 'auction_monitor' (e.g. port 5438).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS auction_monitor;

CREATE TABLE IF NOT EXISTS auction_monitor.outbox_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id  TEXT NOT NULL,
  type          TEXT NOT NULL,
  version       INT NOT NULL,
  payload       BYTEA NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published     BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_auction_monitor_outbox_events_unpublished
  ON auction_monitor.outbox_events(published, created_at)
  WHERE published = false;

COMMENT ON COLUMN auction_monitor.outbox_events.payload IS 'Serialized domain event (proto bytes); not JSON.';
COMMENT ON COLUMN auction_monitor.outbox_events.id IS 'UUID = envelope.event_id.';
COMMENT ON TABLE auction_monitor.outbox_events IS 'Transactional outbox; Kafka key = aggregate_id.';
