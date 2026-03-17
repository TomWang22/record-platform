-- Feedback / Review schema (eBay-style: both seller and buyer, roles can interchange).
-- Run on port 5436 (shopping DB). user_id is from auth (no FK cross-DB).
-- Idempotent.

DO $$ BEGIN CREATE EXTENSION IF NOT EXISTS pg_trgm; EXCEPTION WHEN OTHERS THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS feedback;

-- User profile (display name, bio, collection visibility)
-- user_id comes from auth; display_name can be changed by user
CREATE TABLE IF NOT EXISTS feedback.user_profiles (
  user_id         UUID PRIMARY KEY,  -- from auth.users(id)
  display_name    VARCHAR(128) NOT NULL DEFAULT 'User',
  bio             TEXT,
  collection_visible BOOLEAN NOT NULL DEFAULT FALSE,  -- privacy: show record count or not
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_display_name
  ON feedback.user_profiles USING gin (display_name gin_trgm_ops);

-- Activity history (account creation, key actions)
CREATE TABLE IF NOT EXISTS feedback.user_activity (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL,
  activity_type VARCHAR(64) NOT NULL,  -- 'account_created', 'first_listing', 'first_purchase', etc.
  payload      JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_activity_user_time
  ON feedback.user_activity (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_type
  ON feedback.user_activity (activity_type, created_at DESC);

-- Collection size (denormalized for privacy toggle; sync from records count or cache)
CREATE TABLE IF NOT EXISTS feedback.collection_stats (
  user_id        UUID PRIMARY KEY,
  record_count   INTEGER NOT NULL DEFAULT 0,
  visible        BOOLEAN NOT NULL DEFAULT FALSE,  -- same as user_profiles.collection_visible
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reviews: both sides (seller and buyer); role can interchange per transaction
CREATE TABLE IF NOT EXISTS feedback.reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_id     UUID NOT NULL,   -- who left the review
  reviewee_id     UUID NOT NULL,   -- who received the review
  role            VARCHAR(16) NOT NULL,  -- 'seller' | 'buyer' (reviewer's role in that transaction)
  transaction_id  UUID,            -- order_id or purchase_id for context
  rating          SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (reviewer_id, reviewee_id, transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_reviewee_rating
  ON feedback.reviews (reviewee_id, rating DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer
  ON feedback.reviews (reviewer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_transaction
  ON feedback.reviews (transaction_id) WHERE transaction_id IS NOT NULL;

-- Trigger to keep updated_at
CREATE OR REPLACE FUNCTION feedback.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_profiles_updated ON feedback.user_profiles;
CREATE TRIGGER trg_user_profiles_updated
  BEFORE UPDATE ON feedback.user_profiles
  FOR EACH ROW EXECUTE FUNCTION feedback.touch_updated_at();

