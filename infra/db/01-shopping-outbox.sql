-- Transactional outbox for shopping-service. Run against database 'shopping' (e.g. port 5436).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS shopping;

CREATE TABLE IF NOT EXISTS shopping.outbox_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id  TEXT NOT NULL,
  type          TEXT NOT NULL,
  version       INT NOT NULL,
  payload       BYTEA NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published     BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_shopping_outbox_events_unpublished
  ON shopping.outbox_events(published, created_at)
  WHERE published = false;

COMMENT ON COLUMN shopping.outbox_events.payload IS 'Serialized domain event (proto bytes); not JSON.';
COMMENT ON COLUMN shopping.outbox_events.id IS 'UUID = envelope.event_id.';
COMMENT ON TABLE shopping.outbox_events IS 'Transactional outbox; Kafka key = aggregate_id.';
