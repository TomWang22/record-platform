-- Social Service: Add 'owner' role + WhatsApp-style read receipts & timestamps
-- Owner = creator of group; admin = promoted; moderator = can moderate; member = standard
-- Run on social DB (port 5434)
-- Schema already has: messages.is_read, message_reads.read_at, read_by_sender (iOS/WhatsApp style)

SET ROLE postgres;

-- 1. Owner role for group_members
ALTER TABLE messages.group_members DROP CONSTRAINT IF EXISTS group_members_role_check;
ALTER TABLE messages.group_members ADD CONSTRAINT group_members_role_check
  CHECK (role IN ('owner', 'admin', 'moderator', 'member'));

UPDATE messages.group_members gm
SET role = 'owner'
FROM messages.groups g
WHERE gm.group_id = g.id
  AND gm.user_id = g.created_by
  AND gm.role = 'admin';

-- 2. WhatsApp-style: ensure created_at/updated_at exist (schema has them; add if missing for older DBs)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='messages' AND table_name='messages' AND column_name='created_at') THEN
    ALTER TABLE messages.messages ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='messages' AND table_name='messages' AND column_name='updated_at') THEN
    ALTER TABLE messages.messages ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='messages' AND table_name='messages' AND column_name='is_read') THEN
    ALTER TABLE messages.messages ADD COLUMN is_read BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;

-- 3. Indexes for WhatsApp-style read receipts & timestamp ordering
CREATE INDEX IF NOT EXISTS idx_messages_is_read_created ON messages.messages(is_read, created_at DESC) WHERE recipient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_unread_inbox ON messages.messages(recipient_id, is_read, created_at DESC) WHERE recipient_id IS NOT NULL AND is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_message_reads_read_at ON messages.message_reads(read_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_reads_user_read_at ON messages.message_reads(user_id, read_at DESC);
