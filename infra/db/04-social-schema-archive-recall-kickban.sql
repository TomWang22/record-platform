-- Social: archive chat, delete chat, recall message, group kick/ban
-- Run on social DB (port 5434). Safe to run multiple times (IF NOT EXISTS / DO blocks).

SET ROLE postgres;

-- 1. Recall message: store recalled state (content replaced by "[Message recalled]")
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'messages' AND table_name = 'messages' AND column_name = 'recalled_at') THEN
    ALTER TABLE messages.messages ADD COLUMN recalled_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS idx_messages_recalled ON messages.messages(recalled_at) WHERE recalled_at IS NOT NULL;
  END IF;
END $$;

-- 2. User-archived threads (archive chat = hide from inbox, still accessible)
CREATE TABLE IF NOT EXISTS messages.user_archived_threads (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL,
  thread_id  UUID NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, thread_id)
);
CREATE INDEX IF NOT EXISTS idx_user_archived_threads_user ON messages.user_archived_threads(user_id);
CREATE INDEX IF NOT EXISTS idx_user_archived_threads_thread ON messages.user_archived_threads(thread_id);

-- 3. User-deleted threads (delete chat = remove from list for this user; messages stay for others)
CREATE TABLE IF NOT EXISTS messages.user_deleted_threads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  thread_id   UUID NOT NULL,
  deleted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, thread_id)
);
CREATE INDEX IF NOT EXISTS idx_user_deleted_threads_user ON messages.user_deleted_threads(user_id);
CREATE INDEX IF NOT EXISTS idx_user_deleted_threads_thread ON messages.user_deleted_threads(thread_id);

-- 4. Group bans (kick = remove from group; ban = remove + add to bans so they can't rejoin)
CREATE TABLE IF NOT EXISTS messages.group_bans (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID NOT NULL REFERENCES messages.groups(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL,
  banned_by  UUID NOT NULL,
  reason     TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_group_bans_group ON messages.group_bans(group_id);
CREATE INDEX IF NOT EXISTS idx_group_bans_user ON messages.group_bans(user_id);
CREATE INDEX IF NOT EXISTS idx_group_bans_expires ON messages.group_bans(expires_at) WHERE expires_at IS NOT NULL;

-- 5. messages.archived for group-archived messages (optional; used by group archive)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'messages' AND table_name = 'messages' AND column_name = 'archived') THEN
    ALTER TABLE messages.messages ADD COLUMN archived BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE INDEX IF NOT EXISTS idx_messages_archived ON messages.messages(archived) WHERE archived = TRUE;
  END IF;
END $$;

-- 6. groups.archived for archive chat (soft delete group)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'messages' AND table_name = 'groups' AND column_name = 'archived') THEN
    ALTER TABLE messages.groups ADD COLUMN archived BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE INDEX IF NOT EXISTS idx_groups_archived ON messages.groups(archived) WHERE archived = TRUE;
  END IF;
END $$;
