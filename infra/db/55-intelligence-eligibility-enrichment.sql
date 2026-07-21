-- Phase 34 runtime: eligibility decision enrichment (live response path).
-- Isolated integration listings DB (port 5435). Not production.
--
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 5435 -U postgres -d listings \
--     -v ON_ERROR_STOP=1 -f infra/db/55-intelligence-eligibility-enrichment.sql

SET ROLE postgres;

ALTER TABLE intelligence.eligibility_decisions
  DROP CONSTRAINT IF EXISTS eligibility_decisions_decision_check;

ALTER TABLE intelligence.eligibility_decisions
  ADD CONSTRAINT eligibility_decisions_decision_check CHECK (decision = ANY (ARRAY[
    'INCLUDED',
    'EXCLUDED_WRONG_PRESSING',
    'EXCLUDED_RELEASE_ONLY',
    'EXCLUDED_DUPLICATE',
    'EXCLUDED_STALE',
    'EXCLUDED_DELETED',
    'EXCLUDED_RIGHTS',
    'EXCLUDED_ASKING_NOT_SOLD',
    'EXCLUDED_UNSETTLED',
    'EXCLUDED_REFUNDED',
    'EXCLUDED_CURRENCY',
    'EXCLUDED_CONDITION',
    'EXCLUDED_GEOGRAPHY',
    'EXCLUDED_OUTLIER',
    'EXCLUDED_UNRESOLVED'
  ]));

ALTER TABLE intelligence.eligibility_decisions
  ADD COLUMN IF NOT EXISTS capability TEXT,
  ADD COLUMN IF NOT EXISTS subject JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS requested_constraints JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS entity_resolution_version TEXT NOT NULL DEFAULT 'phase34-entity-resolution-v1',
  ADD COLUMN IF NOT EXISTS dedupe_version TEXT NOT NULL DEFAULT 'phase34-dedupe-v1',
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

COMMENT ON COLUMN intelligence.eligibility_decisions.capability IS
  'Requested intelligence capability for this eligibility decision.';
COMMENT ON COLUMN intelligence.eligibility_decisions.decided_at IS
  'When the eligibility decision was recorded (append-only).';
