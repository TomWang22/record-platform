-- Phase 26A: KPI observability tables (python_ai DB, port 5440).
-- Design contract: docs/ai-platform/PHASE_25B_KPI_EVENT_AND_SCHEMA_CONTRACT_PROPOSAL.md
-- Idempotent. Dry-run / validation only in Phase 26A — do not apply to live DB without explicit approval.
-- Run:
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 5440 -U postgres -d python_ai -f infra/db/48-ai-kpi-observability.sql

CREATE SCHEMA IF NOT EXISTS ai;

CREATE TABLE IF NOT EXISTS ai.ai_kpi_ingestion_events (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingestion_run_id         UUID NOT NULL REFERENCES ai.ai_ingestion_runs(id) ON DELETE CASCADE,
  source_type              TEXT NOT NULL,
  source_id_hash           TEXT,
  data_arrived_at          TIMESTAMPTZ NOT NULL,
  normalized_at            TIMESTAMPTZ,
  embedding_started_at     TIMESTAMPTZ,
  embedding_completed_at   TIMESTAMPTZ,
  index_upserted_at        TIMESTAMPTZ,
  searchable_verified_at   TIMESTAMPTZ,
  arrival_to_searchable_ms BIGINT,
  embedding_duration_ms    BIGINT,
  index_upsert_duration_ms BIGINT,
  records_received         INTEGER NOT NULL DEFAULT 0,
  records_indexed          INTEGER NOT NULL DEFAULT 0,
  embedding_jobs_started     INTEGER NOT NULL DEFAULT 0,
  embedding_jobs_completed   INTEGER NOT NULL DEFAULT 0,
  embedding_jobs_failed      INTEGER NOT NULL DEFAULT 0,
  index_upsert_success       INTEGER NOT NULL DEFAULT 0,
  index_upsert_failed        INTEGER NOT NULL DEFAULT 0,
  dead_letter_count          INTEGER NOT NULL DEFAULT 0,
  retry_count                INTEGER NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_kpi_ingestion_events_run
  ON ai.ai_kpi_ingestion_events (ingestion_run_id);
CREATE INDEX IF NOT EXISTS idx_ai_kpi_ingestion_events_source_arrived
  ON ai.ai_kpi_ingestion_events (source_type, data_arrived_at);
CREATE INDEX IF NOT EXISTS idx_ai_kpi_ingestion_events_created
  ON ai.ai_kpi_ingestion_events (created_at DESC);

CREATE TABLE IF NOT EXISTS ai.ai_kpi_searchability_checks (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingestion_run_id         UUID REFERENCES ai.ai_ingestion_runs(id) ON DELETE SET NULL,
  source_type              TEXT NOT NULL,
  source_id_hash           TEXT NOT NULL,
  data_arrived_at          TIMESTAMPTZ,
  searchable_verified_at   TIMESTAMPTZ NOT NULL,
  arrival_to_searchable_ms BIGINT NOT NULL,
  probe_query_hash         TEXT,
  probe_status             TEXT NOT NULL CHECK (probe_status IN ('PASS', 'FAIL')),
  protocol                 TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_kpi_searchability_checks_verified
  ON ai.ai_kpi_searchability_checks (searchable_verified_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_kpi_searchability_checks_source
  ON ai.ai_kpi_searchability_checks (source_type, searchable_verified_at DESC);

CREATE TABLE IF NOT EXISTS ai.ai_kpi_query_observations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  observed_at           TIMESTAMPTZ NOT NULL,
  protocol              TEXT NOT NULL,
  retrieval_mode        TEXT NOT NULL,
  gate_reason           TEXT,
  case_id               TEXT,
  workflow              TEXT,
  rag_total_ms          INTEGER NOT NULL,
  hybrid_retrieval_ms   INTEGER,
  keyword_retrieval_ms  INTEGER,
  fallback_count        INTEGER NOT NULL DEFAULT 0,
  canary_error_count    INTEGER NOT NULL DEFAULT 0,
  http_status           INTEGER,
  environment           TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_kpi_query_observations_observed
  ON ai.ai_kpi_query_observations (observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_kpi_query_observations_protocol
  ON ai.ai_kpi_query_observations (protocol, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_kpi_query_observations_gate
  ON ai.ai_kpi_query_observations (gate_reason, observed_at DESC);

CREATE TABLE IF NOT EXISTS ai.ai_kpi_usefulness_observations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  observed_at           TIMESTAMPTZ NOT NULL,
  protocol              TEXT NOT NULL,
  case_id               TEXT,
  workflow              TEXT,
  response_pass         BOOLEAN NOT NULL,
  sentiment_pass        BOOLEAN,
  red_team_safety_pass  BOOLEAN,
  leakage_failures      INTEGER NOT NULL DEFAULT 0,
  quality_score         NUMERIC(4, 2),
  evidence_label        TEXT,
  environment           TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_kpi_usefulness_observations_observed
  ON ai.ai_kpi_usefulness_observations (observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_kpi_usefulness_observations_protocol
  ON ai.ai_kpi_usefulness_observations (protocol, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_kpi_usefulness_observations_evidence
  ON ai.ai_kpi_usefulness_observations (evidence_label, observed_at DESC);

CREATE OR REPLACE FUNCTION ai.touch_ai_kpi_ingestion_events_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ai_kpi_ingestion_events_touch ON ai.ai_kpi_ingestion_events;
CREATE TRIGGER trg_ai_kpi_ingestion_events_touch
  BEFORE UPDATE ON ai.ai_kpi_ingestion_events
  FOR EACH ROW EXECUTE FUNCTION ai.touch_ai_kpi_ingestion_events_updated_at();

COMMENT ON TABLE ai.ai_kpi_ingestion_events IS 'Phase 26A KPI ingestion batch events; writes gated by AI_KPI_* flags (default off).';
COMMENT ON TABLE ai.ai_kpi_searchability_checks IS 'Phase 26A searchability verification probes; no raw query text (hash only).';
COMMENT ON TABLE ai.ai_kpi_query_observations IS 'Phase 26A RAG query latency observations; no raw response bodies.';
COMMENT ON TABLE ai.ai_kpi_usefulness_observations IS 'Phase 26A rubric usefulness observations; evidence labels preserved.';
