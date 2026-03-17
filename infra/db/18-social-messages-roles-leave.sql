-- Social/messages: group member roles (admin, contributor, read_only), leave (left_at).
-- Run on port 5434 (social DB). message_reads already gives "who read" per message.

-- Extend group_members.role to include contributor, read_only (role mutation)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'messages' AND table_name = 'group_members') THEN
    ALTER TABLE messages.group_members DROP CONSTRAINT IF EXISTS group_members_role_check;
    ALTER TABLE messages.group_members ADD CONSTRAINT group_members_role_check
      CHECK (role IN ('owner', 'admin', 'moderator', 'contributor', 'member', 'read_only'));
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- When user leaves group: left_at set; they no longer see as active member
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'messages' AND table_name = 'group_members' AND column_name = 'left_at') THEN
    ALTER TABLE messages.group_members ADD COLUMN left_at TIMESTAMPTZ;
    COMMENT ON COLUMN messages.group_members.left_at IS 'When user left; NULL = still in group. Re-join = new row or left_at cleared per policy';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_group_members_left ON messages.group_members(group_id, left_at) WHERE left_at IS NULL;

-- Who read: message_reads (message_id, user_id, read_at) already exists; use for group "read by" highlight
