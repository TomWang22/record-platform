-- Social service tuning only (Port 5434).
-- Run only on social DB; other tuning is in service-specific-tuning.sql but references
-- schemas/tables that may not exist on all instances (auth.oauth_tokens, ai.inference_log, etc.).

-- Composite indexes for message lookups (messages schema)
CREATE INDEX IF NOT EXISTS idx_messages_sender_created
  ON messages.messages (sender_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_recipient_created
  ON messages.messages (recipient_id, created_at DESC)
  WHERE recipient_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_group_created
  ON messages.messages (group_id, created_at DESC)
  WHERE group_id IS NOT NULL;

-- Forum posts indexes (forum schema)
CREATE INDEX IF NOT EXISTS idx_forum_posts_created
  ON forum.posts (created_at DESC, flair);

CREATE INDEX IF NOT EXISTS idx_forum_posts_user_created
  ON forum.posts (user_id, created_at DESC);

-- Index for sender + created (no NOW() predicate - not immutable)
CREATE INDEX IF NOT EXISTS idx_messages_active_sender
  ON messages.messages (sender_id, created_at DESC);

-- Autovacuum (write-heavy)
ALTER TABLE IF EXISTS messages.messages SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_scale_factor = 0.05
);

ALTER TABLE IF EXISTS forum.posts SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_scale_factor = 0.05
);

ANALYZE messages.messages;
ANALYZE forum.posts;
