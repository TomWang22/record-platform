-- Social Service Database Schema
-- Run on PostgreSQL port 5433
-- Database: social (or records, depending on setup)
-- User: postgres / postgres (or configure as needed)

SET ROLE postgres;

-- Create schemas
CREATE SCHEMA IF NOT EXISTS forum;
CREATE SCHEMA IF NOT EXISTS messages;

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ============================================================
-- FORUM SCHEMA
-- ============================================================

-- Posts table
CREATE TABLE IF NOT EXISTS forum.posts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL, -- References auth.users(id) but cross-database, so no FK
  title         VARCHAR(512) NOT NULL,
  content       TEXT NOT NULL,
  flair         VARCHAR(64) NOT NULL DEFAULT 'Discussion',
  upvotes       INT NOT NULL DEFAULT 0,
  downvotes     INT NOT NULL DEFAULT 0,
  comment_count INT NOT NULL DEFAULT 0,
  is_pinned     BOOLEAN NOT NULL DEFAULT FALSE,
  is_locked     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Post attachments (images, videos, files)
CREATE TABLE IF NOT EXISTS forum.post_attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id       UUID NOT NULL REFERENCES forum.posts(id) ON DELETE CASCADE,
  file_url      TEXT NOT NULL,
  file_path     TEXT,
  thumbnail_url TEXT,
  file_name     VARCHAR(512),
  file_size     BIGINT,
  mime_type     VARCHAR(128),
  file_type     VARCHAR(32) NOT NULL CHECK (file_type IN ('image', 'video', 'audio', 'document', 'other')),
  width         INT, -- For images/videos
  height        INT, -- For images/videos
  duration      INT, -- For videos/audio (seconds)
  display_order INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Comment attachments (images, videos, files)
CREATE TABLE IF NOT EXISTS forum.comment_attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id    UUID NOT NULL REFERENCES forum.comments(id) ON DELETE CASCADE,
  file_url      TEXT NOT NULL,
  file_path     TEXT,
  thumbnail_url TEXT,
  file_name     VARCHAR(512),
  file_size     BIGINT,
  mime_type     VARCHAR(128),
  file_type     VARCHAR(32) NOT NULL CHECK (file_type IN ('image', 'video', 'audio', 'document', 'other')),
  width         INT,
  height        INT,
  duration      INT,
  display_order INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Comments table (nested replies via parent_id)
CREATE TABLE IF NOT EXISTS forum.comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID NOT NULL REFERENCES forum.posts(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL,
  parent_id  UUID REFERENCES forum.comments(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  upvotes    INT NOT NULL DEFAULT 0,
  downvotes  INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Post votes table
CREATE TABLE IF NOT EXISTS forum.post_votes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID NOT NULL REFERENCES forum.posts(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL,
  vote_type  VARCHAR(8) NOT NULL CHECK (vote_type IN ('up', 'down')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(post_id, user_id)
);

-- Comment votes table
CREATE TABLE IF NOT EXISTS forum.comment_votes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID NOT NULL REFERENCES forum.comments(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL,
  vote_type  VARCHAR(8) NOT NULL CHECK (vote_type IN ('up', 'down')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(comment_id, user_id)
);

-- ============================================================
-- MESSAGES SCHEMA
-- ============================================================

-- Groups table (for group messaging)
CREATE TABLE IF NOT EXISTS messages.groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(256) NOT NULL,
  description TEXT,
  created_by  UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Group members table
CREATE TABLE IF NOT EXISTS messages.group_members (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id  UUID NOT NULL REFERENCES messages.groups(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL,
  role      VARCHAR(16) NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'moderator', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(group_id, user_id)
);

-- Messages table (supports both direct and group messages)
CREATE TABLE IF NOT EXISTS messages.messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id        UUID NOT NULL,
  recipient_id     UUID, -- NULL if group message
  group_id         UUID REFERENCES messages.groups(id) ON DELETE CASCADE, -- NULL if direct message
  parent_message_id UUID REFERENCES messages.messages(id) ON DELETE SET NULL, -- for replies
  thread_id        UUID REFERENCES messages.messages(id) ON DELETE SET NULL, -- root message ID
  message_type     VARCHAR(32) NOT NULL DEFAULT 'General',
  subject          VARCHAR(512) NOT NULL,
  content          TEXT NOT NULL,
  is_read          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (recipient_id IS NOT NULL AND group_id IS NULL) OR
    (recipient_id IS NULL AND group_id IS NOT NULL)
  )
);

-- Message attachments (images, videos, files)
CREATE TABLE IF NOT EXISTS messages.message_attachments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id       UUID NOT NULL REFERENCES messages.messages(id) ON DELETE CASCADE,
  file_url         TEXT NOT NULL,
  file_path        TEXT,
  thumbnail_url    TEXT,
  file_name        VARCHAR(512),
  file_size        BIGINT,
  mime_type        VARCHAR(128),
  file_type        VARCHAR(32) NOT NULL CHECK (file_type IN ('image', 'video', 'audio', 'document', 'other')),
  width            INT, -- For images/videos
  height           INT, -- For images/videos
  duration         INT, -- For videos/audio (seconds)
  display_order    INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Message reads table (track read receipts - iOS Messages style)
CREATE TABLE IF NOT EXISTS messages.message_reads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      UUID NOT NULL REFERENCES messages.messages(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_by_sender  BOOLEAN NOT NULL DEFAULT FALSE, -- iOS-style: sender can see if recipient read it
  UNIQUE(message_id, user_id)
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Forum indexes
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON forum.posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_flair ON forum.posts(flair);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON forum.posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_pinned_created ON forum.posts(is_pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_upvotes_created ON forum.posts(upvotes DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_title_trgm ON forum.posts USING gin(title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_posts_content_trgm ON forum.posts USING gin(content gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_comments_post_id ON forum.comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_user_id ON forum.comments(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON forum.comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_created_at ON forum.comments(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_post_votes_post_id ON forum.post_votes(post_id);
CREATE INDEX IF NOT EXISTS idx_post_votes_user_id ON forum.post_votes(user_id);

CREATE INDEX IF NOT EXISTS idx_comment_votes_comment_id ON forum.comment_votes(comment_id);
CREATE INDEX IF NOT EXISTS idx_comment_votes_user_id ON forum.comment_votes(user_id);

-- Messages indexes
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
CREATE INDEX IF NOT EXISTS idx_messages_read_recipient ON messages.messages(is_read, recipient_id) WHERE recipient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_subject_trgm ON messages.messages USING gin(subject gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_messages_content_trgm ON messages.messages USING gin(content gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_message_reads_message_id ON messages.message_reads(message_id);
CREATE INDEX IF NOT EXISTS idx_message_reads_user_id ON messages.message_reads(user_id);
CREATE INDEX IF NOT EXISTS idx_message_reads_read_at ON messages.message_reads(read_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_reads_read_by_sender ON messages.message_reads(read_by_sender) WHERE read_by_sender = TRUE;

CREATE INDEX IF NOT EXISTS idx_message_attachments_message_id ON messages.message_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_message_attachments_file_type ON messages.message_attachments(file_type);
CREATE INDEX IF NOT EXISTS idx_message_attachments_display_order ON messages.message_attachments(message_id, display_order);

CREATE INDEX IF NOT EXISTS idx_post_attachments_post_id ON forum.post_attachments(post_id);
CREATE INDEX IF NOT EXISTS idx_post_attachments_file_type ON forum.post_attachments(file_type);
CREATE INDEX IF NOT EXISTS idx_post_attachments_display_order ON forum.post_attachments(post_id, display_order);

CREATE INDEX IF NOT EXISTS idx_comment_attachments_comment_id ON forum.comment_attachments(comment_id);
CREATE INDEX IF NOT EXISTS idx_comment_attachments_file_type ON forum.comment_attachments(file_type);
CREATE INDEX IF NOT EXISTS idx_comment_attachments_display_order ON forum.comment_attachments(comment_id, display_order);

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Update updated_at trigger function
CREATE OR REPLACE FUNCTION forum.touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION messages.touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS trg_posts_touch ON forum.posts;
CREATE TRIGGER trg_posts_touch
  BEFORE UPDATE ON forum.posts
  FOR EACH ROW
  EXECUTE FUNCTION forum.touch_updated_at();

DROP TRIGGER IF EXISTS trg_comments_touch ON forum.comments;
CREATE TRIGGER trg_comments_touch
  BEFORE UPDATE ON forum.comments
  FOR EACH ROW
  EXECUTE FUNCTION forum.touch_updated_at();

DROP TRIGGER IF EXISTS trg_groups_touch ON messages.groups;
CREATE TRIGGER trg_groups_touch
  BEFORE UPDATE ON messages.groups
  FOR EACH ROW
  EXECUTE FUNCTION messages.touch_updated_at();

DROP TRIGGER IF EXISTS trg_messages_touch ON messages.messages;
CREATE TRIGGER trg_messages_touch
  BEFORE UPDATE ON messages.messages
  FOR EACH ROW
  EXECUTE FUNCTION messages.touch_updated_at();

-- Function to update comment_count on posts
CREATE OR REPLACE FUNCTION forum.update_comment_count() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE forum.posts SET comment_count = comment_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE forum.posts SET comment_count = GREATEST(0, comment_count - 1) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_comments_count ON forum.comments;
CREATE TRIGGER trg_comments_count
  AFTER INSERT OR DELETE ON forum.comments
  FOR EACH ROW
  EXECUTE FUNCTION forum.update_comment_count();

-- Function to update vote counts on posts
CREATE OR REPLACE FUNCTION forum.update_post_votes() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.vote_type = 'up' THEN
      UPDATE forum.posts SET upvotes = upvotes + 1 WHERE id = NEW.post_id;
    ELSE
      UPDATE forum.posts SET downvotes = downvotes + 1 WHERE id = NEW.post_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.vote_type = 'up' THEN
      UPDATE forum.posts SET upvotes = GREATEST(0, upvotes - 1) WHERE id = OLD.post_id;
    ELSE
      UPDATE forum.posts SET downvotes = GREATEST(0, downvotes - 1) WHERE id = OLD.post_id;
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Handle vote change (up -> down or down -> up)
    IF OLD.vote_type = 'up' AND NEW.vote_type = 'down' THEN
      UPDATE forum.posts SET upvotes = GREATEST(0, upvotes - 1), downvotes = downvotes + 1 WHERE id = NEW.post_id;
    ELSIF OLD.vote_type = 'down' AND NEW.vote_type = 'up' THEN
      UPDATE forum.posts SET downvotes = GREATEST(0, downvotes - 1), upvotes = upvotes + 1 WHERE id = NEW.post_id;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_post_votes_update ON forum.post_votes;
CREATE TRIGGER trg_post_votes_update
  AFTER INSERT OR UPDATE OR DELETE ON forum.post_votes
  FOR EACH ROW
  EXECUTE FUNCTION forum.update_post_votes();

-- Function to update vote counts on comments
CREATE OR REPLACE FUNCTION forum.update_comment_votes() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.vote_type = 'up' THEN
      UPDATE forum.comments SET upvotes = upvotes + 1 WHERE id = NEW.comment_id;
    ELSE
      UPDATE forum.comments SET downvotes = downvotes + 1 WHERE id = NEW.comment_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.vote_type = 'up' THEN
      UPDATE forum.comments SET upvotes = GREATEST(0, upvotes - 1) WHERE id = OLD.comment_id;
    ELSE
      UPDATE forum.comments SET downvotes = GREATEST(0, downvotes - 1) WHERE id = OLD.comment_id;
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.vote_type = 'up' AND NEW.vote_type = 'down' THEN
      UPDATE forum.comments SET upvotes = GREATEST(0, upvotes - 1), downvotes = downvotes + 1 WHERE id = NEW.comment_id;
    ELSIF OLD.vote_type = 'down' AND NEW.vote_type = 'up' THEN
      UPDATE forum.comments SET downvotes = GREATEST(0, downvotes - 1), upvotes = upvotes + 1 WHERE id = NEW.comment_id;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_comment_votes_update ON forum.comment_votes;
CREATE TRIGGER trg_comment_votes_update
  AFTER INSERT OR UPDATE OR DELETE ON forum.comment_votes
  FOR EACH ROW
  EXECUTE FUNCTION forum.update_comment_votes();

-- Function to set thread_id on message creation
CREATE OR REPLACE FUNCTION messages.set_thread_id() RETURNS trigger AS $$
BEGIN
  -- If this is a reply, set thread_id to the parent's thread_id (or parent's id if parent has no thread_id)
  IF NEW.parent_message_id IS NOT NULL THEN
    SELECT COALESCE(thread_id, id) INTO NEW.thread_id
    FROM messages.messages
    WHERE id = NEW.parent_message_id;
  ELSE
    -- If this is a new message, thread_id is its own id
    NEW.thread_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_messages_thread_id ON messages.messages;
CREATE TRIGGER trg_messages_thread_id
  BEFORE INSERT ON messages.messages
  FOR EACH ROW
  EXECUTE FUNCTION messages.set_thread_id();

-- Function to update is_read when message_reads is inserted
CREATE OR REPLACE FUNCTION messages.update_message_read() RETURNS trigger AS $$
BEGIN
  UPDATE messages.messages
  SET is_read = TRUE
  WHERE id = NEW.message_id AND (recipient_id = NEW.user_id OR group_id IS NOT NULL);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_message_reads_update ON messages.message_reads;
CREATE TRIGGER trg_message_reads_update
  AFTER INSERT ON messages.message_reads
  FOR EACH ROW
  EXECUTE FUNCTION messages.update_message_read();

-- Grant permissions (adjust user as needed)
-- GRANT USAGE ON SCHEMA forum TO record_app;
-- GRANT USAGE ON SCHEMA messages TO record_app;
-- GRANT ALL ON ALL TABLES IN SCHEMA forum TO record_app;
-- GRANT ALL ON ALL TABLES IN SCHEMA messages TO record_app;
-- GRANT ALL ON ALL SEQUENCES IN SCHEMA forum TO record_app;
-- GRANT ALL ON ALL SEQUENCES IN SCHEMA messages TO record_app;

