-- T15.2A: Platform-wide AI RAG corpus storage (python_ai DB, port 5440).
-- Idempotent. Run:
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 5440 -U postgres -d python_ai -f infra/db/10-ai-rag-corpus.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS ai;

-- Prefer pgvector when available; corpus works without it (keyword/BM25 fallback).
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pgvector unavailable (%); embeddings stored as BYTEA until enabled', SQLERRM;
END $$;

CREATE TABLE IF NOT EXISTS ai.ai_documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type       TEXT NOT NULL,
  source_id         TEXT NOT NULL,
  owner_user_id     TEXT,
  visibility        TEXT NOT NULL CHECK (visibility IN ('owner', 'public', 'private')),
  title             TEXT NOT NULL,
  summary           TEXT NOT NULL DEFAULT '',
  source_updated_at TIMESTAMPTZ NOT NULL,
  checksum          TEXT NOT NULL,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_documents_source_key
  ON ai.ai_documents (source_type, source_id, COALESCE(owner_user_id, ''), visibility);

CREATE INDEX IF NOT EXISTS idx_ai_documents_owner
  ON ai.ai_documents (owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_documents_visibility
  ON ai.ai_documents (visibility);
CREATE INDEX IF NOT EXISTS idx_ai_documents_source_type
  ON ai.ai_documents (source_type);
CREATE INDEX IF NOT EXISTS idx_ai_documents_checksum
  ON ai.ai_documents (checksum);

CREATE TABLE IF NOT EXISTS ai.ai_document_chunks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id      UUID NOT NULL REFERENCES ai.ai_documents(id) ON DELETE CASCADE,
  chunk_index      INTEGER NOT NULL CHECK (chunk_index >= 0),
  content          TEXT NOT NULL,
  token_count      INTEGER,
  embedding        BYTEA,
  embedding_model  TEXT,
  checksum         TEXT NOT NULL,
  source_refs      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_document_chunks_doc_index_key UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_ai_document_chunks_document
  ON ai.ai_document_chunks (document_id, chunk_index);

CREATE TABLE IF NOT EXISTS ai.ai_ingestion_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status        TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  source_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  error         TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_ingestion_runs_started
  ON ai.ai_ingestion_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS ai.ai_rag_queries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT,
  contract_id   TEXT,
  prompt_hash   TEXT,
  source_refs   JSONB NOT NULL DEFAULT '[]'::jsonb,
  model_used    TEXT,
  source_status TEXT NOT NULL CHECK (source_status IN ('live', 'degraded')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_rag_queries_user
  ON ai.ai_rag_queries (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION ai.touch_ai_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ai_documents_touch ON ai.ai_documents;
CREATE TRIGGER trg_ai_documents_touch
  BEFORE UPDATE ON ai.ai_documents
  FOR EACH ROW EXECUTE FUNCTION ai.touch_ai_documents_updated_at();

COMMENT ON TABLE ai.ai_documents IS 'Curated platform memory documents (analytics-normalized, owner-scoped).';
COMMENT ON TABLE ai.ai_document_chunks IS 'Deterministic chunks for RAG retrieval; embeddings optional (BYTEA).';
COMMENT ON TABLE ai.ai_ingestion_runs IS 'RAG reindex run audit trail.';
COMMENT ON TABLE ai.ai_rag_queries IS 'RAG query audit (T15.3+); no fake rows in T15.2.';
