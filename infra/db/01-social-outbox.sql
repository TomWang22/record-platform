-- Transactional outbox for social-service. Run against database 'social' (e.g. port 5434).
-- Dedicated schema `social` for platform glue (forum/messages schemas hold domain tables).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS social;

CREATE TABLE IF NOT EXISTS social.outbox_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id  TEXT NOT NULL,
  type          TEXT NOT NULL,
  version       INT NOT NULL,
  payload       BYTEA NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published     BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_social_outbox_events_unpublished
  ON social.outbox_events(published, created_at)
  WHERE published = false;

COMMENT ON COLUMN social.outbox_events.payload IS 'Serialized domain event (proto bytes); not JSON.';
COMMENT ON COLUMN social.outbox_events.id IS 'UUID = envelope.event_id.';
COMMENT ON TABLE social.outbox_events IS 'Transactional outbox; Kafka key = aggregate_id.';
