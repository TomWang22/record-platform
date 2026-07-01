-- T20.25B — Opt-in hybrid preview enrollment (owner-scoped, non-default)
-- Apply to python_ai database after 10-ai-rag-corpus.sql

CREATE TABLE IF NOT EXISTS ai.ai_rag_preview_enrollment (
  user_id UUID PRIMARY KEY,
  owner_user_id UUID NOT NULL,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  enrolled_by UUID NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  source TEXT NOT NULL DEFAULT 'owner_opt_in',
  CONSTRAINT ai_rag_preview_enrollment_owner_match CHECK (user_id = owner_user_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_rag_preview_enrollment_active
  ON ai.ai_rag_preview_enrollment (user_id)
  WHERE revoked_at IS NULL;
