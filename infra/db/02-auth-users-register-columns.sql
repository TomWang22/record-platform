-- Align auth.users with auth-service Register gRPC (username, soft-delete).
CREATE EXTENSION IF NOT EXISTS citext;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS deletion_state VARCHAR(32) NOT NULL DEFAULT 'active';
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS display_username VARCHAR(128);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS username CITEXT;
