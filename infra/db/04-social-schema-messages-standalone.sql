-- Messages schema standalone (WhatsApp-style: 1:1 and 1:many, user + timestamp, read-by-recipient, attachments, emoji in content).
-- Run on port 5434 (social DB). Use when messages.* is missing (e.g. full 04-social-schema failed before messages).
-- Data model: direct = (sender_id, recipient_id); group = (sender_id, group_id). Read state per recipient in message_reads.
-- Governance: target ≤1M rows per schema outside 5433 (see docs/DATA_GOVERNANCE_AND_SCHEMA_CAPS.md).

CREATE SCHEMA IF NOT EXISTS messages;

-- Groups (for 1:many / group chat)
CREATE TABLE IF NOT EXISTS messages.groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(256) NOT NULL,
  description TEXT,
  created_by  UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages.group_members (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id  UUID NOT NULL REFERENCES messages.groups(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL,
  role      VARCHAR(16) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'moderator', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(group_id, user_id)
);

-- Messages: from user, timestamp; 1:1 (recipient_id) or 1:many (group_id). Content = text + emoji (TEXT/UTF-8).
-- sender_id / recipient_id from auth; optional sender_display_name denormalized from auth for display.
CREATE TABLE IF NOT EXISTS messages.messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id        UUID NOT NULL,
  recipient_id     UUID,
  group_id         UUID REFERENCES messages.groups(id) ON DELETE CASCADE,
  parent_message_id UUID,
  thread_id        UUID,
  message_type     VARCHAR(32) NOT NULL DEFAULT 'General',
  subject          VARCHAR(512),
  content          TEXT NOT NULL,
  is_read          BOOLEAN NOT NULL DEFAULT FALSE,
  sender_display_name VARCHAR(128),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (recipient_id IS NOT NULL AND group_id IS NULL) OR
    (recipient_id IS NULL AND group_id IS NOT NULL)
  )
);

-- Self-references (add after table exists; skip if FKs already exist)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints c
    JOIN information_schema.key_column_usage k ON c.constraint_name = k.constraint_name AND c.table_schema = k.table_schema
    WHERE c.table_schema = 'messages' AND c.table_name = 'messages' AND c.constraint_type = 'FOREIGN KEY' AND k.column_name = 'parent_message_id') THEN
    ALTER TABLE messages.messages ADD CONSTRAINT messages_parent_fk
      FOREIGN KEY (parent_message_id) REFERENCES messages.messages(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints c
    JOIN information_schema.key_column_usage k ON c.constraint_name = k.constraint_name AND c.table_schema = k.table_schema
    WHERE c.table_schema = 'messages' AND c.table_name = 'messages' AND c.constraint_type = 'FOREIGN KEY' AND k.column_name = 'thread_id') THEN
    ALTER TABLE messages.messages ADD CONSTRAINT messages_thread_fk
      FOREIGN KEY (thread_id) REFERENCES messages.messages(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Attachments (images, video, audio, documents, etc.)
CREATE TABLE IF NOT EXISTS messages.message_attachments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id       UUID NOT NULL REFERENCES messages.messages(id) ON DELETE CASCADE,
  file_url         TEXT NOT NULL,
  file_path        TEXT,
  thumbnail_url    TEXT,
  file_name        VARCHAR(512),
  file_size        BIGINT,
  mime_type        VARCHAR(128),
  file_type        VARCHAR(32) NOT NULL CHECK (file_type IN ('image', 'video', 'audio', 'document', 'sticker', 'other')),
  width            INT,
  height           INT,
  duration         INT,
  display_order    INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Read receipts: whether the other side (or group members) have read the message.
CREATE TABLE IF NOT EXISTS messages.message_reads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      UUID NOT NULL REFERENCES messages.messages(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_by_sender  BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(message_id, user_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_groups_created_by ON messages.groups(created_by);
CREATE INDEX IF NOT EXISTS idx_groups_created_at ON messages.groups(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON messages.group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON messages.group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages.messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_id ON messages.messages(recipient_id);
CREATE INDEX IF NOT EXISTS idx_messages_group_id ON messages.messages(group_id);
CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages.messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_parent_id ON messages.messages(parent_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages.messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_unread_inbox ON messages.messages(recipient_id, is_read, created_at DESC) WHERE recipient_id IS NOT NULL AND is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_message_attachments_message_id ON messages.message_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_message_reads_message_id ON messages.message_reads(message_id);
CREATE INDEX IF NOT EXISTS idx_message_reads_user_id ON messages.message_reads(user_id);
CREATE INDEX IF NOT EXISTS idx_message_reads_read_at ON messages.message_reads(read_at DESC);

-- Align existing messages.messages (from full schema) with WhatsApp-style: nullable subject, sender_display_name
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'messages' AND table_name = 'messages') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'messages' AND table_name = 'messages' AND column_name = 'sender_display_name') THEN
      ALTER TABLE messages.messages ADD COLUMN sender_display_name VARCHAR(128);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'messages' AND table_name = 'messages' AND column_name = 'subject' AND is_nullable = 'NO') THEN
      ALTER TABLE messages.messages ALTER COLUMN subject DROP NOT NULL;
    END IF;
  END IF;
END $$;

COMMENT ON TABLE messages.messages IS 'WhatsApp-style: 1:1 (recipient_id) or group (group_id). content supports emoji; read state in message_reads. sender_display_name from auth.';
COMMENT ON COLUMN messages.messages.sender_display_name IS 'Denormalized from auth for display; can be synced from auth.users or profile.';
COMMENT ON TABLE messages.message_reads IS 'Per-recipient read receipt; read_by_sender = true when sender sees that recipient read it.';
