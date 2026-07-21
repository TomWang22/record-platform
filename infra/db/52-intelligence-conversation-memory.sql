-- Phase D: authoritative multi-turn conversation memory and corrections.
-- Tables under intelligence schema. Facts/revisions append-oriented;
-- supersession via active=false / deletion_state (soft), not hard DELETE of history.
--
--   export PGOPTIONS='-c gssencmode=disable'
--   PGPASSWORD=postgres psql -h localhost -p 5435 -U postgres -d listings \
--     -f infra/db/52-intelligence-conversation-memory.sql

SET ROLE postgres;

CREATE SCHEMA IF NOT EXISTS intelligence;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_owner') THEN
    ALTER SCHEMA intelligence OWNER TO record_owner;
  END IF;
END $$;

GRANT USAGE ON SCHEMA intelligence TO record_readwrite, record_readonly;

-- ---------------------------------------------------------------------------
-- D1: conversation_session
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intelligence.conversation_sessions (
  session_id             TEXT PRIMARY KEY,
  schema_version         TEXT NOT NULL DEFAULT 'phase34-conversation-memory-v1',
  principal_id           TEXT NOT NULL,
  thread_id              TEXT,
  account_id             TEXT,
  participant_side       TEXT,
  state_version          BIGINT NOT NULL DEFAULT 0,
  consent_durable_memory BOOLEAN NOT NULL DEFAULT FALSE,
  consent_cross_session  BOOLEAN NOT NULL DEFAULT FALSE,
  scopes_allowed         JSONB NOT NULL DEFAULT '["TURN","SESSION","THREAD"]'::jsonb,
  metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_sessions_principal
  ON intelligence.conversation_sessions (principal_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_sessions_thread
  ON intelligence.conversation_sessions (thread_id, updated_at DESC)
  WHERE thread_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- D1: conversation_turn
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intelligence.conversation_turns (
  turn_id                TEXT PRIMARY KEY,
  session_id             TEXT NOT NULL
    REFERENCES intelligence.conversation_sessions(session_id),
  turn_index             INTEGER NOT NULL,
  actor                  TEXT,
  role                   TEXT,
  intent                 TEXT,
  content                JSONB,
  metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, turn_index)
);

CREATE INDEX IF NOT EXISTS idx_conversation_turns_session
  ON intelligence.conversation_turns (session_id, turn_index);

-- ---------------------------------------------------------------------------
-- D1: structured_fact (append rows; supersession via active + supersedes_fact_id)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intelligence.structured_facts (
  fact_id                TEXT PRIMARY KEY,
  session_id             TEXT NOT NULL
    REFERENCES intelligence.conversation_sessions(session_id),
  fact_key               TEXT NOT NULL,
  value                  JSONB,
  value_type             TEXT NOT NULL,
  source_turn_id         TEXT
    REFERENCES intelligence.conversation_turns(turn_id),
  source_actor           TEXT,
  fact_timestamp         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confidence             NUMERIC(6, 5) NOT NULL DEFAULT 1.0,
  authority              TEXT NOT NULL
    CHECK (authority IN (
      'CURRENT_EXPLICIT_CUSTOMER_CORRECTION',
      'CURRENT_EXPLICIT_CUSTOMER_STATEMENT',
      'PERSISTED_AUTHORIZED_THREAD_FACT',
      'FIRST_PARTY_MARKETPLACE_EVENT',
      'GROUNDED_INFERENCE',
      'MODEL_INFERENCE'
    )),
  supersedes_fact_id     TEXT
    REFERENCES intelligence.structured_facts(fact_id),
  active                 BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at             TIMESTAMPTZ,
  privacy_scope          TEXT NOT NULL DEFAULT 'SESSION'
    CHECK (privacy_scope IN (
      'TURN', 'SESSION', 'THREAD', 'USER_PRIVATE', 'ACCOUNT', 'NONE'
    )),
  principal_id           TEXT,
  thread_id              TEXT,
  deletion_state         TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (deletion_state IN (
      'ACTIVE', 'SUPERSEDED', 'FORGOTTEN', 'DELETED', 'EXPIRED'
    )),
  metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_structured_facts_session_key_active
  ON intelligence.structured_facts (session_id, fact_key, active)
  WHERE deletion_state IN ('ACTIVE', 'SUPERSEDED');

CREATE INDEX IF NOT EXISTS idx_structured_facts_principal
  ON intelligence.structured_facts (principal_id, fact_timestamp DESC)
  WHERE principal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_structured_facts_thread
  ON intelligence.structured_facts (thread_id, fact_timestamp DESC)
  WHERE thread_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- D1: fact_revision (append-only audit of supersession / forget)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intelligence.fact_revisions (
  revision_id            TEXT PRIMARY KEY,
  fact_id                TEXT NOT NULL
    REFERENCES intelligence.structured_facts(fact_id),
  session_id             TEXT NOT NULL
    REFERENCES intelligence.conversation_sessions(session_id),
  previous_value         JSONB,
  next_value             JSONB,
  reason                 TEXT,
  authority              TEXT,
  turn_id                TEXT
    REFERENCES intelligence.conversation_turns(turn_id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fact_revisions_session
  ON intelligence.fact_revisions (session_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- D1 / D4: memory_scope registry (consent + labels)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intelligence.memory_scopes (
  scope_id               TEXT PRIMARY KEY,
  session_id             TEXT NOT NULL
    REFERENCES intelligence.conversation_sessions(session_id),
  scope                  TEXT NOT NULL
    CHECK (scope IN (
      'TURN', 'SESSION', 'THREAD', 'USER_PRIVATE', 'ACCOUNT', 'NONE'
    )),
  consent                BOOLEAN NOT NULL DEFAULT FALSE,
  source_label           TEXT,
  expires_at             TIMESTAMPTZ,
  principal_id           TEXT,
  thread_id              TEXT,
  account_id             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_scopes_session
  ON intelligence.memory_scopes (session_id, scope);

-- ---------------------------------------------------------------------------
-- D1 / D3: retrieval_checkpoint (re-retrieve after material correction)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intelligence.retrieval_checkpoints (
  checkpoint_id          TEXT PRIMARY KEY,
  session_id             TEXT NOT NULL
    REFERENCES intelligence.conversation_sessions(session_id),
  turn_id                TEXT
    REFERENCES intelligence.conversation_turns(turn_id),
  reason                 TEXT NOT NULL DEFAULT 'material_correction',
  query_plan             JSONB,
  evidence_snapshot_id   TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_retrieval_checkpoints_session
  ON intelligence.retrieval_checkpoints (session_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- D1: response (capability output bound to session_state_version)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intelligence.conversation_responses (
  response_id            TEXT PRIMARY KEY,
  session_id             TEXT NOT NULL
    REFERENCES intelligence.conversation_sessions(session_id),
  turn_id                TEXT
    REFERENCES intelligence.conversation_turns(turn_id),
  capability             TEXT,
  session_state_version  TEXT NOT NULL,
  payload                JSONB,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_responses_session
  ON intelligence.conversation_responses (session_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- D5: draft lifecycle — GENERATED → EDITED → INSERTED → CONFIRMED → SENT | CANCELLED
-- Insert is never send.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intelligence.conversation_drafts (
  draft_id               TEXT PRIMARY KEY,
  session_id             TEXT NOT NULL
    REFERENCES intelligence.conversation_sessions(session_id),
  turn_id                TEXT
    REFERENCES intelligence.conversation_turns(turn_id),
  body                   TEXT,
  status                 TEXT NOT NULL DEFAULT 'GENERATED'
    CHECK (status IN (
      'GENERATED', 'EDITED', 'INSERTED', 'CONFIRMED', 'SENT', 'CANCELLED'
    )),
  message_sent           BOOLEAN NOT NULL DEFAULT FALSE,
  inserted_at            TIMESTAMPTZ,
  confirmed_at           TIMESTAMPTZ,
  sent_at                TIMESTAMPTZ,
  metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT conversation_drafts_insert_not_send CHECK (
    NOT (status = 'INSERTED' AND message_sent = TRUE)
  ),
  CONSTRAINT conversation_drafts_sent_requires_flag CHECK (
    (status = 'SENT' AND message_sent = TRUE) OR (status <> 'SENT')
  )
);

CREATE INDEX IF NOT EXISTS idx_conversation_drafts_session
  ON intelligence.conversation_drafts (session_id, updated_at DESC);

-- ---------------------------------------------------------------------------
-- D5: action_confirmation — side effects require explicit confirmation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intelligence.action_confirmations (
  confirmation_id        TEXT PRIMARY KEY,
  session_id             TEXT NOT NULL
    REFERENCES intelligence.conversation_sessions(session_id),
  action_type            TEXT NOT NULL,
  draft_id               TEXT
    REFERENCES intelligence.conversation_drafts(draft_id),
  confirmed              BOOLEAN NOT NULL DEFAULT FALSE,
  actor                  TEXT,
  metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_action_confirmations_session
  ON intelligence.action_confirmations (session_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Append-only protection for revisions + checkpoints (history must not mutate)
-- Soft-active flags on structured_facts / drafts allow status updates.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION intelligence.deny_conversation_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'INTELLIGENCE_CONVERSATION_APPEND_ONLY: % on % is forbidden', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'fact_revisions',
    'retrieval_checkpoints',
    'conversation_responses',
    'action_confirmations'
  ]
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%s_deny_update ON intelligence.%I',
      t, t
    );
    EXECUTE format(
      'CREATE TRIGGER trg_%s_deny_update BEFORE UPDATE ON intelligence.%I
       FOR EACH ROW EXECUTE FUNCTION intelligence.deny_conversation_append_only_mutation()',
      t, t
    );
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%s_deny_delete ON intelligence.%I',
      t, t
    );
    EXECUTE format(
      'CREATE TRIGGER trg_%s_deny_delete BEFORE DELETE ON intelligence.%I
       FOR EACH ROW EXECUTE FUNCTION intelligence.deny_conversation_append_only_mutation()',
      t, t
    );
  END LOOP;
END $$;

-- structured_facts: deny DELETE; allow UPDATE only for soft-active / deletion_state columns
CREATE OR REPLACE FUNCTION intelligence.structured_facts_soft_update_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'INTELLIGENCE_CONVERSATION_APPEND_ONLY: DELETE on structured_facts is forbidden'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.fact_id IS DISTINCT FROM OLD.fact_id
     OR NEW.session_id IS DISTINCT FROM OLD.session_id
     OR NEW.fact_key IS DISTINCT FROM OLD.fact_key
     OR NEW.value IS DISTINCT FROM OLD.value
     OR NEW.value_type IS DISTINCT FROM OLD.value_type
     OR NEW.source_turn_id IS DISTINCT FROM OLD.source_turn_id
     OR NEW.source_actor IS DISTINCT FROM OLD.source_actor
     OR NEW.fact_timestamp IS DISTINCT FROM OLD.fact_timestamp
     OR NEW.confidence IS DISTINCT FROM OLD.confidence
     OR NEW.authority IS DISTINCT FROM OLD.authority
     OR NEW.supersedes_fact_id IS DISTINCT FROM OLD.supersedes_fact_id
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.privacy_scope IS DISTINCT FROM OLD.privacy_scope
     OR NEW.principal_id IS DISTINCT FROM OLD.principal_id
     OR NEW.thread_id IS DISTINCT FROM OLD.thread_id
     OR NEW.metadata IS DISTINCT FROM OLD.metadata
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'INTELLIGENCE_CONVERSATION_APPEND_ONLY: immutable columns on structured_facts cannot change'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  -- Only active / deletion_state may change (supersession / forget soft flags).
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_structured_facts_soft_update ON intelligence.structured_facts;
CREATE TRIGGER trg_structured_facts_soft_update
  BEFORE UPDATE OR DELETE ON intelligence.structured_facts
  FOR EACH ROW EXECUTE FUNCTION intelligence.structured_facts_soft_update_guard();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readwrite') THEN
    GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA intelligence TO record_readwrite;
    GRANT UPDATE (active, deletion_state) ON intelligence.structured_facts TO record_readwrite;
    GRANT UPDATE (status, message_sent, inserted_at, confirmed_at, sent_at, body, metadata, updated_at)
      ON intelligence.conversation_drafts TO record_readwrite;
    GRANT UPDATE (state_version, updated_at, consent_durable_memory, consent_cross_session, scopes_allowed, metadata)
      ON intelligence.conversation_sessions TO record_readwrite;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA intelligence TO record_readwrite;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_readonly') THEN
    GRANT SELECT ON ALL TABLES IN SCHEMA intelligence TO record_readonly;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA intelligence TO record_readonly;
  END IF;
END $$;

COMMENT ON TABLE intelligence.conversation_sessions IS
  'Phase D conversation sessions; state_version feeds finalizeCapabilityResponse.session_state_version.';
COMMENT ON TABLE intelligence.structured_facts IS
  'Phase D structured facts with authority precedence and soft supersession.';
COMMENT ON TABLE intelligence.conversation_drafts IS
  'Phase D negotiation drafts; INSERTED never implies SENT.';
