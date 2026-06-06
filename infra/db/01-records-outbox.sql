-- Transactional outbox for records-service. Run against database 'records' (e.g. port 5433).
-- Idempotent. Same transaction as domain write; publisher → ${ENV_PREFIX}.records.events (EventEnvelope).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS records;

CREATE TABLE IF NOT EXISTS records.outbox_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id  TEXT NOT NULL,
  type          TEXT NOT NULL,
  version       INT NOT NULL,
  payload       BYTEA NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published     BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_records_outbox_events_unpublished
  ON records.outbox_events(published, created_at)
  WHERE published = false;

COMMENT ON COLUMN records.outbox_events.payload IS 'Serialized domain event (proto bytes); not JSON.';
COMMENT ON COLUMN records.outbox_events.id IS 'UUID = envelope.event_id; publisher must set envelope.event_id = this id.';
COMMENT ON TABLE records.outbox_events IS 'Transactional outbox; Kafka key = aggregate_id.';
