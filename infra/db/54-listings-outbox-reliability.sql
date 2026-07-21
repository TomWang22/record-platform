-- Phase 34 runtime: outbox reliability + Kafka consumer lineage / quarantine.
-- Isolated integration listings DB (port 5435). Not production.
--
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 5435 -U postgres -d listings \
--     -v ON_ERROR_STOP=1 -f infra/db/54-listings-outbox-reliability.sql

SET ROLE postgres;

-- ---------------------------------------------------------------------------
-- Outbox reliability columns (SaleCompleted publisher hardening)
-- ---------------------------------------------------------------------------
ALTER TABLE listings.outbox_events
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS leased_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lease_owner TEXT,
  ADD COLUMN IF NOT EXISTS broker_topic TEXT,
  ADD COLUMN IF NOT EXISTS broker_partition INTEGER,
  ADD COLUMN IF NOT EXISTS broker_offset BIGINT,
  ADD COLUMN IF NOT EXISTS dead_lettered BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS payload_hash TEXT,
  ADD COLUMN IF NOT EXISTS source_sha TEXT;

CREATE INDEX IF NOT EXISTS idx_listings_outbox_eligible
  ON listings.outbox_events (next_attempt_at, created_at)
  WHERE published = false AND dead_lettered = false;

CREATE INDEX IF NOT EXISTS idx_listings_outbox_lease
  ON listings.outbox_events (leased_until)
  WHERE published = false AND leased_until IS NOT NULL;

COMMENT ON COLUMN listings.outbox_events.retry_count IS
  'Publisher retry attempts after Kafka/ack failure.';
COMMENT ON COLUMN listings.outbox_events.published_at IS
  'Set only after broker acknowledgement + durable mark.';
COMMENT ON COLUMN listings.outbox_events.dead_lettered IS
  'True after configured retry limit; payload remains immutable.';

-- ---------------------------------------------------------------------------
-- Consumer lineage + quarantine (idempotent Kafka → market_events)
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS intelligence;

CREATE TABLE IF NOT EXISTS intelligence.kafka_consumer_lineage (
  lineage_id           TEXT PRIMARY KEY,
  topic                TEXT NOT NULL,
  partition_id         INTEGER NOT NULL,
  record_offset        BIGINT NOT NULL,
  received_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_event_id      TEXT,
  market_event_id      TEXT,
  payload_hash         TEXT NOT NULL,
  normalization_version TEXT NOT NULL DEFAULT 'phase34-market-event-v2',
  result               TEXT NOT NULL
    CHECK (result IN ('ACCEPTED', 'DUPLICATE', 'REJECTED', 'QUARANTINED')),
  duplicate_flag       BOOLEAN NOT NULL DEFAULT FALSE,
  rejection_reason     TEXT,
  processing_latency_ms INTEGER,
  source_sha           TEXT,
  UNIQUE (topic, partition_id, record_offset),
  UNIQUE (source_event_id, payload_hash, normalization_version)
);

CREATE INDEX IF NOT EXISTS idx_kafka_consumer_lineage_market
  ON intelligence.kafka_consumer_lineage (market_event_id)
  WHERE market_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS intelligence.kafka_event_quarantine (
  quarantine_id   TEXT PRIMARY KEY,
  topic           TEXT NOT NULL,
  partition_id    INTEGER,
  record_offset   BIGINT,
  source_event_id TEXT,
  payload         JSONB NOT NULL,
  reason          TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  replayed_at     TIMESTAMPTZ
);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readwrite') THEN
    GRANT SELECT, INSERT, UPDATE ON listings.outbox_events TO record_readwrite;
    GRANT SELECT, INSERT ON intelligence.kafka_consumer_lineage TO record_readwrite;
    GRANT SELECT, INSERT, UPDATE ON intelligence.kafka_event_quarantine TO record_readwrite;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readonly') THEN
    GRANT SELECT ON intelligence.kafka_consumer_lineage TO record_readonly;
    GRANT SELECT ON intelligence.kafka_event_quarantine TO record_readonly;
  END IF;
END $$;
