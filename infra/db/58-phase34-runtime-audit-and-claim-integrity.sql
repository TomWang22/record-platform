-- Phase 34 runtime: durable denial audit, publisher cannot forge ledger,
-- LEASE recording, append-only action ledger, reject LEGACY_UNKNOWN on insert,
-- supersession FKs + chain checks, database-derived claim verification,
-- unique acknowledged broker coordinates.
-- Isolated integration listings DB (port 5435). Not production.
--
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 5435 -U postgres -d listings \
--     -v ON_ERROR_STOP=1 -f infra/db/58-phase34-runtime-audit-and-claim-integrity.sql

SET ROLE postgres;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Trusted function-owner role (non-login). Owns SECURITY DEFINER publishers.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_outbox_function_owner') THEN
    CREATE ROLE record_outbox_function_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_outbox_publisher') THEN
    CREATE ROLE record_outbox_publisher NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA listings TO record_outbox_function_owner;
GRANT USAGE ON SCHEMA intelligence TO record_outbox_function_owner;
GRANT SELECT, UPDATE ON listings.outbox_events TO record_outbox_function_owner;
GRANT SELECT, INSERT ON listings.outbox_publisher_action_ledger TO record_outbox_function_owner;
GRANT SELECT ON intelligence.claim_ledger_entries TO record_outbox_function_owner;
GRANT SELECT ON intelligence.claim_ledgers TO record_outbox_function_owner;
GRANT SELECT ON intelligence.response_envelopes TO record_outbox_function_owner;
GRANT SELECT ON intelligence.deterministic_calculations TO record_outbox_function_owner;
GRANT SELECT ON intelligence.evidence_snapshots TO record_outbox_function_owner;
GRANT SELECT ON intelligence.evidence_snapshot_items TO record_outbox_function_owner;
GRANT SELECT ON intelligence.evidence_snapshot_exclusions TO record_outbox_function_owner;
GRANT SELECT ON intelligence.eligibility_decisions TO record_outbox_function_owner;
GRANT SELECT ON intelligence.market_events TO record_outbox_function_owner;

-- ---------------------------------------------------------------------------
-- 2.4 Action ledger: FK, append-only, tighter CHECKs, revoke forge grants
-- ---------------------------------------------------------------------------
ALTER TABLE listings.outbox_publisher_action_ledger
  ADD COLUMN IF NOT EXISTS leased_until TIMESTAMPTZ;

ALTER TABLE listings.outbox_publisher_action_ledger
  DROP CONSTRAINT IF EXISTS outbox_publisher_action_ledger_action_check;

ALTER TABLE listings.outbox_publisher_action_ledger
  DROP CONSTRAINT IF EXISTS outbox_publisher_action_ledger_result_check;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'outbox_publisher_action_ledger_outbox_event_id_fkey'
  ) THEN
    ALTER TABLE listings.outbox_publisher_action_ledger
      ADD CONSTRAINT outbox_publisher_action_ledger_outbox_event_id_fkey
      FOREIGN KEY (outbox_event_id) REFERENCES listings.outbox_events(id);
  END IF;
END $$;

ALTER TABLE listings.outbox_publisher_action_ledger
  ADD CONSTRAINT outbox_publisher_action_ledger_action_check CHECK (action = ANY (ARRAY[
    'LEASE', 'ACKNOWLEDGE', 'RESCHEDULE', 'DEAD_LETTER', 'RELEASE',
    'ACKNOWLEDGE_DENIED', 'RESCHEDULE_DENIED', 'DEAD_LETTER_DENIED', 'RELEASE_DENIED'
  ]));

ALTER TABLE listings.outbox_publisher_action_ledger
  ADD CONSTRAINT outbox_publisher_action_ledger_result_check
  CHECK (result = ANY (ARRAY['OK', 'DENIED', 'NOOP', 'ERROR']));

ALTER TABLE listings.outbox_publisher_action_ledger
  DROP CONSTRAINT IF EXISTS outbox_ack_coords_required;
ALTER TABLE listings.outbox_publisher_action_ledger
  ADD CONSTRAINT outbox_ack_coords_required CHECK (
    action <> 'ACKNOWLEDGE'
    OR (
      broker_topic IS NOT NULL
      AND broker_partition IS NOT NULL
      AND broker_offset IS NOT NULL
      AND result = 'OK'
    )
  );

ALTER TABLE listings.outbox_publisher_action_ledger
  DROP CONSTRAINT IF EXISTS outbox_denied_ack_no_success_coords;
ALTER TABLE listings.outbox_publisher_action_ledger
  ADD CONSTRAINT outbox_denied_ack_no_success_coords CHECK (
    action <> 'ACKNOWLEDGE_DENIED'
    OR (
      broker_topic IS NULL
      AND broker_partition IS NULL
      AND broker_offset IS NULL
      AND result = 'DENIED'
    )
  );

DO $$
DECLARE
  t TEXT := 'outbox_publisher_action_ledger';
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_deny_update ON listings.%I', t, t);
  EXECUTE format(
    'CREATE TRIGGER trg_%s_deny_update BEFORE UPDATE ON listings.%I
     FOR EACH ROW EXECUTE FUNCTION intelligence.deny_append_only_mutation()',
    t, t
  );
  EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_deny_delete ON listings.%I', t, t);
  EXECUTE format(
    'CREATE TRIGGER trg_%s_deny_delete BEFORE DELETE ON listings.%I
     FOR EACH ROW EXECUTE FUNCTION intelligence.deny_append_only_mutation()',
    t, t
  );
END $$;

REVOKE ALL ON TABLE listings.outbox_publisher_action_ledger FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON listings.outbox_publisher_action_ledger FROM record_outbox_publisher;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readwrite') THEN
    REVOKE INSERT, UPDATE, DELETE ON listings.outbox_publisher_action_ledger FROM record_readwrite;
    GRANT SELECT ON listings.outbox_publisher_action_ledger TO record_readwrite;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readonly') THEN
    GRANT SELECT ON listings.outbox_publisher_action_ledger TO record_readonly;
  END IF;
END $$;
GRANT SELECT ON listings.outbox_publisher_action_ledger TO record_outbox_publisher;

-- ---------------------------------------------------------------------------
-- 2.5 Reject LEGACY_UNKNOWN (+ synonyms) on NEW inserts; mark legacy rows
-- ---------------------------------------------------------------------------
ALTER TABLE listings.outbox_events
  ADD COLUMN IF NOT EXISTS is_legacy_source_sha BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE listings.outbox_events DISABLE TRIGGER trg_outbox_forbid_immutable_column_change;
UPDATE listings.outbox_events
SET is_legacy_source_sha = TRUE
WHERE type = 'SaleCompleted'
  AND (
    lower(COALESCE(source_sha, '')) IN (
      'legacy_unknown', 'unknown', 'unknown-pre-migration-56',
      'legacy', 'unavailable', 'unset', 'test', 'fixture'
    )
    OR source_sha IS NULL
    OR length(trim(source_sha)) = 0
  );
ALTER TABLE listings.outbox_events ENABLE TRIGGER trg_outbox_forbid_immutable_column_change;

CREATE OR REPLACE FUNCTION listings.outbox_sale_completed_source_sha_gate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = listings, pg_temp
AS $$
DECLARE
  sha_l TEXT;
BEGIN
  IF NEW.type = 'SaleCompleted' THEN
    sha_l := lower(trim(COALESCE(NEW.source_sha, '')));
    IF NEW.source_sha IS NULL
       OR length(trim(NEW.source_sha)) = 0
       OR sha_l IN (
         'unknown',
         'unknown-pre-migration-56',
         'legacy_unknown',
         'legacy',
         'unavailable',
         'unset',
         'test',
         'fixture'
       )
    THEN
      RAISE EXCEPTION 'OUTBOX_SOURCE_SHA_INVALID: SaleCompleted requires concrete repository source_sha'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.source_sha !~ '^[0-9a-fA-F]{40}$' THEN
      RAISE EXCEPTION 'OUTBOX_SOURCE_SHA_INVALID: SaleCompleted source_sha must be 40-char hex Git SHA'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.is_legacy_source_sha := FALSE;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_outbox_sale_completed_source_sha_gate ON listings.outbox_events;
CREATE TRIGGER trg_outbox_sale_completed_source_sha_gate
  BEFORE INSERT ON listings.outbox_events
  FOR EACH ROW EXECUTE FUNCTION listings.outbox_sale_completed_source_sha_gate();

-- ---------------------------------------------------------------------------
-- 2.8 Unique acknowledged broker coordinates
-- ---------------------------------------------------------------------------
-- Prior smoke tests may have reused the same synthetic broker coordinate.
-- Keep the earliest published row; clear duplicates so the unique index can apply.
ALTER TABLE listings.outbox_events DISABLE TRIGGER trg_outbox_forbid_immutable_column_change;
WITH dups AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY broker_topic, broker_partition, broker_offset
           ORDER BY published_at NULLS LAST, created_at ASC, id ASC
         ) AS rn
  FROM listings.outbox_events
  WHERE published = true
    AND broker_topic IS NOT NULL
    AND broker_partition IS NOT NULL
    AND broker_offset IS NOT NULL
)
UPDATE listings.outbox_events o
SET broker_topic = NULL,
    broker_partition = NULL,
    broker_offset = NULL,
    last_error = left(COALESCE(last_error, '') || '|broker_coord_deduped_migration_58', 4000)
FROM dups
WHERE o.id = dups.id
  AND dups.rn > 1;
ALTER TABLE listings.outbox_events ENABLE TRIGGER trg_outbox_forbid_immutable_column_change;

CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_ack_broker_coords
  ON listings.outbox_events (broker_topic, broker_partition, broker_offset)
  WHERE published = true
    AND broker_topic IS NOT NULL
    AND broker_partition IS NOT NULL
    AND broker_offset IS NOT NULL;

COMMENT ON INDEX listings.uq_outbox_ack_broker_coords IS
  'Two distinct outbox events cannot claim the same acknowledged Kafka coordinate. '
  'Local integration: producer send then acknowledge_outbox_publish after broker ack '
  'metadata is known; idempotent producer keys are settlement/source-event identity.';

-- ---------------------------------------------------------------------------
-- Drop prior publisher function signatures (migration 56/57 INTEGER returns)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS listings._outbox_log_action(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, INTEGER, BIGINT);
DROP FUNCTION IF EXISTS listings._outbox_log_action(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, INTEGER, BIGINT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS listings.acknowledge_outbox_publish(UUID, TEXT, TEXT, INTEGER, BIGINT);
DROP FUNCTION IF EXISTS listings.reschedule_outbox_event(UUID, TEXT, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS listings.dead_letter_outbox_event(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS listings.release_outbox_lease(UUID, TEXT);
DROP FUNCTION IF EXISTS listings.lease_outbox_batch(INTEGER, TEXT, INTEGER, TEXT);

-- ---------------------------------------------------------------------------
-- Internal audit helper — owner-only; no PUBLIC / publisher EXECUTE
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION listings._outbox_log_action(
  p_event_id UUID,
  p_action TEXT,
  p_owner TEXT,
  p_result TEXT,
  p_error_class TEXT DEFAULT NULL,
  p_retry INTEGER DEFAULT NULL,
  p_topic TEXT DEFAULT NULL,
  p_partition INTEGER DEFAULT NULL,
  p_offset BIGINT DEFAULT NULL,
  p_leased_until TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = listings, pg_temp
AS $$
BEGIN
  INSERT INTO listings.outbox_publisher_action_ledger (
    action_id, outbox_event_id, action, lease_owner, retry_count,
    broker_topic, broker_partition, broker_offset, result, error_class, leased_until
  ) VALUES (
    'act-' || replace(pg_catalog.gen_random_uuid()::text, '-', ''),
    p_event_id, p_action, p_owner, p_retry,
    p_topic, p_partition, p_offset, p_result, p_error_class, p_leased_until
  );
END;
$$;

ALTER FUNCTION listings._outbox_log_action(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, INTEGER, BIGINT, TIMESTAMPTZ)
  OWNER TO record_outbox_function_owner;

REVOKE ALL ON FUNCTION listings._outbox_log_action(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, INTEGER, BIGINT, TIMESTAMPTZ)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION listings._outbox_log_action(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, INTEGER, BIGINT, TIMESTAMPTZ)
  FROM record_outbox_publisher;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readwrite') THEN
    REVOKE ALL ON FUNCTION listings._outbox_log_action(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, INTEGER, BIGINT, TIMESTAMPTZ)
      FROM record_readwrite;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Publisher ops: structured JSONB result; DENIED commits with ledger (no raise)
-- ---------------------------------------------------------------------------
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
DECLARE
  r listings.outbox_events%ROWTYPE;
BEGIN
  IF p_owner IS NULL OR length(trim(p_owner)) = 0 THEN
    RAISE EXCEPTION 'OUTBOX_LEASE_OWNER_REQUIRED'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR r IN
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
    SELECT * FROM updated
  LOOP
    PERFORM listings._outbox_log_action(
      r.id, 'LEASE', p_owner, 'OK', NULL, r.retry_count,
      NULL, NULL, NULL, r.leased_until
    );
    RETURN NEXT r;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION listings.acknowledge_outbox_publish(
  p_id UUID,
  p_owner TEXT,
  p_topic TEXT,
  p_partition INTEGER,
  p_offset BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = listings, pg_temp
AS $$
DECLARE
  n INTEGER := 0;
BEGIN
  IF p_owner IS NULL OR length(trim(p_owner)) = 0 THEN
    RETURN jsonb_build_object(
      'affected_rows', 0, 'result', 'DENIED', 'error_class', 'OUTBOX_LEASE_OWNER_REQUIRED'
    );
  END IF;
  IF p_topic IS NULL OR p_partition IS NULL OR p_offset IS NULL THEN
    RETURN jsonb_build_object(
      'affected_rows', 0, 'result', 'DENIED', 'error_class', 'OUTBOX_BROKER_ACK_INCOMPLETE'
    );
  END IF;

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
      AND published = false
      AND COALESCE(dead_lettered, false) = false
      AND lease_owner = p_owner
      AND leased_until IS NOT NULL
      AND leased_until >= NOW();
  EXCEPTION
    WHEN unique_violation THEN
      PERFORM listings._outbox_log_action(
        p_id, 'ACKNOWLEDGE_DENIED', p_owner, 'DENIED', 'BROKER_COORD_CONFLICT',
        NULL, NULL, NULL, NULL, NULL
      );
      RETURN jsonb_build_object(
        'affected_rows', 0, 'result', 'DENIED', 'error_class', 'BROKER_COORD_CONFLICT'
      );
  END;

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    PERFORM listings._outbox_log_action(
      p_id, 'ACKNOWLEDGE_DENIED', p_owner, 'DENIED', 'WRONG_OR_EXPIRED_LEASE',
      NULL, NULL, NULL, NULL, NULL
    );
    RETURN jsonb_build_object(
      'affected_rows', 0, 'result', 'DENIED', 'error_class', 'WRONG_OR_EXPIRED_LEASE'
    );
  END IF;

  PERFORM listings._outbox_log_action(
    p_id, 'ACKNOWLEDGE', p_owner, 'OK', NULL, NULL, p_topic, p_partition, p_offset, NULL
  );
  RETURN jsonb_build_object('affected_rows', n, 'result', 'OK', 'error_class', NULL);
END;
$$;

CREATE OR REPLACE FUNCTION listings.reschedule_outbox_event(
  p_id UUID,
  p_owner TEXT,
  p_error TEXT,
  p_next_attempt_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = listings, pg_temp
AS $$
DECLARE
  n INTEGER := 0;
  rc INTEGER;
BEGIN
  IF p_owner IS NULL OR length(trim(p_owner)) = 0 THEN
    RETURN jsonb_build_object(
      'affected_rows', 0, 'result', 'DENIED', 'error_class', 'OUTBOX_LEASE_OWNER_REQUIRED'
    );
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
    RETURN jsonb_build_object(
      'affected_rows', 0, 'result', 'DENIED', 'error_class', 'WRONG_OR_EXPIRED_LEASE'
    );
  END IF;

  PERFORM listings._outbox_log_action(
    p_id, 'RESCHEDULE', p_owner, 'OK', NULL, rc
  );
  RETURN jsonb_build_object('affected_rows', n, 'result', 'OK', 'error_class', NULL);
END;
$$;

CREATE OR REPLACE FUNCTION listings.dead_letter_outbox_event(
  p_id UUID,
  p_owner TEXT,
  p_error TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = listings, pg_temp
AS $$
DECLARE
  n INTEGER := 0;
BEGIN
  IF p_owner IS NULL OR length(trim(p_owner)) = 0 THEN
    RETURN jsonb_build_object(
      'affected_rows', 0, 'result', 'DENIED', 'error_class', 'OUTBOX_LEASE_OWNER_REQUIRED'
    );
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
    RETURN jsonb_build_object(
      'affected_rows', 0, 'result', 'DENIED', 'error_class', 'WRONG_OR_EXPIRED_LEASE'
    );
  END IF;

  PERFORM listings._outbox_log_action(
    p_id, 'DEAD_LETTER', p_owner, 'OK', left(COALESCE(p_error, 'dead_letter'), 200)
  );
  RETURN jsonb_build_object('affected_rows', n, 'result', 'OK', 'error_class', NULL);
END;
$$;

CREATE OR REPLACE FUNCTION listings.release_outbox_lease(
  p_id UUID,
  p_owner TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = listings, pg_temp
AS $$
DECLARE
  n INTEGER := 0;
BEGIN
  IF p_owner IS NULL OR length(trim(p_owner)) = 0 THEN
    RETURN jsonb_build_object(
      'affected_rows', 0, 'result', 'DENIED', 'error_class', 'OUTBOX_LEASE_OWNER_REQUIRED'
    );
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
    RETURN jsonb_build_object(
      'affected_rows', 0, 'result', 'DENIED', 'error_class', 'WRONG_OR_EXPIRED_LEASE'
    );
  END IF;

  PERFORM listings._outbox_log_action(p_id, 'RELEASE', p_owner, 'OK');
  RETURN jsonb_build_object('affected_rows', n, 'result', 'OK', 'error_class', NULL);
END;
$$;

ALTER FUNCTION listings.lease_outbox_batch(INTEGER, TEXT, INTEGER, TEXT)
  OWNER TO record_outbox_function_owner;
ALTER FUNCTION listings.acknowledge_outbox_publish(UUID, TEXT, TEXT, INTEGER, BIGINT)
  OWNER TO record_outbox_function_owner;
ALTER FUNCTION listings.reschedule_outbox_event(UUID, TEXT, TEXT, TIMESTAMPTZ)
  OWNER TO record_outbox_function_owner;
ALTER FUNCTION listings.dead_letter_outbox_event(UUID, TEXT, TEXT)
  OWNER TO record_outbox_function_owner;
ALTER FUNCTION listings.release_outbox_lease(UUID, TEXT)
  OWNER TO record_outbox_function_owner;

REVOKE ALL ON FUNCTION listings.lease_outbox_batch(INTEGER, TEXT, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION listings.acknowledge_outbox_publish(UUID, TEXT, TEXT, INTEGER, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION listings.reschedule_outbox_event(UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION listings.dead_letter_outbox_event(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION listings.release_outbox_lease(UUID, TEXT) FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readwrite') THEN
    REVOKE ALL ON FUNCTION listings.lease_outbox_batch(INTEGER, TEXT, INTEGER, TEXT) FROM record_readwrite;
    REVOKE ALL ON FUNCTION listings.acknowledge_outbox_publish(UUID, TEXT, TEXT, INTEGER, BIGINT) FROM record_readwrite;
    REVOKE ALL ON FUNCTION listings.reschedule_outbox_event(UUID, TEXT, TEXT, TIMESTAMPTZ) FROM record_readwrite;
    REVOKE ALL ON FUNCTION listings.dead_letter_outbox_event(UUID, TEXT, TEXT) FROM record_readwrite;
    REVOKE ALL ON FUNCTION listings.release_outbox_lease(UUID, TEXT) FROM record_readwrite;
  END IF;
END $$;

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

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    GRANT record_outbox_publisher TO postgres;
    GRANT record_outbox_function_owner TO postgres;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2.6 Supersession edges: FKs + validation trigger
-- ---------------------------------------------------------------------------
-- Drop orphan edges from pre-FK harness inserts so referential integrity can apply.
ALTER TABLE intelligence.eligibility_supersession_edges
  DISABLE TRIGGER trg_eligibility_supersession_edges_deny_delete;
DELETE FROM intelligence.eligibility_supersession_edges e
WHERE NOT EXISTS (
  SELECT 1 FROM intelligence.eligibility_decisions d
  WHERE d.eligibility_decision_id = e.previous_decision_id
)
OR NOT EXISTS (
  SELECT 1 FROM intelligence.eligibility_decisions d
  WHERE d.eligibility_decision_id = e.new_decision_id
);
ALTER TABLE intelligence.eligibility_supersession_edges
  ENABLE TRIGGER trg_eligibility_supersession_edges_deny_delete;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'eligibility_supersession_previous_fkey'
  ) THEN
    ALTER TABLE intelligence.eligibility_supersession_edges
      ADD CONSTRAINT eligibility_supersession_previous_fkey
      FOREIGN KEY (previous_decision_id)
      REFERENCES intelligence.eligibility_decisions(eligibility_decision_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'eligibility_supersession_new_fkey'
  ) THEN
    ALTER TABLE intelligence.eligibility_supersession_edges
      ADD CONSTRAINT eligibility_supersession_new_fkey
      FOREIGN KEY (new_decision_id)
      REFERENCES intelligence.eligibility_decisions(eligibility_decision_id);
  END IF;
END $$;

ALTER TABLE intelligence.eligibility_supersession_edges
  DROP CONSTRAINT IF EXISTS eligibility_supersession_not_self;
ALTER TABLE intelligence.eligibility_supersession_edges
  ADD CONSTRAINT eligibility_supersession_not_self
  CHECK (previous_decision_id <> new_decision_id);

CREATE OR REPLACE FUNCTION intelligence.eligibility_supersession_validate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = intelligence, pg_temp
AS $$
DECLARE
  prev_cap TEXT;
  new_cap TEXT;
  prev_subj JSONB;
  new_subj JSONB;
  prev_at TIMESTAMPTZ;
  new_at TIMESTAMPTZ;
  prev_superseded TEXT;
  new_superseded TEXT;
  cycle_hit BOOLEAN;
BEGIN
  SELECT capability, subject, decided_at, superseded_by_decision_id
    INTO prev_cap, prev_subj, prev_at, prev_superseded
  FROM intelligence.eligibility_decisions
  WHERE eligibility_decision_id = NEW.previous_decision_id;

  SELECT capability, subject, decided_at, superseded_by_decision_id
    INTO new_cap, new_subj, new_at, new_superseded
  FROM intelligence.eligibility_decisions
  WHERE eligibility_decision_id = NEW.new_decision_id;

  IF prev_cap IS NULL OR new_cap IS NULL THEN
    RAISE EXCEPTION 'SUPERSESSION_DECISION_MISSING'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF prev_cap IS DISTINCT FROM new_cap THEN
    RAISE EXCEPTION 'SUPERSESSION_CAPABILITY_MISMATCH'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF prev_subj IS DISTINCT FROM new_subj THEN
    IF NOT EXISTS (
      SELECT 1 FROM intelligence.eligibility_decisions d
      WHERE d.eligibility_decision_id = NEW.new_decision_id
        AND d.previous_decision_id = NEW.previous_decision_id
    ) THEN
      RAISE EXCEPTION 'SUPERSESSION_SUBJECT_MISMATCH'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;

  IF new_at <= prev_at THEN
    RAISE EXCEPTION 'SUPERSESSION_TEMPORAL_ORDER'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  WITH RECURSIVE walk AS (
    SELECT e.previous_decision_id AS id, 1 AS depth
    FROM intelligence.eligibility_supersession_edges e
    WHERE e.new_decision_id = NEW.previous_decision_id
    UNION ALL
    SELECT e.previous_decision_id, walk.depth + 1
    FROM intelligence.eligibility_supersession_edges e
    JOIN walk ON e.new_decision_id = walk.id
    WHERE walk.depth < 64
  )
  SELECT EXISTS (SELECT 1 FROM walk WHERE id = NEW.new_decision_id) INTO cycle_hit;

  IF cycle_hit THEN
    RAISE EXCEPTION 'SUPERSESSION_CYCLE'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF prev_superseded IS NOT NULL OR new_superseded IS NOT NULL THEN
    RAISE EXCEPTION 'SUPERSESSION_DEPRECATED_FIELD_SET'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_eligibility_supersession_validate
  ON intelligence.eligibility_supersession_edges;
CREATE TRIGGER trg_eligibility_supersession_validate
  BEFORE INSERT ON intelligence.eligibility_supersession_edges
  FOR EACH ROW EXECUTE FUNCTION intelligence.eligibility_supersession_validate();

-- ---------------------------------------------------------------------------
-- 2.7 Database-derived claim integrity verification (no caller-trusted expected)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intelligence.claim_integrity_verifications (
  verification_id      TEXT PRIMARY KEY,
  response_id          TEXT NOT NULL,
  claim_id             TEXT NOT NULL,
  calculation_id       TEXT,
  verifier_version     TEXT NOT NULL DEFAULT 'phase34-claim-integrity-v2',
  verified_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result               TEXT NOT NULL CHECK (result IN ('PASS', 'FAIL')),
  failure_codes        JSONB NOT NULL DEFAULT '[]'::jsonb,
  details              JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_claim_integrity_verifications_claim
  ON intelligence.claim_integrity_verifications (claim_id, verified_at DESC);

DO $$
DECLARE
  t TEXT := 'claim_integrity_verifications';
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_deny_update ON intelligence.%I', t, t);
  EXECUTE format(
    'CREATE TRIGGER trg_%s_deny_update BEFORE UPDATE ON intelligence.%I
     FOR EACH ROW EXECUTE FUNCTION intelligence.deny_append_only_mutation()',
    t, t
  );
  EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_deny_delete ON intelligence.%I', t, t);
  EXECUTE format(
    'CREATE TRIGGER trg_%s_deny_delete BEFORE DELETE ON intelligence.%I
     FOR EACH ROW EXECUTE FUNCTION intelligence.deny_append_only_mutation()',
    t, t
  );
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readwrite') THEN
    GRANT SELECT, INSERT ON intelligence.claim_integrity_verifications TO record_readwrite;
    REVOKE UPDATE, DELETE ON intelligence.claim_integrity_verifications FROM record_readwrite;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readonly') THEN
    GRANT SELECT ON intelligence.claim_integrity_verifications TO record_readonly;
  END IF;
END $$;

GRANT SELECT, INSERT ON intelligence.claim_integrity_verifications TO record_outbox_function_owner;

DROP FUNCTION IF EXISTS intelligence.assert_claim_calculation_integrity(TEXT, TEXT, TEXT, JSONB, JSONB);

CREATE OR REPLACE FUNCTION intelligence.verify_claim_integrity_from_db(
  p_response_id TEXT,
  p_claim_id TEXT,
  p_calculation_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = intelligence, pg_temp
AS $$
DECLARE
  v_claim RECORD;
  v_ledger RECORD;
  v_resp RECORD;
  v_calc RECORD;
  v_snap RECORD;
  v_me RECORD;
  has_claim BOOLEAN := FALSE;
  has_ledger BOOLEAN := FALSE;
  has_resp BOOLEAN := FALSE;
  has_calc BOOLEAN := FALSE;
  has_snap BOOLEAN := FALSE;
  failures TEXT[] := ARRAY[]::TEXT[];
  supporting TEXT;
  sid TEXT;
  included BOOLEAN;
  excluded BOOLEAN;
  claim_val JSONB;
  calc_derived JSONB;
  verification_id TEXT;
  result_txt TEXT;
  details_json JSONB := '{}'::jsonb;
BEGIN
  SELECT * INTO v_claim FROM intelligence.claim_ledger_entries WHERE claim_id = p_claim_id;
  has_claim := FOUND;
  IF NOT has_claim THEN
    failures := array_append(failures, 'CLAIM_MISSING');
  END IF;

  SELECT * INTO v_resp FROM intelligence.response_envelopes WHERE response_id = p_response_id;
  has_resp := FOUND;
  IF NOT has_resp THEN
    failures := array_append(failures, 'RESPONSE_MISSING');
  END IF;

  IF has_claim THEN
    SELECT * INTO v_ledger FROM intelligence.claim_ledgers WHERE claim_ledger_id = v_claim.claim_ledger_id;
    has_ledger := FOUND;
    IF NOT has_ledger THEN
      failures := array_append(failures, 'CLAIM_LEDGER_MISSING');
    END IF;
    IF v_claim.response_id IS DISTINCT FROM p_response_id THEN
      failures := array_append(failures, 'CLAIM_RESPONSE_MISMATCH');
    END IF;
  END IF;

  IF has_resp AND has_ledger THEN
    IF v_resp.evidence_snapshot_id IS DISTINCT FROM v_ledger.evidence_snapshot_id THEN
      failures := array_append(failures, 'LEDGER_SNAPSHOT_NE_RESPONSE');
    END IF;
    IF v_resp.claim_ledger_id IS DISTINCT FROM v_ledger.claim_ledger_id THEN
      failures := array_append(failures, 'RESPONSE_LEDGER_MISMATCH');
    END IF;
  END IF;

  IF has_claim
     AND COALESCE(p_calculation_id, v_claim.deterministic_calculation_id) IS NULL
     AND v_claim.verification_result IN ('SUPPORTED', 'PARTIALLY_SUPPORTED')
  THEN
    failures := array_append(failures, 'MATERIAL_CLAIM_MISSING_CALCULATION');
  END IF;

  IF COALESCE(p_calculation_id, CASE WHEN has_claim THEN v_claim.deterministic_calculation_id END) IS NOT NULL THEN
    SELECT * INTO v_calc
    FROM intelligence.deterministic_calculations
    WHERE calculation_id = COALESCE(
      p_calculation_id,
      CASE WHEN has_claim THEN v_claim.deterministic_calculation_id END
    );
    has_calc := FOUND;
    IF NOT has_calc THEN
      failures := array_append(failures, 'CALCULATION_MISSING');
    ELSIF has_claim
      AND v_claim.deterministic_calculation_id IS NOT NULL
      AND v_claim.deterministic_calculation_id IS DISTINCT FROM v_calc.calculation_id THEN
      failures := array_append(failures, 'CLAIM_CALCULATION_ID_MISMATCH');
    END IF;
  END IF;

  IF has_resp THEN
    SELECT * INTO v_snap FROM intelligence.evidence_snapshots
    WHERE evidence_snapshot_id = v_resp.evidence_snapshot_id;
    has_snap := FOUND;
    IF NOT has_snap THEN
      failures := array_append(failures, 'SNAPSHOT_MISSING');
    END IF;
  END IF;

  IF has_calc AND has_snap THEN
    IF v_calc.evidence_snapshot_id IS DISTINCT FROM v_snap.evidence_snapshot_id THEN
      failures := array_append(failures, 'CALCULATION_SNAPSHOT_NE_RESPONSE');
    END IF;
  END IF;

  IF has_claim AND has_snap THEN
    FOR supporting IN
      SELECT jsonb_array_elements_text(
        COALESCE(v_claim.supporting_snapshot_item_ids, '[]'::jsonb)
      )
    LOOP
      sid := supporting;
      SELECT EXISTS (
        SELECT 1 FROM intelligence.evidence_snapshot_items i
        WHERE i.evidence_snapshot_id = v_snap.evidence_snapshot_id
          AND (i.evidence_id = sid OR i.market_event_id = sid)
          AND i.included = TRUE
      ) INTO included;
      IF NOT included THEN
        failures := array_append(failures, 'SUPPORTING_NOT_IN_SNAPSHOT:' || sid);
      END IF;

      SELECT EXISTS (
        SELECT 1 FROM intelligence.evidence_snapshot_exclusions e
        WHERE e.evidence_snapshot_id = v_snap.evidence_snapshot_id
          AND (e.evidence_id = sid OR e.market_event_id = sid)
      ) INTO excluded;
      IF excluded THEN
        failures := array_append(failures, 'EXCLUDED_SUPPORTS_CLAIM:' || sid);
      END IF;

      SELECT * INTO v_me
      FROM intelligence.market_events
      WHERE market_event_id = sid
      LIMIT 1;

      IF FOUND THEN
        IF upper(COALESCE(v_me.rights_status, '')) IN ('DENIED', 'REVOKED', 'BLOCKED', 'EXCLUDED_RIGHTS') THEN
          failures := array_append(failures, 'RIGHTS_INELIGIBLE:' || sid);
        END IF;
        IF upper(COALESCE(v_me.deletion_status, 'ACTIVE')) IN ('DELETED', 'FORGOTTEN', 'TOMBSTONED') THEN
          failures := array_append(failures, 'DELETED_EVIDENCE:' || sid);
        END IF;
        IF v_claim.claim_type IN ('sold_count', 'median_sold_price', 'sold_price', 'fair_market_range')
           AND (
             upper(v_me.event_type) LIKE '%ASK%'
             OR upper(v_me.event_type) IN ('LISTING_CREATED', 'ASKING_PRICE', 'OFFER_CREATED')
           ) THEN
          failures := array_append(failures, 'ASKING_SUPPORTS_SOLD_CLAIM:' || sid);
        END IF;
        IF v_claim.claim_type IN ('exact_pressing_match', 'pressing_identity')
           OR v_claim.claim_type LIKE '%exact_pressing%' THEN
          IF v_me.pressing_id IS NULL THEN
            failures := array_append(failures, 'RELEASE_ONLY_SUPPORTS_EXACT_PRESSING:' || sid);
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;

  IF has_calc AND has_claim THEN
    claim_val := v_claim.normalized_claim_value;
    IF v_claim.claim_type = 'currency' THEN
      IF claim_val IS DISTINCT FROM to_jsonb(v_calc.currency)
         AND claim_val #>> '{}' IS DISTINCT FROM v_calc.currency THEN
        failures := array_append(failures, 'CURRENCY_MISMATCH');
      END IF;
    ELSIF v_claim.claim_type = 'sold_count' THEN
      calc_derived := COALESCE(
        v_calc.payload->'sold_count',
        to_jsonb(jsonb_array_length(v_calc.eligible_sale_prices))
      );
      IF claim_val IS DISTINCT FROM calc_derived
         AND (claim_val #>> '{}')::numeric IS DISTINCT FROM (calc_derived #>> '{}')::numeric THEN
        failures := array_append(failures, 'SOLD_COUNT_MISMATCH');
      END IF;
    ELSIF v_claim.claim_type IN ('median_sold_price', 'median') THEN
      IF v_calc.median IS NOT NULL
         AND (claim_val #>> '{}')::numeric IS DISTINCT FROM v_calc.median THEN
        failures := array_append(failures, 'MEDIAN_MISMATCH');
      END IF;
    ELSIF v_claim.claim_type IN ('quick_sale_range', 'fair_market_range', 'patient_sale_range') THEN
      calc_derived := CASE v_claim.claim_type
        WHEN 'quick_sale_range' THEN v_calc.quick_sale_range
        WHEN 'fair_market_range' THEN v_calc.fair_market_range
        ELSE v_calc.patient_sale_range
      END;
      IF calc_derived IS NOT NULL AND claim_val IS DISTINCT FROM calc_derived THEN
        failures := array_append(failures, 'RANGE_MISMATCH');
      END IF;
    END IF;

    IF v_calc.result_hash IS NULL OR length(v_calc.result_hash) = 0 THEN
      failures := array_append(failures, 'RESULT_HASH_MISSING');
    END IF;
    IF v_calc.payload ? 'canonical_result_hash'
       AND (v_calc.payload->>'canonical_result_hash') IS DISTINCT FROM v_calc.result_hash THEN
      failures := array_append(failures, 'RESULT_HASH_MISMATCH');
    END IF;
  END IF;

  result_txt := CASE WHEN coalesce(array_length(failures, 1), 0) = 0 THEN 'PASS' ELSE 'FAIL' END;
  verification_id := 'civ-' || replace(pg_catalog.gen_random_uuid()::text, '-', '');

  details_json := '{}'::jsonb;
  IF has_snap THEN
    details_json := details_json || jsonb_build_object('snapshot_id', v_snap.evidence_snapshot_id);
  END IF;
  IF has_calc THEN
    details_json := details_json || jsonb_build_object('calculation_id', v_calc.calculation_id);
  END IF;

  INSERT INTO intelligence.claim_integrity_verifications (
    verification_id, response_id, claim_id, calculation_id,
    verifier_version, result, failure_codes, details
  ) VALUES (
    verification_id,
    COALESCE(p_response_id, ''),
    COALESCE(p_claim_id, ''),
    COALESCE(
      p_calculation_id,
      CASE WHEN has_claim THEN v_claim.deterministic_calculation_id END
    ),
    'phase34-claim-integrity-v2',
    result_txt,
    to_jsonb(failures),
    details_json
  );

  RETURN jsonb_build_object(
    'verification_id', verification_id,
    'result', result_txt,
    'verifier_version', 'phase34-claim-integrity-v2',
    'verified_at', NOW(),
    'failure_codes', to_jsonb(failures)
  );
END;
$$;

ALTER FUNCTION intelligence.verify_claim_integrity_from_db(TEXT, TEXT, TEXT)
  OWNER TO record_outbox_function_owner;

REVOKE ALL ON FUNCTION intelligence.verify_claim_integrity_from_db(TEXT, TEXT, TEXT) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readwrite') THEN
    GRANT EXECUTE ON FUNCTION intelligence.verify_claim_integrity_from_db(TEXT, TEXT, TEXT)
      TO record_readwrite;
  END IF;
END $$;

COMMENT ON FUNCTION intelligence.verify_claim_integrity_from_db(TEXT, TEXT, TEXT) IS
  'Loads claim/ledger/response/calculation/snapshot from DB. Does not trust caller expected values. '
  'Callers must treat result=FAIL as hard failure.';
