-- Phase 34 runtime: split Kafka identity vs delivery lineage, revoke PUBLIC
-- execute on publisher functions, bind mutations to lease owner, eligibility
-- supersession edges, drop global payload-hash uniqueness.
-- Isolated integration listings DB (port 5435). Not production.
--
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 5435 -U postgres -d listings \
--     -v ON_ERROR_STOP=1 -f infra/db/57-phase34-runtime-delivery-and-supersession-hardening.sql

SET ROLE postgres;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- B1. Kafka event identity (one row) + delivery lineage (one row per broker delivery)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intelligence.kafka_event_identities (
  source_event_id          TEXT NOT NULL,
  normalization_version    TEXT NOT NULL DEFAULT 'phase34-market-event-v2',
  canonical_payload_hash   TEXT NOT NULL,
  accepted_market_event_id TEXT,
  first_topic              TEXT NOT NULL,
  first_partition          INTEGER NOT NULL,
  first_offset             BIGINT NOT NULL,
  accepted_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_sha               TEXT,
  PRIMARY KEY (source_event_id, normalization_version)
);

CREATE INDEX IF NOT EXISTS idx_kafka_event_identities_market
  ON intelligence.kafka_event_identities (accepted_market_event_id)
  WHERE accepted_market_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS intelligence.kafka_delivery_lineage (
  delivery_lineage_id      TEXT PRIMARY KEY,
  topic                    TEXT NOT NULL,
  partition_id             INTEGER NOT NULL,
  record_offset            BIGINT NOT NULL,
  received_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_event_id          TEXT,
  normalization_version    TEXT NOT NULL DEFAULT 'phase34-market-event-v2',
  received_payload_hash    TEXT NOT NULL,
  canonical_payload_hash   TEXT,
  market_event_id          TEXT,
  result                   TEXT NOT NULL
    CHECK (result = ANY (ARRAY[
      'ACCEPTED',
      'DUPLICATE_DELIVERY',
      'IDENTITY_PAYLOAD_CONFLICT',
      'REJECTED',
      'QUARANTINED'
    ])),
  duplicate_flag           BOOLEAN NOT NULL DEFAULT FALSE,
  rejection_reason         TEXT,
  processing_latency_ms    INTEGER,
  source_sha               TEXT,
  UNIQUE (topic, partition_id, record_offset)
);

CREATE INDEX IF NOT EXISTS idx_kafka_delivery_lineage_source
  ON intelligence.kafka_delivery_lineage (source_event_id, normalization_version);

-- Drop migration-56 unique that blocked retaining duplicate/conflict deliveries.
DROP INDEX IF EXISTS intelligence.uq_kafka_consumer_lineage_source_norm;

-- Allow legacy kafka_consumer_lineage to record DUPLICATE_DELIVERY naming.
ALTER TABLE intelligence.kafka_consumer_lineage
  DROP CONSTRAINT IF EXISTS kafka_consumer_lineage_result_check;

ALTER TABLE intelligence.kafka_consumer_lineage
  ADD CONSTRAINT kafka_consumer_lineage_result_check CHECK (result = ANY (ARRAY[
    'ACCEPTED',
    'DUPLICATE',
    'DUPLICATE_DELIVERY',
    'REJECTED',
    'QUARANTINED',
    'IDENTITY_PAYLOAD_CONFLICT'
  ]));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readwrite') THEN
    GRANT SELECT, INSERT ON intelligence.kafka_event_identities TO record_readwrite;
    GRANT SELECT, INSERT ON intelligence.kafka_delivery_lineage TO record_readwrite;
    REVOKE UPDATE, DELETE ON intelligence.kafka_event_identities FROM record_readwrite;
    REVOKE UPDATE, DELETE ON intelligence.kafka_delivery_lineage FROM record_readwrite;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readonly') THEN
    GRANT SELECT ON intelligence.kafka_event_identities TO record_readonly;
    GRANT SELECT ON intelligence.kafka_delivery_lineage TO record_readonly;
  END IF;
END $$;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['kafka_event_identities', 'kafka_delivery_lineage']
  LOOP
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
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- B2. Payload hash is integrity, not business identity
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS listings.uq_outbox_sale_completed_payload_hash;

CREATE INDEX IF NOT EXISTS idx_outbox_sale_completed_payload_hash
  ON listings.outbox_events (payload_hash)
  WHERE type = 'SaleCompleted';

-- Reject unknown source_sha on NEW SaleCompleted inserts (legacy may keep LEGACY_UNKNOWN).
CREATE OR REPLACE FUNCTION listings.outbox_sale_completed_source_sha_gate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.type = 'SaleCompleted' THEN
    IF NEW.source_sha IS NULL
       OR length(trim(NEW.source_sha)) = 0
       OR lower(NEW.source_sha) IN ('unknown', 'unknown-pre-migration-56')
    THEN
      RAISE EXCEPTION 'OUTBOX_SOURCE_SHA_INVALID: SaleCompleted requires concrete source_sha (not unknown)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_outbox_sale_completed_source_sha_gate ON listings.outbox_events;
CREATE TRIGGER trg_outbox_sale_completed_source_sha_gate
  BEFORE INSERT ON listings.outbox_events
  FOR EACH ROW EXECUTE FUNCTION listings.outbox_sale_completed_source_sha_gate();

-- Classify legacy unknown rows so they cannot enter new acceptance snapshots.
-- Temporarily disable immutable-column trigger (source_sha is otherwise locked).
ALTER TABLE listings.outbox_events DISABLE TRIGGER trg_outbox_forbid_immutable_column_change;
UPDATE listings.outbox_events
SET source_sha = 'LEGACY_UNKNOWN'
WHERE type = 'SaleCompleted'
  AND (
    source_sha IS NULL
    OR length(trim(source_sha)) = 0
    OR lower(source_sha) IN ('unknown', 'unknown-pre-migration-56')
  );
ALTER TABLE listings.outbox_events ENABLE TRIGGER trg_outbox_forbid_immutable_column_change;

-- ---------------------------------------------------------------------------
-- B4. Publisher action ledger + owner-bound SECURITY DEFINER functions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listings.outbox_publisher_action_ledger (
  action_id         TEXT PRIMARY KEY,
  outbox_event_id   UUID NOT NULL,
  action            TEXT NOT NULL
    CHECK (action = ANY (ARRAY[
      'LEASE', 'ACKNOWLEDGE', 'RESCHEDULE', 'DEAD_LETTER', 'RELEASE',
      'ACKNOWLEDGE_DENIED', 'RESCHEDULE_DENIED', 'DEAD_LETTER_DENIED', 'RELEASE_DENIED'
    ])),
  lease_owner       TEXT,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retry_count       INTEGER,
  broker_topic      TEXT,
  broker_partition  INTEGER,
  broker_offset     BIGINT,
  result            TEXT NOT NULL CHECK (result IN ('OK', 'DENIED', 'NOOP', 'ERROR')),
  error_class       TEXT
);

CREATE INDEX IF NOT EXISTS idx_outbox_publisher_action_event
  ON listings.outbox_publisher_action_ledger (outbox_event_id, occurred_at);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_outbox_publisher') THEN
    CREATE ROLE record_outbox_publisher NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA listings TO record_outbox_publisher;
GRANT SELECT ON listings.outbox_events TO record_outbox_publisher;
GRANT INSERT ON listings.outbox_publisher_action_ledger TO record_outbox_publisher;
GRANT SELECT ON listings.outbox_publisher_action_ledger TO record_outbox_publisher;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readwrite') THEN
    GRANT SELECT, INSERT ON listings.outbox_publisher_action_ledger TO record_readwrite;
    REVOKE UPDATE, DELETE ON listings.outbox_publisher_action_ledger FROM record_readwrite;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION listings._outbox_log_action(
  p_event_id UUID,
  p_action TEXT,
  p_owner TEXT,
  p_result TEXT,
  p_error_class TEXT DEFAULT NULL,
  p_retry INTEGER DEFAULT NULL,
  p_topic TEXT DEFAULT NULL,
  p_partition INTEGER DEFAULT NULL,
  p_offset BIGINT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = listings, public, pg_temp
AS $$
BEGIN
  INSERT INTO listings.outbox_publisher_action_ledger (
    action_id, outbox_event_id, action, lease_owner, retry_count,
    broker_topic, broker_partition, broker_offset, result, error_class
  ) VALUES (
    'act-' || replace(gen_random_uuid()::text, '-', ''),
    p_event_id, p_action, p_owner, p_retry,
    p_topic, p_partition, p_offset, p_result, p_error_class
  );
END;
$$;

-- Drop old signatures (migration 56).
DROP FUNCTION IF EXISTS listings.acknowledge_outbox_publish(UUID, TEXT, INTEGER, BIGINT);
DROP FUNCTION IF EXISTS listings.reschedule_outbox_event(UUID, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS listings.dead_letter_outbox_event(UUID, TEXT);
DROP FUNCTION IF EXISTS listings.release_outbox_lease(UUID);

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
  IF p_owner IS NULL OR length(trim(p_owner)) = 0 THEN
    RAISE EXCEPTION 'OUTBOX_LEASE_OWNER_REQUIRED'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

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
  ),
  updated AS (
    UPDATE listings.outbox_events o
    SET leased_until = NOW() + (GREATEST(p_lease_ms, 1)::text || ' milliseconds')::interval,
        lease_owner = p_owner
    FROM picked
    WHERE o.id = picked.id
    RETURNING o.*
  )
  SELECT * FROM updated;
END;
$$;

CREATE OR REPLACE FUNCTION listings.acknowledge_outbox_publish(
  p_id UUID,
  p_owner TEXT,
  p_topic TEXT,
  p_partition INTEGER,
  p_offset BIGINT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = listings, pg_temp
AS $$
DECLARE
  n INTEGER := 0;
BEGIN
  IF p_owner IS NULL OR length(trim(p_owner)) = 0 THEN
    RAISE EXCEPTION 'OUTBOX_LEASE_OWNER_REQUIRED'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_topic IS NULL OR p_partition IS NULL OR p_offset IS NULL THEN
    RAISE EXCEPTION 'OUTBOX_BROKER_ACK_INCOMPLETE'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

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
    AND published = false
    AND COALESCE(dead_lettered, false) = false
    AND lease_owner = p_owner
    AND leased_until IS NOT NULL
    AND leased_until >= NOW();

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    PERFORM listings._outbox_log_action(
      p_id, 'ACKNOWLEDGE_DENIED', p_owner, 'DENIED', 'WRONG_OR_EXPIRED_LEASE',
      NULL, p_topic, p_partition, p_offset
    );
    RAISE EXCEPTION 'OUTBOX_ACK_DENIED: event % not owned by % or lease expired/published', p_id, p_owner
      USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM listings._outbox_log_action(
    p_id, 'ACKNOWLEDGE', p_owner, 'OK', NULL, NULL, p_topic, p_partition, p_offset
  );
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION listings.reschedule_outbox_event(
  p_id UUID,
  p_owner TEXT,
  p_error TEXT,
  p_next_attempt_at TIMESTAMPTZ
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = listings, pg_temp
AS $$
DECLARE
  n INTEGER := 0;
  rc INTEGER;
BEGIN
  IF p_owner IS NULL OR length(trim(p_owner)) = 0 THEN
    RAISE EXCEPTION 'OUTBOX_LEASE_OWNER_REQUIRED'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE listings.outbox_events
  SET retry_count = COALESCE(retry_count, 0) + 1,
      last_error = left(COALESCE(p_error, 'unknown'), 4000),
      next_attempt_at = p_next_attempt_at,
      leased_until = NULL,
      lease_owner = NULL
  WHERE id = p_id
    AND published = false
    AND COALESCE(dead_lettered, false) = false
    AND lease_owner = p_owner
    AND leased_until IS NOT NULL
    AND leased_until >= NOW()
  RETURNING retry_count INTO rc;

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    PERFORM listings._outbox_log_action(
      p_id, 'RESCHEDULE_DENIED', p_owner, 'DENIED', 'WRONG_OR_EXPIRED_LEASE'
    );
    RAISE EXCEPTION 'OUTBOX_RESCHEDULE_DENIED: event % not owned by %', p_id, p_owner
      USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM listings._outbox_log_action(
    p_id, 'RESCHEDULE', p_owner, 'OK', NULL, rc
  );
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION listings.dead_letter_outbox_event(
  p_id UUID,
  p_owner TEXT,
  p_error TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = listings, pg_temp
AS $$
DECLARE
  n INTEGER := 0;
BEGIN
  IF p_owner IS NULL OR length(trim(p_owner)) = 0 THEN
    RAISE EXCEPTION 'OUTBOX_LEASE_OWNER_REQUIRED'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE listings.outbox_events
  SET dead_lettered = true,
      dead_lettered_at = NOW(),
      last_error = left(COALESCE(p_error, 'dead_letter'), 4000),
      leased_until = NULL,
      lease_owner = NULL
  WHERE id = p_id
    AND published = false
    AND lease_owner = p_owner
    AND leased_until IS NOT NULL
    AND leased_until >= NOW();

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    PERFORM listings._outbox_log_action(
      p_id, 'DEAD_LETTER_DENIED', p_owner, 'DENIED', 'WRONG_OR_EXPIRED_LEASE'
    );
    RAISE EXCEPTION 'OUTBOX_DEAD_LETTER_DENIED: event % not owned by %', p_id, p_owner
      USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM listings._outbox_log_action(
    p_id, 'DEAD_LETTER', p_owner, 'OK', left(COALESCE(p_error, 'dead_letter'), 200)
  );
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION listings.release_outbox_lease(
  p_id UUID,
  p_owner TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = listings, pg_temp
AS $$
DECLARE
  n INTEGER := 0;
BEGIN
  IF p_owner IS NULL OR length(trim(p_owner)) = 0 THEN
    RAISE EXCEPTION 'OUTBOX_LEASE_OWNER_REQUIRED'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE listings.outbox_events
  SET leased_until = NULL,
      lease_owner = NULL
  WHERE id = p_id
    AND published = false
    AND lease_owner = p_owner
    AND leased_until IS NOT NULL
    AND leased_until >= NOW();

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    PERFORM listings._outbox_log_action(
      p_id, 'RELEASE_DENIED', p_owner, 'DENIED', 'WRONG_OR_EXPIRED_LEASE'
    );
    RAISE EXCEPTION 'OUTBOX_RELEASE_DENIED: event % not owned by %', p_id, p_owner
      USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM listings._outbox_log_action(p_id, 'RELEASE', p_owner, 'OK');
  RETURN n;
END;
$$;

-- ---------------------------------------------------------------------------
-- B3. REVOKE PUBLIC execute; grant only publisher role (+ documented shopping path)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION listings.lease_outbox_batch(INTEGER, TEXT, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION listings.acknowledge_outbox_publish(UUID, TEXT, TEXT, INTEGER, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION listings.reschedule_outbox_event(UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION listings.dead_letter_outbox_event(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION listings.release_outbox_lease(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION listings._outbox_log_action(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, INTEGER, BIGINT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION listings.lease_outbox_batch(INTEGER, TEXT, INTEGER, TEXT)
  TO record_outbox_publisher;
GRANT EXECUTE ON FUNCTION listings.acknowledge_outbox_publish(UUID, TEXT, TEXT, INTEGER, BIGINT)
  TO record_outbox_publisher;
GRANT EXECUTE ON FUNCTION listings.reschedule_outbox_event(UUID, TEXT, TEXT, TIMESTAMPTZ)
  TO record_outbox_publisher;
GRANT EXECUTE ON FUNCTION listings.dead_letter_outbox_event(UUID, TEXT, TEXT)
  TO record_outbox_publisher;
GRANT EXECUTE ON FUNCTION listings.release_outbox_lease(UUID, TEXT)
  TO record_outbox_publisher;
GRANT EXECUTE ON FUNCTION listings._outbox_log_action(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, INTEGER, BIGINT)
  TO record_outbox_publisher;

-- shopping-service integration uses the postgres role locally; grant membership so
-- SET ROLE / INHERIT paths work, and also grant execute to postgres for deploy smoke.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    GRANT record_outbox_publisher TO postgres;
  END IF;
  -- Do NOT grant publisher mutation functions to broad record_readwrite.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readwrite') THEN
    REVOKE EXECUTE ON FUNCTION listings.lease_outbox_batch(INTEGER, TEXT, INTEGER, TEXT) FROM record_readwrite;
    REVOKE EXECUTE ON FUNCTION listings.acknowledge_outbox_publish(UUID, TEXT, TEXT, INTEGER, BIGINT) FROM record_readwrite;
    REVOKE EXECUTE ON FUNCTION listings.reschedule_outbox_event(UUID, TEXT, TEXT, TIMESTAMPTZ) FROM record_readwrite;
    REVOKE EXECUTE ON FUNCTION listings.dead_letter_outbox_event(UUID, TEXT, TEXT) FROM record_readwrite;
    REVOKE EXECUTE ON FUNCTION listings.release_outbox_lease(UUID, TEXT) FROM record_readwrite;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- B5. Eligibility supersession edges (append-only; never update prior decisions)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intelligence.eligibility_supersession_edges (
  supersession_edge_id   TEXT PRIMARY KEY,
  previous_decision_id   TEXT NOT NULL,
  new_decision_id        TEXT NOT NULL,
  reason                 TEXT NOT NULL,
  request_id             TEXT,
  session_id             TEXT,
  turn_id                TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (previous_decision_id, new_decision_id)
);

CREATE INDEX IF NOT EXISTS idx_eligibility_supersession_previous
  ON intelligence.eligibility_supersession_edges (previous_decision_id);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readwrite') THEN
    GRANT SELECT, INSERT ON intelligence.eligibility_supersession_edges TO record_readwrite;
    REVOKE UPDATE, DELETE ON intelligence.eligibility_supersession_edges FROM record_readwrite;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readonly') THEN
    GRANT SELECT ON intelligence.eligibility_supersession_edges TO record_readonly;
  END IF;
END $$;

DO $$
DECLARE
  t TEXT := 'eligibility_supersession_edges';
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

-- Drop writable superseded_by column usage expectation: keep column but comment it unused.
COMMENT ON COLUMN intelligence.eligibility_decisions.superseded_by_decision_id IS
  'DEPRECATED unused under append-only policy. Use intelligence.eligibility_supersession_edges instead.';

-- ---------------------------------------------------------------------------
-- B6. Claim ↔ calculation integrity helper (application also enforces fail-closed)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION intelligence.assert_claim_calculation_integrity(
  p_claim_calculation_id TEXT,
  p_snapshot_id TEXT,
  p_expected_snapshot_id TEXT,
  p_normalized_value JSONB,
  p_stored_value JSONB
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_claim_calculation_id IS NULL OR length(trim(p_claim_calculation_id)) = 0 THEN
    RAISE EXCEPTION 'CLAIM_CALCULATION_ID_REQUIRED'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM intelligence.deterministic_calculations c
    WHERE c.calculation_id = p_claim_calculation_id
  ) THEN
    RAISE EXCEPTION 'CLAIM_CALCULATION_MISSING: %', p_claim_calculation_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF p_snapshot_id IS DISTINCT FROM p_expected_snapshot_id THEN
    RAISE EXCEPTION 'CLAIM_SNAPSHOT_MISMATCH'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF p_normalized_value IS DISTINCT FROM p_stored_value THEN
    RAISE EXCEPTION 'CLAIM_VALUE_MISMATCH'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION intelligence.assert_claim_calculation_integrity(TEXT, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readwrite') THEN
    GRANT EXECUTE ON FUNCTION intelligence.assert_claim_calculation_integrity(TEXT, TEXT, TEXT, JSONB, JSONB)
      TO record_readwrite;
  END IF;
END $$;
