-- Optional transactional outbox for analytics-service when it **publishes** derived signals (most traffic is consume-only).
-- Run against database 'analytics' (e.g. port 5447). Safe to apply even if the service only consumes (unused until first emit).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS analytics.outbox_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id  TEXT NOT NULL,
  type          TEXT NOT NULL,
  version       INT NOT NULL,
  payload       BYTEA NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published     BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_analytics_outbox_events_unpublished
  ON analytics.outbox_events(published, created_at)
  WHERE published = false;

COMMENT ON COLUMN analytics.outbox_events.payload IS 'Serialized domain event (proto bytes); not JSON.';
COMMENT ON COLUMN analytics.outbox_events.id IS 'UUID = envelope.event_id.';
COMMENT ON TABLE analytics.outbox_events IS 'Transactional outbox for analytics-originated events; Kafka key = aggregate_id.';
