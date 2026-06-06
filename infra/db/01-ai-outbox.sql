-- Transactional outbox for python-ai service. Run against database 'python_ai' (e.g. port 5440).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS ai;

CREATE TABLE IF NOT EXISTS ai.outbox_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id  TEXT NOT NULL,
  type          TEXT NOT NULL,
  version       INT NOT NULL,
  payload       BYTEA NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published     BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_ai_outbox_events_unpublished
  ON ai.outbox_events(published, created_at)
  WHERE published = false;

COMMENT ON COLUMN ai.outbox_events.payload IS 'Serialized domain event (proto bytes); not JSON.';
COMMENT ON COLUMN ai.outbox_events.id IS 'UUID = envelope.event_id.';
COMMENT ON TABLE ai.outbox_events IS 'Transactional outbox; Kafka key = aggregate_id.';
