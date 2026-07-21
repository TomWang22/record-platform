-- Phase B: canonical market-event + evidence snapshot + claim ledger platform.
-- Shared by all eight intelligence capabilities.
--
--   export PGOPTIONS='-c gssencmode=disable'
--   PGPASSWORD=postgres psql -h localhost -p 5435 -U postgres -d listings \
--     -f infra/db/51-intelligence-evidence-platform.sql

SET ROLE postgres;

CREATE SCHEMA IF NOT EXISTS intelligence;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_owner') THEN
    ALTER SCHEMA intelligence OWNER TO record_owner;
  END IF;
END $$;

GRANT USAGE ON SCHEMA intelligence TO record_readwrite, record_readonly;

-- ---------------------------------------------------------------------------
-- B1: Raw observation store (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intelligence.raw_observations (
  observation_id         TEXT PRIMARY KEY,
  source_class           TEXT NOT NULL
    CHECK (source_class IN (
      'FIRST_PARTY_SETTLEMENT',
      'FIRST_PARTY_LISTING',
      'FIRST_PARTY_OFFER',
      'FIRST_PARTY_AUCTION',
      'FIRST_PARTY_BID_EVENT',
      'FIRST_PARTY_WATCHLIST',
      'FIRST_PARTY_COLLECTION',
      'FIRST_PARTY_PREFERENCE',
      'FIRST_PARTY_AUTHORIZED_MESSAGE',
      'PERMITTED_PUBLIC_CATALOG',
      'LICENSED_EXTERNAL_ARCHIVE'
    )),
  source_connector       TEXT NOT NULL,
  source_record_id       TEXT NOT NULL,
  source_event_type      TEXT NOT NULL,
  observed_at            TIMESTAMPTZ NOT NULL,
  effective_at           TIMESTAMPTZ,
  ingested_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_payload            JSONB NOT NULL,
  canonical_payload_hash TEXT NOT NULL,
  authorization_scope    TEXT NOT NULL,
  rights_classification  TEXT NOT NULL,
  retention_status       TEXT NOT NULL DEFAULT 'ACTIVE',
  deletion_status        TEXT NOT NULL DEFAULT 'ACTIVE',
  connector_version      TEXT,
  trace_id               TEXT,
  correlation_id         TEXT,
  UNIQUE (source_connector, source_record_id, source_event_type, canonical_payload_hash)
);

CREATE INDEX IF NOT EXISTS idx_raw_observations_source_class
  ON intelligence.raw_observations (source_class, observed_at DESC);

-- ---------------------------------------------------------------------------
-- B2: Canonical normalized market events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intelligence.market_events (
  market_event_id              TEXT PRIMARY KEY,
  observation_id               TEXT NOT NULL
    REFERENCES intelligence.raw_observations(observation_id),
  event_type                   TEXT NOT NULL,
  event_status                 TEXT NOT NULL DEFAULT 'ACTIVE',
  normalization_version        TEXT NOT NULL DEFAULT 'phase34-market-event-v2',
  subject_artist               TEXT,
  subject_title                TEXT,
  subject_label                TEXT,
  subject_catalog_number       TEXT,
  release_id                   TEXT,
  pressing_id                  TEXT,
  media_condition              TEXT,
  sleeve_condition             TEXT,
  geography_country            TEXT,
  currency_original            TEXT,
  price_original               NUMERIC(12, 2),
  currency_normalized          TEXT,
  price_normalized             NUMERIC(12, 2),
  occurred_at                  TIMESTAMPTZ NOT NULL,
  rights_status                TEXT NOT NULL,
  deletion_status              TEXT NOT NULL DEFAULT 'ACTIVE',
  eligibility_state            TEXT NOT NULL DEFAULT 'PENDING',
  payload_hash                 TEXT NOT NULL,
  payload                      JSONB NOT NULL,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (observation_id, event_type, payload_hash)
);

CREATE INDEX IF NOT EXISTS idx_market_events_type_time
  ON intelligence.market_events (event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_events_pressing
  ON intelligence.market_events (pressing_id, occurred_at DESC)
  WHERE pressing_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- B3: Entity / pressing resolution
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intelligence.entity_resolutions (
  resolution_id        TEXT PRIMARY KEY,
  subject_hash         TEXT NOT NULL,
  resolution_status    TEXT NOT NULL
    CHECK (resolution_status IN (
      'MATCHED_EXACT_PRESSING',
      'MATCHED_RELEASE_ONLY',
      'AMBIGUOUS',
      'UNRESOLVED'
    )),
  resolved_release_id  TEXT,
  resolved_pressing_id TEXT,
  confidence           NUMERIC(5, 4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  matched_fields       JSONB NOT NULL DEFAULT '[]'::jsonb,
  conflicting_fields   JSONB NOT NULL DEFAULT '[]'::jsonb,
  missing_fields       JSONB NOT NULL DEFAULT '[]'::jsonb,
  candidate_alternatives JSONB NOT NULL DEFAULT '[]'::jsonb,
  resolution_version   TEXT NOT NULL DEFAULT 'phase34-entity-resolution-v1',
  input_subject        JSONB NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entity_resolutions_subject_hash
  ON intelligence.entity_resolutions (subject_hash, created_at DESC);

-- ---------------------------------------------------------------------------
-- B4: Eligibility decisions (one per candidate event per snapshot build)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intelligence.eligibility_decisions (
  decision_id          BIGSERIAL PRIMARY KEY,
  evidence_snapshot_id TEXT NOT NULL,
  market_event_id      TEXT NOT NULL,
  decision             TEXT NOT NULL
    CHECK (decision IN (
      'INCLUDED',
      'EXCLUDED_WRONG_PRESSING',
      'EXCLUDED_RELEASE_ONLY',
      'EXCLUDED_DUPLICATE',
      'EXCLUDED_STALE',
      'EXCLUDED_DELETED',
      'EXCLUDED_RIGHTS',
      'EXCLUDED_ASKING_NOT_SOLD',
      'EXCLUDED_UNSETTLED',
      'EXCLUDED_CURRENCY',
      'EXCLUDED_CONDITION',
      'EXCLUDED_GEOGRAPHY',
      'EXCLUDED_OUTLIER',
      'EXCLUDED_UNRESOLVED'
    )),
  reason_detail        TEXT,
  eligibility_version  TEXT NOT NULL DEFAULT 'phase34-eligibility-v1',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (evidence_snapshot_id, market_event_id)
);

-- ---------------------------------------------------------------------------
-- B5: Immutable evidence snapshots
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intelligence.evidence_snapshots (
  evidence_snapshot_id   TEXT PRIMARY KEY,
  evidence_snapshot_hash TEXT NOT NULL UNIQUE,
  evidence_snapshot_version TEXT NOT NULL DEFAULT 'phase34-evidence-snapshot-v2',
  capability             TEXT NOT NULL,
  request_id             TEXT,
  session_id             TEXT,
  turn_id                TEXT,
  subject_resolution_id  TEXT REFERENCES intelligence.entity_resolutions(resolution_id),
  requested_constraints  JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_rights_distribution JSONB NOT NULL DEFAULT '{}'::jsonb,
  event_type_distribution JSONB NOT NULL DEFAULT '{}'::jsonb,
  data_time_range_start  TIMESTAMPTZ,
  data_time_range_end    TIMESTAMPTZ,
  freshness              JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_version         TEXT NOT NULL DEFAULT 'phase34-dedupe-v1',
  eligibility_version    TEXT NOT NULL DEFAULT 'phase34-eligibility-v1',
  retrieval_version      TEXT NOT NULL DEFAULT 'phase34-retrieval-v1',
  payload                JSONB NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS intelligence.evidence_snapshot_items (
  snapshot_item_id       BIGSERIAL PRIMARY KEY,
  evidence_snapshot_id   TEXT NOT NULL
    REFERENCES intelligence.evidence_snapshots(evidence_snapshot_id),
  market_event_id        TEXT,
  observation_id         TEXT,
  evidence_id            TEXT NOT NULL,
  event_type             TEXT,
  sale_kind              TEXT,
  pressing_match         TEXT,
  included               BOOLEAN NOT NULL DEFAULT TRUE,
  item_payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (evidence_snapshot_id, evidence_id)
);

CREATE TABLE IF NOT EXISTS intelligence.evidence_snapshot_exclusions (
  exclusion_id           BIGSERIAL PRIMARY KEY,
  evidence_snapshot_id   TEXT NOT NULL
    REFERENCES intelligence.evidence_snapshots(evidence_snapshot_id),
  market_event_id        TEXT,
  evidence_id            TEXT,
  decision               TEXT NOT NULL,
  reason_detail          TEXT
);

-- UNIQUE with expressions via index (Postgres):
DROP INDEX IF EXISTS uq_evidence_snapshot_exclusions_natural;
CREATE UNIQUE INDEX IF NOT EXISTS uq_evidence_snapshot_exclusions_natural
  ON intelligence.evidence_snapshot_exclusions (
    evidence_snapshot_id,
    COALESCE(market_event_id, ''),
    COALESCE(evidence_id, ''),
    decision
  );

CREATE TABLE IF NOT EXISTS intelligence.evidence_snapshot_subjects (
  evidence_snapshot_id   TEXT NOT NULL
    REFERENCES intelligence.evidence_snapshots(evidence_snapshot_id),
  subject_role           TEXT NOT NULL DEFAULT 'primary',
  subject_payload        JSONB NOT NULL,
  resolution_status      TEXT,
  PRIMARY KEY (evidence_snapshot_id, subject_role)
);

CREATE TABLE IF NOT EXISTS intelligence.evidence_snapshot_queries (
  evidence_snapshot_id   TEXT PRIMARY KEY
    REFERENCES intelligence.evidence_snapshots(evidence_snapshot_id),
  query_plan             JSONB NOT NULL,
  retrieval_execution    JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS intelligence.evidence_snapshot_versions (
  version_id             TEXT PRIMARY KEY,
  schema_version         TEXT NOT NULL,
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO intelligence.evidence_snapshot_versions (version_id, schema_version, notes)
VALUES ('phase34-evidence-snapshot-v2', 'v2', 'Phase B immutable shared snapshots')
ON CONFLICT (version_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- B6: Claim-to-evidence ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intelligence.claim_ledgers (
  claim_ledger_id        TEXT PRIMARY KEY,
  response_id            TEXT NOT NULL,
  evidence_snapshot_id   TEXT NOT NULL
    REFERENCES intelligence.evidence_snapshots(evidence_snapshot_id),
  evidence_snapshot_hash TEXT NOT NULL,
  verification_status    TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (verification_status IN ('PENDING', 'PASS', 'FAIL')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS intelligence.claim_ledger_entries (
  claim_id               TEXT PRIMARY KEY,
  claim_ledger_id        TEXT NOT NULL
    REFERENCES intelligence.claim_ledgers(claim_ledger_id),
  response_id            TEXT NOT NULL,
  claim_type             TEXT NOT NULL,
  normalized_claim_value JSONB NOT NULL,
  supporting_snapshot_item_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  deterministic_calculation_id TEXT,
  synthesis_path         TEXT,
  verification_result    TEXT NOT NULL
    CHECK (verification_result IN (
      'SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED', 'CONTRADICTED'
    )),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claim_ledger_entries_ledger
  ON intelligence.claim_ledger_entries (claim_ledger_id);

-- ---------------------------------------------------------------------------
-- B7: Shared response envelope registry (metadata; payload may be truncated)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intelligence.response_envelopes (
  response_id            TEXT PRIMARY KEY,
  capability             TEXT NOT NULL,
  envelope_version       TEXT NOT NULL DEFAULT 'phase34-response-envelope-v1',
  evidence_snapshot_id   TEXT NOT NULL
    REFERENCES intelligence.evidence_snapshots(evidence_snapshot_id),
  evidence_snapshot_hash TEXT NOT NULL,
  claim_ledger_id        TEXT REFERENCES intelligence.claim_ledgers(claim_ledger_id),
  session_state_version  TEXT,
  envelope_payload       JSONB NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Append-only protection for observations, snapshots, claims
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION intelligence.deny_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'INTELLIGENCE_APPEND_ONLY: % on % is forbidden', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'raw_observations',
    'market_events',
    'evidence_snapshots',
    'evidence_snapshot_items',
    'evidence_snapshot_exclusions',
    'evidence_snapshot_subjects',
    'evidence_snapshot_queries',
    'claim_ledgers',
    'claim_ledger_entries',
    'response_envelopes'
  ]
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

-- Link sale_completed evidence_snapshot_id to platform when present (soft: no FK yet
-- to allow migration order; application must write snapshot first).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'listings' AND table_name = 'sale_completed_events'
      AND column_name = 'platform_snapshot_bound'
  ) THEN
    ALTER TABLE listings.sale_completed_events
      ADD COLUMN platform_snapshot_bound BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readwrite') THEN
    GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA intelligence TO record_readwrite;
    REVOKE UPDATE, DELETE ON ALL TABLES IN SCHEMA intelligence FROM record_readwrite;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA intelligence TO record_readwrite;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readonly') THEN
    GRANT SELECT ON ALL TABLES IN SCHEMA intelligence TO record_readonly;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA intelligence TO record_readonly;
  END IF;
END $$;

COMMENT ON SCHEMA intelligence IS
  'Phase 34 shared canonical observation/event/evidence/claim platform for all eight capabilities.';
