-- Phase G: optional connector-contract registry + append-only license grants.
-- Rights posture for intelligence evidence sources.
--
--   export PGOPTIONS='-c gssencmode=disable'
--   PGPASSWORD=postgres psql -h localhost -p 5435 -U postgres -d listings \
--     -f infra/db/53-intelligence-rights-connectors.sql

SET ROLE postgres;

CREATE SCHEMA IF NOT EXISTS intelligence;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_owner') THEN
    ALTER SCHEMA intelligence OWNER TO record_owner;
  END IF;
END $$;

GRANT USAGE ON SCHEMA intelligence TO record_readwrite, record_readonly;

-- ---------------------------------------------------------------------------
-- G1: Connector contracts (upsertable registry of rights posture)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intelligence.connector_contracts (
  connector_id               TEXT PRIMARY KEY,
  contract_version           TEXT NOT NULL DEFAULT 'phase34-rights-connectors-v1',
  rights_status              TEXT NOT NULL,
  permitted_purposes         JSONB NOT NULL DEFAULT '[]'::jsonb,
  retention_policy           TEXT NOT NULL,
  deletion_policy            TEXT NOT NULL,
  attribution_requirement    TEXT NOT NULL,
  freshness_policy           TEXT NOT NULL,
  rate_limits                JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_classes           JSONB NOT NULL DEFAULT '[]'::jsonb,
  connector_status           TEXT NOT NULL,
  approval_reference         TEXT,
  credentials_reference      TEXT NOT NULL DEFAULT 'none',
  source_ids                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes                      TEXT,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connector_contracts_status
  ON intelligence.connector_contracts (connector_status, rights_status);

-- ---------------------------------------------------------------------------
-- G2: License grants (append-only — written permission records)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intelligence.license_grants (
  grant_id                   TEXT PRIMARY KEY,
  source_id                  TEXT NOT NULL,
  license_id                 TEXT NOT NULL,
  grantor                    TEXT NOT NULL,
  grantee                    TEXT NOT NULL DEFAULT 'record-platform',
  permitted_purposes         JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_classes           JSONB NOT NULL DEFAULT '[]'::jsonb,
  effective_at               TIMESTAMPTZ NOT NULL,
  expires_at                 TIMESTAMPTZ,
  document_reference         TEXT NOT NULL,
  notes                      TEXT,
  recorded_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, license_id, document_reference, effective_at)
);

CREATE INDEX IF NOT EXISTS idx_license_grants_source
  ON intelligence.license_grants (source_id, effective_at DESC);

-- Append-only: block UPDATE/DELETE on license_grants
CREATE OR REPLACE FUNCTION intelligence.deny_license_grant_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'LICENSE_GRANTS_APPEND_ONLY: UPDATE/DELETE forbidden on intelligence.license_grants';
END;
$$;

DROP TRIGGER IF EXISTS trg_deny_license_grant_update ON intelligence.license_grants;
CREATE TRIGGER trg_deny_license_grant_update
  BEFORE UPDATE ON intelligence.license_grants
  FOR EACH ROW
  EXECUTE FUNCTION intelligence.deny_license_grant_mutation();

DROP TRIGGER IF EXISTS trg_deny_license_grant_delete ON intelligence.license_grants;
CREATE TRIGGER trg_deny_license_grant_delete
  BEFORE DELETE ON intelligence.license_grants
  FOR EACH ROW
  EXECUTE FUNCTION intelligence.deny_license_grant_mutation();

REVOKE UPDATE, DELETE ON intelligence.license_grants FROM PUBLIC;
GRANT SELECT, INSERT ON intelligence.license_grants TO record_readwrite;
GRANT SELECT ON intelligence.license_grants TO record_readonly;

GRANT SELECT, INSERT, UPDATE ON intelligence.connector_contracts TO record_readwrite;
GRANT SELECT ON intelligence.connector_contracts TO record_readonly;

-- Seed preferred first-party + catalog contracts (idempotent upsert)
INSERT INTO intelligence.connector_contracts AS c (
  connector_id, rights_status, permitted_purposes, retention_policy, deletion_policy,
  attribution_requirement, freshness_policy, evidence_classes, connector_status,
  approval_reference, notes
) VALUES
  (
    'FIRST_PARTY_SETTLEMENTS', 'FIRST_PARTY',
    '["retrieval","analytics","display","evidence_snapshots"]'::jsonb,
    'product_lifecycle_with_deletion_honored',
    'propagate_to_retrieval_and_snapshots',
    'none_internal', 'bounded_ttl',
    '["COMPLETED_SETTLEMENT"]'::jsonb, 'ENABLED',
    'phase34-first-party-platform-data',
    'Preferred completed-sale evidence from platform settlements only.'
  ),
  (
    'PERMITTED_PUBLIC_CATALOG', 'CC0',
    '["retrieval","display","evidence_snapshots","entity_resolution"]'::jsonb,
    'product_lifecycle_with_deletion_honored',
    'propagate_to_retrieval_and_snapshots',
    'source_url_and_license_cc0_in_provenance', 'monthly_dump_when_enabled',
    '["CATALOG_METADATA"]'::jsonb, 'ENABLED',
    'discogs-data-dumps-cc0',
    'Discogs CC0 / permitted catalog metadata only. Catalog presence is not sale evidence.'
  ),
  (
    'popsike-historical-auction-archive', 'PROHIBITED',
    '[]'::jsonb,
    'no_ingest_until_written_permission',
    'propagate_to_retrieval_and_snapshots',
    'pending_license_terms', 'connector_disabled',
    '[]'::jsonb, 'DISABLED_NO_WRITTEN_RIGHTS',
    NULL,
    'Disabled unless written license grant recorded.'
  ),
  (
    'gripsweat-historical-sales-archive', 'PROHIBITED',
    '[]'::jsonb,
    'no_ingest_until_written_permission',
    'propagate_to_retrieval_and_snapshots',
    'pending_license_terms', 'connector_disabled',
    '[]'::jsonb, 'DISABLED_NO_WRITTEN_RIGHTS',
    NULL,
    'Disabled unless written license grant recorded.'
  ),
  (
    'discogs-restricted-marketplace', 'RESTRICTED',
    '[]'::jsonb,
    'do_not_persist_restricted_payloads',
    'propagate_to_retrieval_and_snapshots',
    'n_a_while_disabled', 'connector_disabled',
    '[]'::jsonb, 'DISABLED_BY_POLICY',
    NULL,
    'Marketplace/sales endpoints blocked. credentials_reference env:DISCOGS_API_KEY only.'
  )
ON CONFLICT (connector_id) DO UPDATE SET
  rights_status = EXCLUDED.rights_status,
  permitted_purposes = EXCLUDED.permitted_purposes,
  retention_policy = EXCLUDED.retention_policy,
  deletion_policy = EXCLUDED.deletion_policy,
  attribution_requirement = EXCLUDED.attribution_requirement,
  freshness_policy = EXCLUDED.freshness_policy,
  evidence_classes = EXCLUDED.evidence_classes,
  connector_status = EXCLUDED.connector_status,
  approval_reference = EXCLUDED.approval_reference,
  notes = EXCLUDED.notes,
  updated_at = NOW();
