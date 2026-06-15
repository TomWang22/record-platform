-- Phase 18 T18.1: additive nullable vector column for RAG chunk embeddings.
-- Idempotent. No-op with NOTICE when pgvector is unavailable (e.g. postgres:16-alpine).
-- Does NOT drop or alter the existing BYTEA `embedding` column.
-- Run: PGPASSWORD=postgres psql -h 127.0.0.1 -p 5440 -U postgres -d python_ai -f infra/db/11-ai-rag-embedding-vec.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    RAISE NOTICE 'phase-18 T18.1: pgvector not available on this Postgres image; embedding_vec skipped';
    RETURN;
  END IF;
  BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'phase-18 T18.1: CREATE EXTENSION vector failed (%); embedding_vec skipped', SQLERRM;
      RETURN;
  END;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    RAISE NOTICE 'phase-18 T18.1: vector extension not installed; embedding_vec skipped';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'ai' AND table_name = 'ai_document_chunks'
  ) THEN
    RAISE NOTICE 'phase-18 T18.1: ai.ai_document_chunks missing; apply 10-ai-rag-corpus.sql first';
    RETURN;
  END IF;

  ALTER TABLE ai.ai_document_chunks
    ADD COLUMN IF NOT EXISTS embedding_vec vector(768);

  RAISE NOTICE 'phase-18 T18.1: embedding_vec vector(768) column ready (nullable; BYTEA embedding unchanged)';
END $$;
