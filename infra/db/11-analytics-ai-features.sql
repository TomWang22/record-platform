-- T15.4A — Durable analytics AI feature rows (source_refs required).
-- Run against analytics DB (port 5447).

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS analytics.ai_user_features (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL,
  feature_group TEXT NOT NULL
    CHECK (feature_group IN (
      'obo', 'auction', 'sales', 'purchases',
      'watchlist', 'recently_viewed', 'listing_revisions'
    )),
  metrics       JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_refs   JSONB NOT NULL DEFAULT '[]'::jsonb,
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, feature_group)
);

CREATE INDEX IF NOT EXISTS idx_ai_user_features_user
  ON analytics.ai_user_features (user_id, computed_at DESC);

COMMENT ON TABLE analytics.ai_user_features IS 'Owner-scoped cleaned features for python-ai retrieval; every row traces to DB sources via source_refs.';
