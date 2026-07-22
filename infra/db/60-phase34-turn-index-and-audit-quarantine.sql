-- Phase 34 Migration 60: numeric turn_index for supersession + audit quarantine.
-- Isolated integration listings DB (port 5435). Not production.
--
-- Production-applicable rule: orphan audit rows are QUARANTINED (copied with
-- defect reason + payload hash) before any constrained-table removal.
-- Silent deletes without quarantine are forbidden in production migrations.
--
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 5435 -U postgres -d listings \
--     -v ON_ERROR_STOP=1 -f infra/db/60-phase34-turn-index-and-audit-quarantine.sql

SET ROLE postgres;

-- ---------------------------------------------------------------------------
-- A. Numeric turn ordering
-- ---------------------------------------------------------------------------
ALTER TABLE intelligence.eligibility_decisions
  ADD COLUMN IF NOT EXISTS turn_index INTEGER;

ALTER TABLE intelligence.eligibility_supersession_edges
  ADD COLUMN IF NOT EXISTS turn_index INTEGER;

COMMENT ON COLUMN intelligence.eligibility_decisions.turn_index IS
  'Authoritative same-session ordering. turn_id is identity only; never compare turn_id lexicographically for supersession.';
COMMENT ON COLUMN intelligence.eligibility_supersession_edges.turn_index IS
  'Optional edge-level turn_index; same-session validation uses decision.turn_index.';

-- Unique session + turn_index + market_event when present (multiple events per turn allowed).
DROP INDEX IF EXISTS intelligence.uq_eligibility_session_turn_index;
CREATE UNIQUE INDEX IF NOT EXISTS uq_eligibility_session_turn_index_event
  ON intelligence.eligibility_decisions (session_id, turn_index, market_event_id)
  WHERE session_id IS NOT NULL AND turn_index IS NOT NULL;

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
  prev_session TEXT;
  new_session TEXT;
  prev_turn TEXT;
  new_turn TEXT;
  prev_turn_index INTEGER;
  new_turn_index INTEGER;
  prev_request TEXT;
  new_request TEXT;
  cycle_hit BOOLEAN;
BEGIN
  IF NEW.reason IS NULL OR length(trim(NEW.reason)) = 0 THEN
    RAISE EXCEPTION 'SUPERSESSION_REASON_REQUIRED'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM intelligence.eligibility_supersession_reason_registry r
    WHERE r.reason_code = NEW.reason
  ) THEN
    RAISE EXCEPTION 'SUPERSESSION_REASON_NOT_REGISTERED: %', NEW.reason
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  SELECT capability, subject, decided_at, superseded_by_decision_id,
         session_id, turn_id, turn_index, request_id
    INTO prev_cap, prev_subj, prev_at, prev_superseded,
         prev_session, prev_turn, prev_turn_index, prev_request
  FROM intelligence.eligibility_decisions
  WHERE eligibility_decision_id = NEW.previous_decision_id;

  SELECT capability, subject, decided_at, superseded_by_decision_id,
         session_id, turn_id, turn_index, request_id
    INTO new_cap, new_subj, new_at, new_superseded,
         new_session, new_turn, new_turn_index, new_request
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

  -- Session lineage
  IF prev_session IS NOT NULL AND new_session IS NOT NULL THEN
    IF prev_session IS DISTINCT FROM new_session THEN
      IF NEW.reason IS DISTINCT FROM 'authorized_durable_memory_transition' THEN
        RAISE EXCEPTION 'SUPERSESSION_SESSION_MISMATCH'
          USING ERRCODE = 'integrity_constraint_violation';
      END IF;
    ELSE
      -- Same session: require numeric turn_index order. turn_id is identity only.
      IF prev_turn_index IS NULL OR new_turn_index IS NULL THEN
        RAISE EXCEPTION 'SUPERSESSION_TURN_INDEX_REQUIRED'
          USING ERRCODE = 'integrity_constraint_violation';
      END IF;
      IF new_turn_index <= prev_turn_index THEN
        RAISE EXCEPTION 'SUPERSESSION_TURN_INDEX_ORDER'
          USING ERRCODE = 'integrity_constraint_violation';
      END IF;
      -- Intentionally do NOT compare turn_id lexicographically.
    END IF;
  END IF;

  IF NEW.request_id IS NOT NULL AND new_request IS NOT NULL
     AND NEW.request_id IS DISTINCT FROM new_request THEN
    RAISE EXCEPTION 'SUPERSESSION_REQUEST_MISMATCH'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.session_id IS NOT NULL AND new_session IS NOT NULL
     AND NEW.session_id IS DISTINCT FROM new_session THEN
    RAISE EXCEPTION 'SUPERSESSION_SESSION_MISMATCH'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  -- Edge turn_id (identity) may match new decision turn_id when both set.
  IF NEW.turn_id IS NOT NULL AND new_turn IS NOT NULL
     AND NEW.turn_id IS DISTINCT FROM new_turn THEN
    RAISE EXCEPTION 'SUPERSESSION_TURN_MISMATCH'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.turn_index IS NOT NULL AND new_turn_index IS NOT NULL
     AND NEW.turn_index IS DISTINCT FROM new_turn_index THEN
    RAISE EXCEPTION 'SUPERSESSION_TURN_INDEX_MISMATCH'
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
-- B. Migration residue quarantine (production-applicable pattern)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intelligence.migration_audit_quarantine (
  quarantine_id        TEXT PRIMARY KEY,
  quarantined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  migration_id         TEXT NOT NULL,
  source_schema        TEXT NOT NULL,
  source_table         TEXT NOT NULL,
  source_pk            TEXT NOT NULL,
  defect_reason        TEXT NOT NULL,
  row_payload          JSONB NOT NULL,
  row_payload_hash     TEXT NOT NULL,
  notes                TEXT
);

CREATE INDEX IF NOT EXISTS idx_migration_audit_quarantine_table
  ON intelligence.migration_audit_quarantine (source_table, quarantined_at DESC);

DO $$
DECLARE t TEXT := 'migration_audit_quarantine';
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_deny_update ON intelligence.%I', t, t);
  EXECUTE format(
    'CREATE TRIGGER trg_%s_deny_update BEFORE UPDATE ON intelligence.%I
     FOR EACH ROW EXECUTE FUNCTION intelligence.deny_append_only_mutation()', t, t);
  EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_deny_delete ON intelligence.%I', t, t);
  EXECUTE format(
    'CREATE TRIGGER trg_%s_deny_delete BEFORE DELETE ON intelligence.%I
     FOR EACH ROW EXECUTE FUNCTION intelligence.deny_append_only_mutation()', t, t);
END $$;

REVOKE ALL ON TABLE intelligence.migration_audit_quarantine FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readwrite') THEN
    GRANT SELECT, INSERT ON intelligence.migration_audit_quarantine TO record_readwrite;
    REVOKE UPDATE, DELETE ON intelligence.migration_audit_quarantine FROM record_readwrite;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readonly') THEN
    GRANT SELECT ON intelligence.migration_audit_quarantine TO record_readonly;
  END IF;
END $$;

-- Quarantine helper: copy orphan claim_integrity_verifications that cannot satisfy FKs.
CREATE OR REPLACE FUNCTION intelligence.quarantine_orphan_claim_verifications(
  p_migration_id TEXT DEFAULT '60-phase34-turn-index-and-audit-quarantine'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = intelligence, pg_temp
AS $$
DECLARE
  before_n INTEGER;
  quarantined_n INTEGER := 0;
  remaining_n INTEGER;
  r RECORD;
  qid TEXT;
  payload JSONB;
  phash TEXT;
BEGIN
  SELECT count(*)::int INTO before_n FROM intelligence.claim_integrity_verifications;

  FOR r IN
    SELECT c.*
    FROM intelligence.claim_integrity_verifications c
    WHERE NOT EXISTS (
      SELECT 1 FROM intelligence.response_envelopes x WHERE x.response_id = c.response_id
    )
    OR NOT EXISTS (
      SELECT 1 FROM intelligence.claim_ledger_entries e WHERE e.claim_id = c.claim_id
    )
    OR (
      c.calculation_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM intelligence.deterministic_calculations d
        WHERE d.calculation_id = c.calculation_id
      )
    )
    OR (
      c.evidence_snapshot_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM intelligence.evidence_snapshots s
        WHERE s.evidence_snapshot_id = c.evidence_snapshot_id
      )
    )
  LOOP
    payload := to_jsonb(r);
    phash := encode(pg_catalog.sha256(convert_to(payload::text, 'UTF8')), 'hex');
    qid := 'q-' || replace(pg_catalog.gen_random_uuid()::text, '-', '');
    INSERT INTO intelligence.migration_audit_quarantine (
      quarantine_id, migration_id, source_schema, source_table, source_pk,
      defect_reason, row_payload, row_payload_hash, notes
    ) VALUES (
      qid, p_migration_id, 'intelligence', 'claim_integrity_verifications',
      r.verification_id,
      'ORPHAN_FK_TARGET_MISSING',
      payload, phash,
      'Copied before constrained removal; production migrations must quarantine, not silently delete.'
    );
    quarantined_n := quarantined_n + 1;
  END LOOP;

  -- Only remove rows that were successfully quarantined (matching pk).
  IF quarantined_n > 0 THEN
    ALTER TABLE intelligence.claim_integrity_verifications
      DISABLE TRIGGER trg_claim_integrity_verifications_deny_delete;
    DELETE FROM intelligence.claim_integrity_verifications c
    WHERE EXISTS (
      SELECT 1 FROM intelligence.migration_audit_quarantine q
      WHERE q.source_table = 'claim_integrity_verifications'
        AND q.source_pk = c.verification_id
        AND q.migration_id = p_migration_id
    );
    ALTER TABLE intelligence.claim_integrity_verifications
      ENABLE TRIGGER trg_claim_integrity_verifications_deny_delete;
  END IF;

  SELECT count(*)::int INTO remaining_n FROM intelligence.claim_integrity_verifications;

  RETURN jsonb_build_object(
    'before', before_n,
    'quarantined', quarantined_n,
    'remaining', remaining_n,
    'migration_id', p_migration_id,
    'classification', 'QUARANTINE_THEN_REMOVE_ORPHANS'
  );
END;
$$;

COMMENT ON FUNCTION intelligence.quarantine_orphan_claim_verifications(TEXT) IS
  'Production-applicable orphan cleanup: copy to migration_audit_quarantine with payload hash, then remove. Never silent discard.';

-- Run once for current orphans (idempotent for already-quarantined pks via new inserts only).
SELECT intelligence.quarantine_orphan_claim_verifications('60-phase34-turn-index-and-audit-quarantine');
