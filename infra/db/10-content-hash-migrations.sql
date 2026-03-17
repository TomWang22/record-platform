-- Content hash columns for long text: fast equality/dedup lookups while keeping human-readable content.
-- Use hashtext() for speed; index the hash for WHERE content_hash = $1. Original TEXT stays for display.
-- Apply to: social (forum, messages), shopping (notes), records (notes). Python-ai already has query_hash.
-- Safe to run on any DB: each block checks schema/table/column existence.

-- ============================================================
-- SOCIAL: forum.posts, forum.comments (run on social DB only or when forum/messages exist)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'forum' AND table_name = 'posts') AND
     NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'forum' AND table_name = 'posts' AND column_name = 'content_hash') THEN
    ALTER TABLE forum.posts ADD COLUMN content_hash integer;
    UPDATE forum.posts SET content_hash = hashtext(COALESCE(content, '')) WHERE content_hash IS NULL;
    CREATE INDEX IF NOT EXISTS idx_posts_content_hash ON forum.posts(content_hash) WHERE content_hash IS NOT NULL;
    COMMENT ON COLUMN forum.posts.content_hash IS 'Hash of content for fast equality/dedup; content remains for display';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'forum' AND table_name = 'comments' AND column_name = 'content_hash') THEN
    ALTER TABLE forum.comments ADD COLUMN content_hash integer;
    UPDATE forum.comments SET content_hash = hashtext(COALESCE(content, '')) WHERE content_hash IS NULL;
    CREATE INDEX IF NOT EXISTS idx_comments_content_hash ON forum.comments(content_hash) WHERE content_hash IS NOT NULL;
    COMMENT ON COLUMN forum.comments.content_hash IS 'Hash of content for fast equality/dedup; content remains for display';
  END IF;
END $$;

-- ============================================================
-- SOCIAL: messages.messages (content + subject)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'messages' AND table_name = 'messages' AND column_name = 'content_hash') THEN
    ALTER TABLE messages.messages ADD COLUMN content_hash integer;
    UPDATE messages.messages SET content_hash = hashtext(COALESCE(content, '')) WHERE content_hash IS NULL;
    CREATE INDEX IF NOT EXISTS idx_messages_content_hash ON messages.messages(content_hash) WHERE content_hash IS NOT NULL;
    COMMENT ON COLUMN messages.messages.content_hash IS 'Hash of content for fast equality/dedup; content remains for display';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'messages' AND table_name = 'messages' AND column_name = 'subject_hash') THEN
    ALTER TABLE messages.messages ADD COLUMN subject_hash integer;
    UPDATE messages.messages SET subject_hash = hashtext(COALESCE(subject, '')) WHERE subject_hash IS NULL;
    CREATE INDEX IF NOT EXISTS idx_messages_subject_hash ON messages.messages(subject_hash) WHERE subject_hash IS NOT NULL;
    COMMENT ON COLUMN messages.messages.subject_hash IS 'Hash of subject for fast lookup; subject remains for display';
  END IF;
END $$;

-- ============================================================
-- SHOPPING: wishlist.notes (long user notes)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'shopping' AND table_name = 'wishlist' AND column_name = 'notes_hash') THEN
    ALTER TABLE shopping.wishlist ADD COLUMN notes_hash integer;
    UPDATE shopping.wishlist SET notes_hash = hashtext(COALESCE(notes, '')) WHERE notes IS NOT NULL AND notes_hash IS NULL;
    CREATE INDEX IF NOT EXISTS idx_wishlist_notes_hash ON shopping.wishlist(notes_hash) WHERE notes_hash IS NOT NULL;
    COMMENT ON COLUMN shopping.wishlist.notes_hash IS 'Hash of notes for fast equality; notes remains for display';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'shopping' AND table_name = 'shopping_cart' AND column_name = 'notes_hash') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'shopping' AND table_name = 'shopping_cart' AND column_name = 'notes') THEN
      ALTER TABLE shopping.shopping_cart ADD COLUMN notes_hash integer;
      UPDATE shopping.shopping_cart SET notes_hash = hashtext(COALESCE(notes, '')) WHERE notes IS NOT NULL AND notes_hash IS NULL;
      CREATE INDEX IF NOT EXISTS idx_shopping_cart_notes_hash ON shopping.shopping_cart(notes_hash) WHERE notes_hash IS NOT NULL;
      COMMENT ON COLUMN shopping.shopping_cart.notes_hash IS 'Hash of notes for fast equality; notes remains for display';
    END IF;
  END IF;
END $$;

-- ============================================================
-- RECORDS: notes (optional; records.records.notes can be long)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'records' AND table_name = 'records' AND column_name = 'notes_hash') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'records' AND table_name = 'records' AND column_name = 'notes') THEN
      ALTER TABLE records.records ADD COLUMN notes_hash integer;
      UPDATE records.records SET notes_hash = hashtext(COALESCE(notes, '')) WHERE notes IS NOT NULL AND notes_hash IS NULL;
      CREATE INDEX IF NOT EXISTS idx_records_notes_hash ON records.records(notes_hash) WHERE notes_hash IS NOT NULL;
      COMMENT ON COLUMN records.records.notes_hash IS 'Hash of notes for fast equality; notes remains for display';
    END IF;
  END IF;
END $$;

-- ============================================================
-- TRIGGERS: keep hash columns in sync on INSERT/UPDATE (only when table exists)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'forum' AND table_name = 'posts') AND
     EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'forum' AND table_name = 'posts' AND column_name = 'content_hash') THEN
    CREATE OR REPLACE FUNCTION forum.sync_content_hash_posts() RETURNS trigger AS $f$
    BEGIN
      NEW.content_hash := hashtext(COALESCE(NEW.content, ''));
      RETURN NEW;
    END; $f$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS trg_posts_content_hash ON forum.posts;
    CREATE TRIGGER trg_posts_content_hash BEFORE INSERT OR UPDATE OF content ON forum.posts
      FOR EACH ROW EXECUTE FUNCTION forum.sync_content_hash_posts();
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'forum' AND table_name = 'comments') AND
     EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'forum' AND table_name = 'comments' AND column_name = 'content_hash') THEN
    CREATE OR REPLACE FUNCTION forum.sync_content_hash_comments() RETURNS trigger AS $f$
    BEGIN
      NEW.content_hash := hashtext(COALESCE(NEW.content, ''));
      RETURN NEW;
    END; $f$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS trg_comments_content_hash ON forum.comments;
    CREATE TRIGGER trg_comments_content_hash BEFORE INSERT OR UPDATE OF content ON forum.comments
      FOR EACH ROW EXECUTE FUNCTION forum.sync_content_hash_comments();
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'messages' AND table_name = 'messages') AND
     EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'messages' AND table_name = 'messages' AND column_name = 'content_hash') THEN
    CREATE OR REPLACE FUNCTION messages.sync_message_hashes() RETURNS trigger AS $f$
    BEGIN
      NEW.content_hash := hashtext(COALESCE(NEW.content, ''));
      NEW.subject_hash := hashtext(COALESCE(NEW.subject, ''));
      RETURN NEW;
    END; $f$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS trg_messages_hashes ON messages.messages;
    CREATE TRIGGER trg_messages_hashes BEFORE INSERT OR UPDATE OF content, subject ON messages.messages
      FOR EACH ROW EXECUTE FUNCTION messages.sync_message_hashes();
  END IF;
END $$;

-- ============================================================
-- TRIGGERS: shopping.wishlist.notes_hash, shopping.shopping_cart.notes_hash
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'shopping' AND table_name = 'wishlist' AND column_name = 'notes_hash') THEN
    CREATE OR REPLACE FUNCTION shopping.sync_wishlist_notes_hash() RETURNS trigger AS $f$
    BEGIN
      NEW.notes_hash := hashtext(COALESCE(NEW.notes, ''));
      RETURN NEW;
    END; $f$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS trg_wishlist_notes_hash ON shopping.wishlist;
    CREATE TRIGGER trg_wishlist_notes_hash BEFORE INSERT OR UPDATE OF notes ON shopping.wishlist
      FOR EACH ROW EXECUTE FUNCTION shopping.sync_wishlist_notes_hash();
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'shopping' AND table_name = 'shopping_cart' AND column_name = 'notes_hash') THEN
    CREATE OR REPLACE FUNCTION shopping.sync_cart_notes_hash() RETURNS trigger AS $f$
    BEGIN
      NEW.notes_hash := hashtext(COALESCE(NEW.notes, ''));
      RETURN NEW;
    END; $f$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS trg_cart_notes_hash ON shopping.shopping_cart;
    CREATE TRIGGER trg_cart_notes_hash BEFORE INSERT OR UPDATE OF notes ON shopping.shopping_cart
      FOR EACH ROW EXECUTE FUNCTION shopping.sync_cart_notes_hash();
  END IF;
END $$;

-- ============================================================
-- TRIGGERS: records.records.notes_hash
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'records' AND table_name = 'records' AND column_name = 'notes_hash') THEN
    CREATE OR REPLACE FUNCTION records.sync_records_notes_hash() RETURNS trigger AS $f$
    BEGIN
      NEW.notes_hash := hashtext(COALESCE(NEW.notes, ''));
      RETURN NEW;
    END; $f$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS trg_records_notes_hash ON records.records;
    CREATE TRIGGER trg_records_notes_hash BEFORE INSERT OR UPDATE OF notes ON records.records
      FOR EACH ROW EXECUTE FUNCTION records.sync_records_notes_hash();
  END IF;
END $$;
