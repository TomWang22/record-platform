-- Migration: Add upload_type column to forum.posts
-- Run on PostgreSQL port 5434 (social database)

SET ROLE postgres;

-- Add upload_type column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'forum' AND table_name = 'posts' AND column_name = 'upload_type') THEN
    ALTER TABLE forum.posts ADD COLUMN upload_type VARCHAR(32) NOT NULL DEFAULT 'text';
    ALTER TABLE forum.posts ADD CONSTRAINT chk_upload_type CHECK (upload_type IN ('text', 'image', 'video', 'link', 'poll'));
  END IF;
END $$;

-- Add index for upload_type
CREATE INDEX IF NOT EXISTS idx_posts_upload_type ON forum.posts(upload_type);

COMMENT ON COLUMN forum.posts.upload_type IS 'Type of post: text, image, video, link, or poll';

-- GRANTS (ensure postgres user has privileges)
GRANT ALL PRIVILEGES ON SCHEMA forum TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA forum TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA forum TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA forum GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA forum GRANT ALL ON SEQUENCES TO postgres;

