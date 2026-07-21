-- Phase 34 runtime: outbox publisher privileges, Kafka identity conflicts,
-- eligibility append-only, deterministic calculation ledger.
-- Isolated integration listings DB (port 5435). Not production.
--
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 5435 -U postgres -d listings \
--     -v ON_ERROR_STOP=1 -f infra/db/56-phase34-runtime-immutability.sql

SET ROLE postgres;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) Outbox: NOT NULL + unique identity for SaleCompleted; publisher role
-- ---------------------------------------------------------------------------
UPDATE listings.outbox_events
SET
  idempotency_key = COALESCE(NULLIF(idempotency_key, ''), id::text),
  payload_hash = COALESCE(
    NULLIF(payload_hash, ''),
    encode(sha256(COALESCE(payload, ''::bytea)), 'hex')
  ),
  source_sha = COALESCE(NULLIF(source_sha, ''), 'unknown-pre-migration-56')
WHERE type = 'SaleCompleted';

ALTER TABLE listings.outbox_events
  DROP CONSTRAINT IF EXISTS outbox_sale_completed_identity_nn;

-- Partial NOT NULL via CHECK for SaleCompleted rows
ALTER TABLE listings.outbox_events
  DROP CONSTRAINT IF EXISTS outbox_sale_completed_required_fields;
ALTER TABLE listings.outbox_events
  ADD CONSTRAINT outbox_sale_completed_required_fields CHECK (
    type <> 'SaleCompleted'
    OR (
      idempotency_key IS NOT NULL
      AND length(idempotency_key) > 0
      AND payload_hash IS NOT NULL
      AND length(payload_hash) > 0
      AND source_sha IS NOT NULL
      AND length(source_sha) > 0
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_sale_completed_idempotency
  ON listings.outbox_events (idempotency_key)
  WHERE type = 'SaleCompleted';

CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_sale_completed_payload_hash
  ON listings.outbox_events (payload_hash)
  WHERE type = 'SaleCompleted';

-- Dedicated publisher role: only mutates publisher-state columns via functions.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_outbox_publisher') THEN
    CREATE ROLE record_outbox_publisher NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA listings TO record_outbox_publisher;
GRANT SELECT, INSERT ON listings.outbox_events TO record_outbox_publisher;

-- Revoke broad UPDATE from application RW role.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readwrite') THEN
    REVOKE UPDATE ON listings.outbox_events FROM record_readwrite;
    GRANT SELECT, INSERT ON listings.outbox_events TO record_readwrite;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION listings.outbox_forbid_immutable_column_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.type IS DISTINCT FROM OLD.type
       OR NEW.aggregate_id IS DISTINCT FROM OLD.aggregate_id
       OR NEW.payload IS DISTINCT FROM OLD.payload
       OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.source_sha IS DISTINCT FROM OLD.source_sha
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'OUTBOX_IMMUTABLE_COLUMNS: cannot mutate identity/payload fields'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_outbox_forbid_immutable_column_change ON listings.outbox_events;
CREATE TRIGGER trg_outbox_forbid_immutable_column_change
  BEFORE UPDATE ON listings.outbox_events
  FOR EACH ROW EXECUTE FUNCTION listings.outbox_forbid_immutable_column_change();

CREATE OR REPLACE FUNCTION listings.lease_outbox_batch(
  p_limit INTEGER,
  p_owner TEXT,
  p_lease_ms INTEGER,
  p_type TEXT DEFAULT 'SaleCompleted'
)
RETURNS SETOF listings.outbox_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = listings, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id
    FROM listings.outbox_events
    WHERE published = false
      AND COALESCE(dead_lettered, false) = false
      AND type = p_type
      AND next_attempt_at <= NOW()
      AND (leased_until IS NULL OR leased_until < NOW())
    ORDER BY created_at ASC
    LIMIT GREATEST(p_limit, 0)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE listings.outbox_events o
  SET leased_until = NOW() + (GREATEST(p_lease_ms, 1)::text || ' milliseconds')::interval,
      lease_owner = p_owner
  FROM picked
  WHERE o.id = picked.id
  RETURNING o.*;
END;
$$;

CREATE OR REPLACE FUNCTION listings.acknowledge_outbox_publish(
  p_id UUID,
  p_topic TEXT,
  p_partition INTEGER,
  p_offset BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = listings, pg_temp
AS $$
BEGIN
  UPDATE listings.outbox_events
  SET published = true,
      published_at = NOW(),
      leased_until = NULL,
      lease_owner = NULL,
      last_error = NULL,
      broker_topic = p_topic,
      broker_partition = p_partition,
      broker_offset = p_offset
  WHERE id = p_id
    AND published = false;
END;
$$;

CREATE OR REPLACE FUNCTION listings.reschedule_outbox_event(
  p_id UUID,
  p_error TEXT,
  p_next_attempt_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = listings, pg_temp
AS $$
BEGIN
  UPDATE listings.outbox_events
  SET retry_count = COALESCE(retry_count, 0) + 1,
      last_error = left(COALESCE(p_error, 'unknown'), 4000),
      next_attempt_at = p_next_attempt_at,
      leased_until = NULL,
      lease_owner = NULL
  WHERE id = p_id
    AND published = false
    AND COALESCE(dead_lettered, false) = false;
END;
$$;

CREATE OR REPLACE FUNCTION listings.dead_letter_outbox_event(
  p_id UUID,
  p_error TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = listings, pg_temp
AS $$
BEGIN
  UPDATE listings.outbox_events
  SET dead_lettered = true,
      dead_lettered_at = NOW(),
      last_error = left(COALESCE(p_error, 'dead_letter'), 4000),
      leased_until = NULL,
      lease_owner = NULL
  WHERE id = p_id
    AND published = false;
END;
$$;

CREATE OR REPLACE FUNCTION listings.release_outbox_lease(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = listings, pg_temp
AS $$
BEGIN
  UPDATE listings.outbox_events
  SET leased_until = NULL,
      lease_owner = NULL
  WHERE id = p_id
    AND published = false;
END;
$$;

GRANT EXECUTE ON FUNCTION listings.lease_outbox_batch(INTEGER, TEXT, INTEGER, TEXT) TO record_outbox_publisher, record_readwrite;
GRANT EXECUTE ON FUNCTION listings.acknowledge_outbox_publish(UUID, TEXT, INTEGER, BIGINT) TO record_outbox_publisher, record_readwrite;
GRANT EXECUTE ON FUNCTION listings.reschedule_outbox_event(UUID, TEXT, TIMESTAMPTZ) TO record_outbox_publisher, record_readwrite;
GRANT EXECUTE ON FUNCTION listings.dead_letter_outbox_event(UUID, TEXT) TO record_outbox_publisher, record_readwrite;
GRANT EXECUTE ON FUNCTION listings.release_outbox_lease(UUID) TO record_outbox_publisher, record_readwrite;

-- ---------------------------------------------------------------------------
-- 2) Kafka consumer: identity uniqueness + conflict result
-- ---------------------------------------------------------------------------
ALTER TABLE intelligence.kafka_consumer_lineage
  DROP CONSTRAINT IF EXISTS kafka_consumer_lineage_result_check;

ALTER TABLE intelligence.kafka_consumer_lineage
  ADD CONSTRAINT kafka_consumer_lineage_result_check CHECK (result = ANY (ARRAY[
    'ACCEPTED',
    'DUPLICATE',
    'REJECTED',
    'QUARANTINED',
    'IDENTITY_PAYLOAD_CONFLICT'
  ]));

-- Replace weak uniqueness with source_event_id + normalization_version.
ALTER TABLE intelligence.kafka_consumer_lineage
  DROP CONSTRAINT IF EXISTS kafka_consumer_lineage_source_event_id_payload_hash_normalization_key;

ALTER TABLE intelligence.kafka_consumer_lineage
  DROP CONSTRAINT IF EXISTS kafka_consumer_lineage_source_event_id_payload_hash_normali_key;

DROP INDEX IF EXISTS intelligence.kafka_consumer_lineage_source_event_id_payload_hash_normalization_key;
DROP INDEX IF EXISTS intelligence.kafka_consumer_lineage_source_event_id_payload_hash_normali_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_kafka_consumer_lineage_source_norm
  ON intelligence.kafka_consumer_lineage (source_event_id, normalization_version)
  WHERE source_event_id IS NOT NULL;

COMMENT ON INDEX intelligence.uq_kafka_consumer_lineage_source_norm IS
  'One lineage identity per source_event_id+normalization_version; payload hash compared in application for DUPLICATE vs IDENTITY_PAYLOAD_CONFLICT.';

-- ---------------------------------------------------------------------------
-- 3) Eligibility decisions: append-only + supersession links
-- ---------------------------------------------------------------------------
ALTER TABLE intelligence.eligibility_decisions
  ADD COLUMN IF NOT EXISTS eligibility_decision_id TEXT,
  ADD COLUMN IF NOT EXISTS previous_decision_id TEXT,
  ADD COLUMN IF NOT EXISTS superseded_by_decision_id TEXT,
  ADD COLUMN IF NOT EXISTS request_id TEXT,
  ADD COLUMN IF NOT EXISTS session_id TEXT,
  ADD COLUMN IF NOT EXISTS turn_id TEXT,
  ADD COLUMN IF NOT EXISTS supersession_reason TEXT;

UPDATE intelligence.eligibility_decisions
SET eligibility_decision_id = COALESCE(
  eligibility_decision_id,
  'ed-' || decision_id::text
)
WHERE eligibility_decision_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_eligibility_decision_id
  ON intelligence.eligibility_decisions (eligibility_decision_id);

DO $$
DECLARE
  t TEXT := 'eligibility_decisions';
BEGIN
  EXECUTE format(
    'DROP TRIGGER IF EXISTS trg_%s_deny_update ON intelligence.%I',
    t, t
  );
  EXECUTE format(
    'CREATE TRIGGER trg_%s_deny_update BEFORE UPDATE ON intelligence.%I
     FOR EACH ROW EXECUTE FUNCTION intelligence.deny_append_only_mutation()',
    t, t
  );
  EXECUTE format(
    'DROP TRIGGER IF EXISTS trg_%s_deny_delete ON intelligence.%I',
    t, t
  );
  EXECUTE format(
    'CREATE TRIGGER trg_%s_deny_delete BEFORE DELETE ON intelligence.%I
     FOR EACH ROW EXECUTE FUNCTION intelligence.deny_append_only_mutation()',
    t, t
  );
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readwrite') THEN
    REVOKE UPDATE, DELETE ON intelligence.eligibility_decisions FROM record_readwrite;
    GRANT SELECT, INSERT ON intelligence.eligibility_decisions TO record_readwrite;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4) Immutable deterministic calculation records
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intelligence.deterministic_calculations (
  calculation_id           TEXT PRIMARY KEY,
  capability               TEXT NOT NULL,
  evidence_snapshot_id     TEXT NOT NULL
    REFERENCES intelligence.evidence_snapshots(evidence_snapshot_id),
  algorithm_version        TEXT NOT NULL DEFAULT 'phase34-valuation-calc-v1',
  currency                 TEXT NOT NULL,
  eligible_sale_prices     JSONB NOT NULL DEFAULT '[]'::jsonb,
  normalized_prices        JSONB NOT NULL DEFAULT '[]'::jsonb,
  time_range               JSONB NOT NULL DEFAULT '{}'::jsonb,
  condition_adjustments    JSONB NOT NULL DEFAULT '{}'::jsonb,
  outlier_decisions        JSONB NOT NULL DEFAULT '[]'::jsonb,
  median                   NUMERIC,
  dispersion               NUMERIC,
  quick_sale_range         JSONB,
  fair_market_range        JSONB,
  patient_sale_range       JSONB,
  confidence_inputs        JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_hash              TEXT NOT NULL,
  payload                  JSONB NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deterministic_calculations_snapshot
  ON intelligence.deterministic_calculations (evidence_snapshot_id);

DO $$
DECLARE
  t TEXT := 'deterministic_calculations';
BEGIN
  EXECUTE format(
    'DROP TRIGGER IF EXISTS trg_%s_deny_update ON intelligence.%I',
    t, t
  );
  EXECUTE format(
    'CREATE TRIGGER trg_%s_deny_update BEFORE UPDATE ON intelligence.%I
     FOR EACH ROW EXECUTE FUNCTION intelligence.deny_append_only_mutation()',
    t, t
  );
  EXECUTE format(
    'DROP TRIGGER IF EXISTS trg_%s_deny_delete ON intelligence.%I',
    t, t
  );
  EXECUTE format(
    'CREATE TRIGGER trg_%s_deny_delete BEFORE DELETE ON intelligence.%I
     FOR EACH ROW EXECUTE FUNCTION intelligence.deny_append_only_mutation()',
    t, t
  );
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readwrite') THEN
    GRANT SELECT, INSERT ON intelligence.deterministic_calculations TO record_readwrite;
    REVOKE UPDATE, DELETE ON intelligence.deterministic_calculations FROM record_readwrite;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readonly') THEN
    GRANT SELECT ON intelligence.deterministic_calculations TO record_readonly;
  END IF;
END $$;
