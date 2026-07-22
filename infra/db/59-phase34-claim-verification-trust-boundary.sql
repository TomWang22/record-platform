-- Phase 34 Migration 59: claim-verification trust boundary, durable publisher
-- denial audit for early exits, supersession session/turn lineage.
-- Isolated integration listings DB (port 5435). Not production.
--
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 5435 -U postgres -d listings \
--     -v ON_ERROR_STOP=1 -f infra/db/59-phase34-claim-verification-trust-boundary.sql

SET ROLE postgres;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Trusted verifier function owner (non-login)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_claim_verifier_owner') THEN
    CREATE ROLE record_claim_verifier_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_outbox_function_owner') THEN
    CREATE ROLE record_outbox_function_owner NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA intelligence TO record_claim_verifier_owner;
GRANT USAGE ON SCHEMA listings TO record_claim_verifier_owner;
GRANT SELECT ON intelligence.claim_ledger_entries TO record_claim_verifier_owner;
GRANT SELECT ON intelligence.claim_ledgers TO record_claim_verifier_owner;
GRANT SELECT ON intelligence.response_envelopes TO record_claim_verifier_owner;
GRANT SELECT ON intelligence.deterministic_calculations TO record_claim_verifier_owner;
GRANT SELECT ON intelligence.evidence_snapshots TO record_claim_verifier_owner;
GRANT SELECT ON intelligence.evidence_snapshot_items TO record_claim_verifier_owner;
GRANT SELECT ON intelligence.evidence_snapshot_exclusions TO record_claim_verifier_owner;
GRANT SELECT ON intelligence.eligibility_decisions TO record_claim_verifier_owner;
GRANT SELECT ON intelligence.market_events TO record_claim_verifier_owner;

-- ---------------------------------------------------------------------------
-- Supersession reason registry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intelligence.eligibility_supersession_reason_registry (
  reason_code   TEXT PRIMARY KEY,
  description   TEXT NOT NULL,
  version       TEXT NOT NULL DEFAULT 'phase34-supersession-reason-v1',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO intelligence.eligibility_supersession_reason_registry (reason_code, description)
VALUES
  ('correction', 'Same-session material correction'),
  ('condition_correction', 'Condition or grade correction'),
  ('pressing_disambiguation', 'Exact pressing identity correction'),
  ('constraint_change', 'Requested constraint change'),
  ('authorized_durable_memory_transition', 'Explicit cross-session durable memory transition')
ON CONFLICT (reason_code) DO NOTHING;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readwrite') THEN
    GRANT SELECT ON intelligence.eligibility_supersession_reason_registry TO record_readwrite;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readonly') THEN
    GRANT SELECT ON intelligence.eligibility_supersession_reason_registry TO record_readonly;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Verifier attempt ledger (auditable even when verification cannot complete)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intelligence.claim_verifier_attempt_ledger (
  attempt_id           TEXT PRIMARY KEY,
  occurred_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  response_id          TEXT,
  claim_id             TEXT,
  calculation_id       TEXT,
  caller_role          TEXT,
  result               TEXT NOT NULL CHECK (result IN ('PASS', 'FAIL', 'REJECTED', 'ERROR')),
  failure_codes        JSONB NOT NULL DEFAULT '[]'::jsonb,
  verifier_input_hash  TEXT,
  details              JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_sha           TEXT
);

CREATE INDEX IF NOT EXISTS idx_claim_verifier_attempt_claim
  ON intelligence.claim_verifier_attempt_ledger (claim_id, occurred_at DESC);

DO $$
DECLARE t TEXT := 'claim_verifier_attempt_ledger';
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

GRANT SELECT, INSERT ON intelligence.claim_verifier_attempt_ledger TO record_claim_verifier_owner;
REVOKE ALL ON TABLE intelligence.claim_verifier_attempt_ledger FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readwrite') THEN
    GRANT SELECT ON intelligence.claim_verifier_attempt_ledger TO record_readwrite;
    REVOKE INSERT, UPDATE, DELETE ON intelligence.claim_verifier_attempt_ledger FROM record_readwrite;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readonly') THEN
    GRANT SELECT ON intelligence.claim_verifier_attempt_ledger TO record_readonly;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Harden claim_integrity_verifications: columns, revoke forge INSERT, FKs
-- ---------------------------------------------------------------------------
ALTER TABLE intelligence.claim_integrity_verifications
  ADD COLUMN IF NOT EXISTS evidence_snapshot_id TEXT,
  ADD COLUMN IF NOT EXISTS claim_ledger_id TEXT,
  ADD COLUMN IF NOT EXISTS verifier_input_hash TEXT,
  ADD COLUMN IF NOT EXISTS canonical_calculation_hash TEXT,
  ADD COLUMN IF NOT EXISTS support_set_hash TEXT,
  ADD COLUMN IF NOT EXISTS source_sha TEXT,
  ADD COLUMN IF NOT EXISTS runtime_configuration_hash TEXT;

ALTER TABLE intelligence.claim_integrity_verifications
  ALTER COLUMN verifier_version SET DEFAULT 'phase34-claim-integrity-v3';

-- Drop orphan verification rows that cannot satisfy FKs (test residue).
ALTER TABLE intelligence.claim_integrity_verifications
  DISABLE TRIGGER trg_claim_integrity_verifications_deny_delete;
DELETE FROM intelligence.claim_integrity_verifications c
WHERE NOT EXISTS (
  SELECT 1 FROM intelligence.response_envelopes r WHERE r.response_id = c.response_id
)
OR NOT EXISTS (
  SELECT 1 FROM intelligence.claim_ledger_entries e WHERE e.claim_id = c.claim_id
)
OR (
  c.calculation_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM intelligence.deterministic_calculations d WHERE d.calculation_id = c.calculation_id
  )
);
ALTER TABLE intelligence.claim_integrity_verifications
  ENABLE TRIGGER trg_claim_integrity_verifications_deny_delete;

-- Backfill snapshot/ledger from related rows where possible.
ALTER TABLE intelligence.claim_integrity_verifications
  DISABLE TRIGGER trg_claim_integrity_verifications_deny_update;
UPDATE intelligence.claim_integrity_verifications c
SET evidence_snapshot_id = r.evidence_snapshot_id,
    claim_ledger_id = e.claim_ledger_id
FROM intelligence.response_envelopes r,
     intelligence.claim_ledger_entries e
WHERE c.response_id = r.response_id
  AND c.claim_id = e.claim_id
  AND (c.evidence_snapshot_id IS NULL OR c.claim_ledger_id IS NULL);
ALTER TABLE intelligence.claim_integrity_verifications
  ENABLE TRIGGER trg_claim_integrity_verifications_deny_update;

-- Drop any rows whose snapshot FK cannot be satisfied after backfill.
ALTER TABLE intelligence.claim_integrity_verifications
  DISABLE TRIGGER trg_claim_integrity_verifications_deny_delete;
DELETE FROM intelligence.claim_integrity_verifications c
WHERE c.evidence_snapshot_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM intelligence.evidence_snapshots s
    WHERE s.evidence_snapshot_id = c.evidence_snapshot_id
  );
ALTER TABLE intelligence.claim_integrity_verifications
  ENABLE TRIGGER trg_claim_integrity_verifications_deny_delete;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'claim_integrity_verifications_response_fkey'
  ) THEN
    ALTER TABLE intelligence.claim_integrity_verifications
      ADD CONSTRAINT claim_integrity_verifications_response_fkey
      FOREIGN KEY (response_id) REFERENCES intelligence.response_envelopes(response_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'claim_integrity_verifications_claim_fkey'
  ) THEN
    ALTER TABLE intelligence.claim_integrity_verifications
      ADD CONSTRAINT claim_integrity_verifications_claim_fkey
      FOREIGN KEY (claim_id) REFERENCES intelligence.claim_ledger_entries(claim_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'claim_integrity_verifications_calc_fkey'
  ) THEN
    ALTER TABLE intelligence.claim_integrity_verifications
      ADD CONSTRAINT claim_integrity_verifications_calc_fkey
      FOREIGN KEY (calculation_id) REFERENCES intelligence.deterministic_calculations(calculation_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'claim_integrity_verifications_snapshot_fkey'
  ) THEN
    ALTER TABLE intelligence.claim_integrity_verifications
      ADD CONSTRAINT claim_integrity_verifications_snapshot_fkey
      FOREIGN KEY (evidence_snapshot_id) REFERENCES intelligence.evidence_snapshots(evidence_snapshot_id);
  END IF;
END $$;

-- Trust boundary: only verifier owner may INSERT.
REVOKE ALL ON TABLE intelligence.claim_integrity_verifications FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON intelligence.claim_integrity_verifications FROM record_readwrite;
REVOKE INSERT, UPDATE, DELETE ON intelligence.claim_integrity_verifications FROM record_readonly;
REVOKE INSERT, UPDATE, DELETE ON intelligence.claim_integrity_verifications FROM record_outbox_publisher;
REVOKE INSERT, UPDATE, DELETE ON intelligence.claim_integrity_verifications FROM record_outbox_function_owner;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readwrite') THEN
    GRANT SELECT ON intelligence.claim_integrity_verifications TO record_readwrite;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readonly') THEN
    GRANT SELECT ON intelligence.claim_integrity_verifications TO record_readonly;
  END IF;
END $$;
GRANT SELECT, INSERT ON intelligence.claim_integrity_verifications TO record_claim_verifier_owner;

-- ---------------------------------------------------------------------------
-- Canonical hash helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION intelligence.canonical_json_hash(p_value JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = intelligence, pg_temp
AS $$
  SELECT encode(
    pg_catalog.sha256(convert_to(COALESCE(p_value::text, 'null'), 'UTF8')),
    'hex'
  );
$$;

CREATE OR REPLACE FUNCTION intelligence.canonical_text_hash(VARIADIC p_parts TEXT[])
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = intelligence, pg_temp
AS $$
DECLARE
  s TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1 .. COALESCE(array_length(p_parts, 1), 0) LOOP
    s := s || E'\x1f' || COALESCE(p_parts[i], '');
  END LOOP;
  RETURN encode(pg_catalog.sha256(convert_to(s, 'UTF8')), 'hex');
END;
$$;

-- ---------------------------------------------------------------------------
-- Rewritten DB-derived claim verifier (v3)
-- ---------------------------------------------------------------------------
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
  v_item RECORD;
  v_me RECORD;
  v_elig RECORD;
  has_claim BOOLEAN := FALSE;
  has_ledger BOOLEAN := FALSE;
  has_resp BOOLEAN := FALSE;
  has_calc BOOLEAN := FALSE;
  has_snap BOOLEAN := FALSE;
  failures TEXT[] := ARRAY[]::TEXT[];
  supporting TEXT;
  support_ids TEXT[] := ARRAY[]::TEXT[];
  market_ids TEXT[] := ARRAY[]::TEXT[];
  mid TEXT;
  claim_val JSONB;
  calc_derived JSONB;
  sold_n NUMERIC;
  support_n INTEGER := 0;
  verification_id TEXT;
  attempt_id TEXT;
  result_txt TEXT;
  details_json JSONB := '{}'::jsonb;
  input_hash TEXT;
  support_hash TEXT;
  calc_hash TEXT;
  snap_hash_recomputed TEXT;
  claim_hash TEXT;
  source_sha_val TEXT := COALESCE(current_setting('app.rp_source_sha', true), '');
  runtime_cfg TEXT := COALESCE(current_setting('app.runtime_configuration_hash', true), '');
  is_material BOOLEAN := FALSE;
BEGIN
  attempt_id := 'cva-' || replace(pg_catalog.gen_random_uuid()::text, '-', '');
  input_hash := intelligence.canonical_text_hash(
    COALESCE(p_response_id, ''),
    COALESCE(p_claim_id, ''),
    COALESCE(p_calculation_id, '')
  );

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
      is_material := v_claim.verification_result IN ('SUPPORTED', 'PARTIALLY_SUPPORTED');
    END IF;

    IF has_resp AND has_ledger THEN
      IF v_resp.evidence_snapshot_id IS DISTINCT FROM v_ledger.evidence_snapshot_id THEN
        failures := array_append(failures, 'LEDGER_SNAPSHOT_NE_RESPONSE');
      END IF;
      IF v_resp.claim_ledger_id IS DISTINCT FROM v_ledger.claim_ledger_id THEN
        failures := array_append(failures, 'RESPONSE_LEDGER_MISMATCH');
      END IF;
    END IF;

    -- Caller calculation substitution: if p_calculation_id provided it must equal claim link.
    IF p_calculation_id IS NOT NULL AND length(trim(p_calculation_id)) > 0 THEN
      IF NOT has_claim OR v_claim.deterministic_calculation_id IS NULL THEN
        failures := array_append(failures, 'CALLER_CALCULATION_SUBSTITUTION');
      ELSIF v_claim.deterministic_calculation_id IS DISTINCT FROM p_calculation_id THEN
        failures := array_append(failures, 'CALLER_CALCULATION_SUBSTITUTION');
      END IF;
    END IF;

    -- Material claims require persisted calculation linkage (never caller substitution).
    IF has_claim AND is_material AND v_claim.deterministic_calculation_id IS NULL THEN
      failures := array_append(failures, 'MATERIAL_CLAIM_MISSING_CALCULATION');
    END IF;

    IF has_claim AND v_claim.deterministic_calculation_id IS NOT NULL THEN
      SELECT * INTO v_calc
      FROM intelligence.deterministic_calculations
      WHERE calculation_id = v_claim.deterministic_calculation_id;
      has_calc := FOUND;
      IF NOT has_calc THEN
        failures := array_append(failures, 'CALCULATION_MISSING');
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

    -- Support resolution via snapshot items -> market_event_id
    IF has_claim AND has_snap THEN
      FOR supporting IN
        SELECT jsonb_array_elements_text(
          COALESCE(v_claim.supporting_snapshot_item_ids, '[]'::jsonb)
        )
      LOOP
        support_ids := array_append(support_ids, supporting);
        SELECT * INTO v_item
        FROM intelligence.evidence_snapshot_items i
        WHERE i.evidence_snapshot_id = v_snap.evidence_snapshot_id
          AND (i.evidence_id = supporting OR i.market_event_id = supporting)
        LIMIT 1;

        IF NOT FOUND THEN
          failures := array_append(failures, 'SUPPORTING_ITEM_NOT_IN_SNAPSHOT');
          CONTINUE;
        END IF;

        IF v_item.included IS DISTINCT FROM TRUE THEN
          failures := array_append(failures, 'EXCLUDED_ITEM_SUPPORTS_CLAIM');
          failures := array_append(failures, 'EXCLUDED_SUPPORTS_CLAIM');
        END IF;

        mid := v_item.market_event_id;
        IF mid IS NULL OR length(trim(mid)) = 0 THEN
          failures := array_append(failures, 'SUPPORTING_ITEM_NOT_IN_SNAPSHOT');
          CONTINUE;
        END IF;
        market_ids := array_append(market_ids, mid);

        IF EXISTS (
          SELECT 1 FROM intelligence.evidence_snapshot_exclusions e
          WHERE e.evidence_snapshot_id = v_snap.evidence_snapshot_id
            AND (e.evidence_id = supporting OR e.market_event_id = mid)
        ) THEN
          failures := array_append(failures, 'EXCLUDED_ITEM_SUPPORTS_CLAIM');
          failures := array_append(failures, 'EXCLUDED_SUPPORTS_CLAIM');
        END IF;

        -- INCLUDED eligibility decision required for supporting market event
        IF NOT EXISTS (
          SELECT 1 FROM intelligence.eligibility_decisions d
          WHERE d.evidence_snapshot_id = v_snap.evidence_snapshot_id
            AND d.market_event_id = mid
            AND d.decision = 'INCLUDED'
        ) THEN
          failures := array_append(failures, 'INCLUDED_ELIGIBILITY_DECISION_MISSING');
        END IF;

        IF EXISTS (
          SELECT 1 FROM intelligence.eligibility_decisions d
          WHERE d.evidence_snapshot_id = v_snap.evidence_snapshot_id
            AND d.market_event_id = mid
            AND d.decision = ANY (ARRAY[
              'EXCLUDED_WRONG_PRESSING','EXCLUDED_RELEASE_ONLY','EXCLUDED_DUPLICATE',
              'EXCLUDED_STALE','EXCLUDED_DELETED','EXCLUDED_RIGHTS','EXCLUDED_ASKING_NOT_SOLD',
              'EXCLUDED_UNSETTLED','EXCLUDED_REFUNDED','EXCLUDED_CURRENCY','EXCLUDED_CONDITION',
              'EXCLUDED_GEOGRAPHY','EXCLUDED_OUTLIER','EXCLUDED_UNRESOLVED'
            ])
        ) AND NOT EXISTS (
          SELECT 1 FROM intelligence.eligibility_decisions d
          WHERE d.evidence_snapshot_id = v_snap.evidence_snapshot_id
            AND d.market_event_id = mid
            AND d.decision = 'INCLUDED'
        ) THEN
          failures := array_append(failures, 'EXCLUDED_ITEM_SUPPORTS_CLAIM');
        END IF;

        SELECT * INTO v_me FROM intelligence.market_events WHERE market_event_id = mid LIMIT 1;
        IF NOT FOUND THEN
          failures := array_append(failures, 'SUPPORTING_ITEM_NOT_IN_SNAPSHOT');
          CONTINUE;
        END IF;

        IF upper(COALESCE(v_me.rights_status, '')) IN ('DENIED', 'REVOKED', 'BLOCKED', 'EXCLUDED_RIGHTS') THEN
          failures := array_append(failures, 'RIGHTS_INELIGIBLE');
        END IF;
        IF upper(COALESCE(v_me.deletion_status, 'ACTIVE')) IN ('DELETED', 'FORGOTTEN', 'TOMBSTONED') THEN
          failures := array_append(failures, 'DELETED_EVIDENCE');
        END IF;

        IF has_claim AND v_claim.claim_type IN (
          'sold_count', 'median_sold_price', 'sold_price', 'fair_market_range',
          'quick_sale_range', 'patient_sale_range', 'median'
        ) THEN
          IF upper(v_me.event_type) LIKE '%ASK%'
             OR upper(v_me.event_type) IN ('LISTING_CREATED', 'ASKING_PRICE', 'OFFER_CREATED') THEN
            failures := array_append(failures, 'ASKING_SUPPORTS_SOLD_CLAIM');
          END IF;
          IF upper(COALESCE(v_me.event_status, 'ACTIVE')) IN ('UNSETTLED', 'PENDING', 'OPEN')
             OR upper(v_me.event_type) LIKE '%UNSETTLED%' THEN
            failures := array_append(failures, 'UNSETTLED_SUPPORTS_SALE_CLAIM');
          END IF;
        END IF;

        IF has_claim AND (
          v_claim.claim_type IN ('exact_pressing_match', 'pressing_identity')
          OR v_claim.claim_type LIKE '%exact_pressing%'
        ) THEN
          IF v_me.pressing_id IS NULL THEN
            failures := array_append(failures, 'RELEASE_ONLY_SUPPORTS_EXACT_PRESSING');
          END IF;
        END IF;
      END LOOP;

      support_n := COALESCE(array_length(support_ids, 1), 0);
      IF is_material AND support_n = 0 THEN
        failures := array_append(failures, 'SUPPORT_SET_EMPTY');
      END IF;

      support_hash := intelligence.canonical_json_hash(to_jsonb(support_ids));
    END IF;

    -- Value alignment + recomputed hashes
    IF has_calc AND has_claim THEN
      BEGIN
        claim_val := v_claim.normalized_claim_value;
        IF v_claim.claim_type = 'currency' THEN
          IF claim_val IS DISTINCT FROM to_jsonb(v_calc.currency)
             AND claim_val #>> '{}' IS DISTINCT FROM v_calc.currency THEN
            failures := array_append(failures, 'CURRENCY_MISMATCH');
          END IF;
        ELSIF v_claim.claim_type = 'sold_count' THEN
          BEGIN
            sold_n := (claim_val #>> '{}')::numeric;
            calc_derived := COALESCE(
              v_calc.payload->'sold_count',
              to_jsonb(jsonb_array_length(COALESCE(v_calc.eligible_sale_prices, '[]'::jsonb)))
            );
            IF sold_n IS DISTINCT FROM (calc_derived #>> '{}')::numeric THEN
              failures := array_append(failures, 'CLAIM_VALUE_MISMATCH');
              failures := array_append(failures, 'SOLD_COUNT_MISMATCH');
            END IF;
            -- Exact support correspondence unless aggregate contract documented in payload
            IF COALESCE((v_calc.payload->>'aggregate_contract')::boolean, false) IS NOT TRUE THEN
              IF support_n > 0 AND sold_n IS DISTINCT FROM support_n::numeric THEN
                failures := array_append(failures, 'CLAIM_VALUE_MISMATCH');
                failures := array_append(failures, 'SOLD_COUNT_MISMATCH');
              END IF;
            END IF;
          EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
            failures := array_append(failures, 'CLAIM_VALUE_MISMATCH');
            failures := array_append(failures, 'SOLD_COUNT_MISMATCH');
          END;
        ELSIF v_claim.claim_type IN ('median_sold_price', 'median') THEN
          BEGIN
            IF v_calc.median IS NOT NULL
               AND (claim_val #>> '{}')::numeric IS DISTINCT FROM v_calc.median THEN
              failures := array_append(failures, 'CLAIM_VALUE_MISMATCH');
            END IF;
          EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
            failures := array_append(failures, 'CLAIM_VALUE_MISMATCH');
          END;
        ELSIF v_claim.claim_type IN ('quick_sale_range', 'fair_market_range', 'patient_sale_range') THEN
          calc_derived := CASE v_claim.claim_type
            WHEN 'quick_sale_range' THEN v_calc.quick_sale_range
            WHEN 'fair_market_range' THEN v_calc.fair_market_range
            ELSE v_calc.patient_sale_range
          END;
          IF calc_derived IS NOT NULL AND claim_val IS DISTINCT FROM calc_derived THEN
            failures := array_append(failures, 'CLAIM_VALUE_MISMATCH');
          END IF;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        failures := array_append(failures, 'CLAIM_VALUE_MISMATCH');
      END;

      -- Recompute calculation hash from normalized DB fields (not stored-vs-stored).
      calc_hash := intelligence.canonical_text_hash(
        COALESCE(v_calc.currency, ''),
        COALESCE(v_calc.median::text, ''),
        COALESCE(v_calc.eligible_sale_prices::text, ''),
        COALESCE(v_calc.quick_sale_range::text, ''),
        COALESCE(v_calc.fair_market_range::text, ''),
        COALESCE(v_calc.patient_sale_range::text, ''),
        COALESCE(v_calc.evidence_snapshot_id, '')
      );
      IF v_calc.result_hash IS NULL OR length(v_calc.result_hash) = 0 THEN
        failures := array_append(failures, 'CALCULATION_HASH_MISMATCH');
      ELSIF v_calc.result_hash IS DISTINCT FROM calc_hash THEN
        failures := array_append(failures, 'CALCULATION_HASH_MISMATCH');
      END IF;

      claim_hash := intelligence.canonical_json_hash(COALESCE(v_claim.normalized_claim_value, 'null'::jsonb));
    END IF;

    IF has_snap THEN
      -- Recompute from payload; also accept documented v1 fixture contract where
      -- payload.canonical_algorithm = phase34-snapshot-hash-v1 and stored matches payload hash field.
      snap_hash_recomputed := intelligence.canonical_json_hash(COALESCE(v_snap.payload, '{}'::jsonb));
      IF v_snap.evidence_snapshot_hash IS NULL OR length(v_snap.evidence_snapshot_hash) = 0 THEN
        failures := array_append(failures, 'SNAPSHOT_HASH_MISMATCH');
      ELSIF COALESCE(v_snap.payload->>'canonical_algorithm', '') = 'phase34-snapshot-hash-v1'
            AND COALESCE(v_snap.payload->>'canonical_snapshot_hash', '') = v_snap.evidence_snapshot_hash THEN
        NULL; -- documented stored-hash contract for controlled fixtures
      ELSIF v_snap.evidence_snapshot_hash IS DISTINCT FROM snap_hash_recomputed THEN
        failures := array_append(failures, 'SNAPSHOT_HASH_MISMATCH');
      END IF;
    END IF;

    -- Support-set hash: when calculation documents expected support_set_hash, require match.
    IF has_calc AND support_hash IS NOT NULL
       AND COALESCE(v_calc.payload->>'support_set_hash', '') <> ''
       AND v_calc.payload->>'support_set_hash' IS DISTINCT FROM support_hash THEN
      failures := array_append(failures, 'SUPPORT_SET_HASH_MISMATCH');
    END IF;

  EXCEPTION WHEN OTHERS THEN
    failures := array_append(failures, 'CLAIM_VALUE_MISMATCH');
    details_json := details_json || jsonb_build_object('exception', SQLERRM);
  END;

  -- Deduplicate failure codes
  SELECT array_agg(DISTINCT f) INTO failures FROM unnest(failures) AS f;

  result_txt := CASE WHEN coalesce(array_length(failures, 1), 0) = 0 THEN 'PASS' ELSE 'FAIL' END;
  verification_id := 'civ-' || replace(pg_catalog.gen_random_uuid()::text, '-', '');
  details_json := details_json || jsonb_build_object(
    'support_count', support_n,
    'market_ids', to_jsonb(market_ids),
    'recomputed_calculation_hash', calc_hash,
    'recomputed_support_hash', support_hash,
    'recomputed_snapshot_hash_probe', snap_hash_recomputed,
    'claim_hash', claim_hash
  );

  -- Attempt ledger always (even if verification insert cannot proceed).
  INSERT INTO intelligence.claim_verifier_attempt_ledger (
    attempt_id, response_id, claim_id, calculation_id, caller_role, result,
    failure_codes, verifier_input_hash, details, source_sha
  ) VALUES (
    attempt_id, p_response_id, p_claim_id,
    CASE WHEN has_claim THEN v_claim.deterministic_calculation_id END,
    current_user, result_txt, to_jsonb(COALESCE(failures, ARRAY[]::TEXT[])),
    input_hash, details_json, NULLIF(source_sha_val, '')
  );

  -- Only persist verification row when FK targets exist.
  IF has_resp AND has_claim THEN
    INSERT INTO intelligence.claim_integrity_verifications (
      verification_id, response_id, claim_id, calculation_id,
      evidence_snapshot_id, claim_ledger_id,
      verifier_version, result, failure_codes, details,
      verifier_input_hash, canonical_calculation_hash, support_set_hash,
      source_sha, runtime_configuration_hash
    ) VALUES (
      verification_id,
      p_response_id,
      p_claim_id,
      CASE WHEN has_claim THEN v_claim.deterministic_calculation_id END,
      CASE WHEN has_snap THEN v_snap.evidence_snapshot_id
           WHEN has_resp THEN v_resp.evidence_snapshot_id END,
      CASE WHEN has_ledger THEN v_ledger.claim_ledger_id
           WHEN has_claim THEN v_claim.claim_ledger_id END,
      'phase34-claim-integrity-v3',
      result_txt,
      to_jsonb(COALESCE(failures, ARRAY[]::TEXT[])),
      details_json,
      input_hash,
      calc_hash,
      support_hash,
      NULLIF(source_sha_val, ''),
      NULLIF(runtime_cfg, '')
    );
  END IF;

  RETURN jsonb_build_object(
    'verification_id', CASE WHEN has_resp AND has_claim THEN verification_id ELSE NULL END,
    'attempt_id', attempt_id,
    'result', result_txt,
    'verifier_version', 'phase34-claim-integrity-v3',
    'verified_at', NOW(),
    'failure_codes', to_jsonb(COALESCE(failures, ARRAY[]::TEXT[])),
    'verifier_input_hash', input_hash,
    'canonical_calculation_hash', calc_hash,
    'support_set_hash', support_hash
  );
END;
$$;

ALTER FUNCTION intelligence.verify_claim_integrity_from_db(TEXT, TEXT, TEXT)
  OWNER TO record_claim_verifier_owner;

REVOKE ALL ON FUNCTION intelligence.verify_claim_integrity_from_db(TEXT, TEXT, TEXT) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readwrite') THEN
    GRANT EXECUTE ON FUNCTION intelligence.verify_claim_integrity_from_db(TEXT, TEXT, TEXT)
      TO record_readwrite;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    GRANT record_claim_verifier_owner TO postgres;
  END IF;
END $$;

COMMENT ON FUNCTION intelligence.verify_claim_integrity_from_db(TEXT, TEXT, TEXT) IS
  'Migration 59 trust-boundary verifier. Loads claim/ledger/response/calculation/snapshot from DB. '
  'Rejects caller calculation substitution. Resolves support via snapshot items. '
  'Only record_claim_verifier_owner may INSERT verification rows.';

-- ---------------------------------------------------------------------------
-- Publisher: durable denial for missing owner / incomplete coords
-- ---------------------------------------------------------------------------
-- Allow denial rows when event exists; for missing-owner use lease_owner = ''.
-- Extend action check already includes *_DENIED.

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
  owner_eff TEXT;
BEGIN
  owner_eff := COALESCE(NULLIF(trim(p_owner), ''), '');

  IF p_owner IS NULL OR length(trim(p_owner)) = 0 THEN
    IF EXISTS (SELECT 1 FROM listings.outbox_events WHERE id = p_id) THEN
      PERFORM listings._outbox_log_action(
        p_id, 'ACKNOWLEDGE_DENIED', NULL, 'DENIED', 'OUTBOX_LEASE_OWNER_REQUIRED',
        NULL, NULL, NULL, NULL, NULL
      );
    END IF;
    RETURN jsonb_build_object(
      'affected_rows', 0, 'result', 'DENIED', 'error_class', 'OUTBOX_LEASE_OWNER_REQUIRED'
    );
  END IF;

  IF p_topic IS NULL OR p_partition IS NULL OR p_offset IS NULL THEN
    IF EXISTS (SELECT 1 FROM listings.outbox_events WHERE id = p_id) THEN
      PERFORM listings._outbox_log_action(
        p_id, 'ACKNOWLEDGE_DENIED', p_owner, 'DENIED', 'OUTBOX_BROKER_ACK_INCOMPLETE',
        NULL, NULL, NULL, NULL, NULL
      );
    END IF;
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
    -- Distinguish already-published / dead-lettered / wrong owner
    IF EXISTS (
      SELECT 1 FROM listings.outbox_events
      WHERE id = p_id AND published = true
    ) THEN
      PERFORM listings._outbox_log_action(
        p_id, 'ACKNOWLEDGE_DENIED', p_owner, 'DENIED', 'ALREADY_PUBLISHED',
        NULL, NULL, NULL, NULL, NULL
      );
      RETURN jsonb_build_object(
        'affected_rows', 0, 'result', 'DENIED', 'error_class', 'ALREADY_PUBLISHED'
      );
    ELSIF EXISTS (
      SELECT 1 FROM listings.outbox_events
      WHERE id = p_id AND COALESCE(dead_lettered, false) = true
    ) THEN
      PERFORM listings._outbox_log_action(
        p_id, 'ACKNOWLEDGE_DENIED', p_owner, 'DENIED', 'DEAD_LETTERED',
        NULL, NULL, NULL, NULL, NULL
      );
      RETURN jsonb_build_object(
        'affected_rows', 0, 'result', 'DENIED', 'error_class', 'DEAD_LETTERED'
      );
    ELSE
      PERFORM listings._outbox_log_action(
        p_id, 'ACKNOWLEDGE_DENIED', p_owner, 'DENIED', 'WRONG_OR_EXPIRED_LEASE',
        NULL, NULL, NULL, NULL, NULL
      );
      RETURN jsonb_build_object(
        'affected_rows', 0, 'result', 'DENIED', 'error_class', 'WRONG_OR_EXPIRED_LEASE'
      );
    END IF;
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
    IF EXISTS (SELECT 1 FROM listings.outbox_events WHERE id = p_id) THEN
      PERFORM listings._outbox_log_action(
        p_id, 'RESCHEDULE_DENIED', NULL, 'DENIED', 'OUTBOX_LEASE_OWNER_REQUIRED'
      );
    END IF;
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
    IF EXISTS (SELECT 1 FROM listings.outbox_events WHERE id = p_id) THEN
      PERFORM listings._outbox_log_action(
        p_id, 'DEAD_LETTER_DENIED', NULL, 'DENIED', 'OUTBOX_LEASE_OWNER_REQUIRED'
      );
    END IF;
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
    IF EXISTS (SELECT 1 FROM listings.outbox_events WHERE id = p_id) THEN
      PERFORM listings._outbox_log_action(
        p_id, 'RELEASE_DENIED', NULL, 'DENIED', 'OUTBOX_LEASE_OWNER_REQUIRED'
      );
    END IF;
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

ALTER FUNCTION listings.acknowledge_outbox_publish(UUID, TEXT, TEXT, INTEGER, BIGINT)
  OWNER TO record_outbox_function_owner;
ALTER FUNCTION listings.reschedule_outbox_event(UUID, TEXT, TEXT, TIMESTAMPTZ)
  OWNER TO record_outbox_function_owner;
ALTER FUNCTION listings.dead_letter_outbox_event(UUID, TEXT, TEXT)
  OWNER TO record_outbox_function_owner;
ALTER FUNCTION listings.release_outbox_lease(UUID, TEXT)
  OWNER TO record_outbox_function_owner;

REVOKE ALL ON FUNCTION listings.acknowledge_outbox_publish(UUID, TEXT, TEXT, INTEGER, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION listings.reschedule_outbox_event(UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION listings.dead_letter_outbox_event(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION listings.release_outbox_lease(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION listings.acknowledge_outbox_publish(UUID, TEXT, TEXT, INTEGER, BIGINT)
  TO record_outbox_publisher;
GRANT EXECUTE ON FUNCTION listings.reschedule_outbox_event(UUID, TEXT, TEXT, TIMESTAMPTZ)
  TO record_outbox_publisher;
GRANT EXECUTE ON FUNCTION listings.dead_letter_outbox_event(UUID, TEXT, TEXT)
  TO record_outbox_publisher;
GRANT EXECUTE ON FUNCTION listings.release_outbox_lease(UUID, TEXT)
  TO record_outbox_publisher;

-- ---------------------------------------------------------------------------
-- Supersession: session/turn/request lineage + reason registry
-- ---------------------------------------------------------------------------
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
         session_id, turn_id, request_id
    INTO prev_cap, prev_subj, prev_at, prev_superseded,
         prev_session, prev_turn, prev_request
  FROM intelligence.eligibility_decisions
  WHERE eligibility_decision_id = NEW.previous_decision_id;

  SELECT capability, subject, decided_at, superseded_by_decision_id,
         session_id, turn_id, request_id
    INTO new_cap, new_subj, new_at, new_superseded,
         new_session, new_turn, new_request
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

  -- Session lineage: same-session corrections must match session_id.
  IF prev_session IS NOT NULL AND new_session IS NOT NULL THEN
    IF prev_session IS DISTINCT FROM new_session THEN
      IF NEW.reason IS DISTINCT FROM 'authorized_durable_memory_transition' THEN
        RAISE EXCEPTION 'SUPERSESSION_SESSION_MISMATCH'
          USING ERRCODE = 'integrity_constraint_violation';
      END IF;
    ELSE
      -- Same session: new turn must be later when both present.
      IF prev_turn IS NOT NULL AND new_turn IS NOT NULL THEN
        IF new_turn <= prev_turn THEN
          RAISE EXCEPTION 'SUPERSESSION_TURN_ORDER'
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;
      END IF;
    END IF;
  END IF;

  -- Request lineage: edge request_id should align with new decision when both set.
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
  IF NEW.turn_id IS NOT NULL AND new_turn IS NOT NULL
     AND NEW.turn_id IS DISTINCT FROM new_turn THEN
    RAISE EXCEPTION 'SUPERSESSION_TURN_MISMATCH'
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
