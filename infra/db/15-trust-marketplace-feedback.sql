-- Record Platform marketplace feedback (trust DB). Idempotent.
CREATE SCHEMA IF NOT EXISTS trust;

CREATE TABLE IF NOT EXISTS trust.marketplace_transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id       UUID NOT NULL,
  seller_user_id   UUID NOT NULL,
  buyer_user_id    UUID NOT NULL,
  status           VARCHAR(16) NOT NULL DEFAULT 'completed'
    CHECK (status IN ('pending', 'completed', 'cancelled')),
  completed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_transactions_seller
  ON trust.marketplace_transactions (seller_user_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketplace_transactions_buyer
  ON trust.marketplace_transactions (buyer_user_id, completed_at DESC);

CREATE TABLE IF NOT EXISTS trust.marketplace_feedback (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_user_id   UUID NOT NULL,
  buyer_user_id    UUID NOT NULL,
  listing_id       UUID NOT NULL,
  order_id         UUID,
  transaction_id   UUID NOT NULL REFERENCES trust.marketplace_transactions(id) ON DELETE CASCADE,
  rating           SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment          TEXT,
  role             VARCHAR(32) NOT NULL
    CHECK (role IN ('buyer_to_seller', 'seller_to_buyer')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transaction_id, role)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_feedback_seller
  ON trust.marketplace_feedback (seller_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketplace_feedback_buyer
  ON trust.marketplace_feedback (buyer_user_id, created_at DESC);
