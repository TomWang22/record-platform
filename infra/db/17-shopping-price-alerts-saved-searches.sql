-- Shopping: price alerts, saved searches (with notify), discount codes, bundle shipping offers.
-- Run on port 5436 (shopping DB).

-- Price alerts: notify user when listing price drops to target
CREATE TABLE IF NOT EXISTS shopping.price_alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,
  listing_id   UUID NOT NULL,
  target_price NUMERIC(12,2) NOT NULL,
  currency     VARCHAR(3) NOT NULL DEFAULT 'USD',
  notified_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, listing_id)
);
CREATE INDEX IF NOT EXISTS idx_price_alerts_user ON shopping.price_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_price_alerts_listing ON shopping.price_alerts(listing_id);
CREATE INDEX IF NOT EXISTS idx_price_alerts_unnotified ON shopping.price_alerts(notified_at) WHERE notified_at IS NULL;

-- Saved searches: notify when new listings match
CREATE TABLE IF NOT EXISTS shopping.saved_searches (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL,
  name           VARCHAR(128),
  query          TEXT NOT NULL,
  filters        JSONB,
  notify_on_new  BOOLEAN NOT NULL DEFAULT FALSE,
  last_run_at    TIMESTAMPTZ,
  last_result_count INT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON shopping.saved_searches(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_searches_notify ON shopping.saved_searches(notify_on_new, last_run_at) WHERE notify_on_new = TRUE;

-- Discount codes (percent or fixed; applied at checkout)
CREATE TABLE IF NOT EXISTS shopping.discount_codes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code         VARCHAR(64) NOT NULL UNIQUE,
  type         VARCHAR(16) NOT NULL CHECK (type IN ('percent', 'fixed')),
  value        NUMERIC(12,2) NOT NULL,
  min_order    NUMERIC(12,2) DEFAULT 0,
  currency     VARCHAR(3) DEFAULT 'USD',
  valid_from   TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until  TIMESTAMPTZ,
  usage_limit  INT,
  usage_count  INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_discount_codes_code ON shopping.discount_codes(code);
CREATE INDEX IF NOT EXISTS idx_discount_codes_valid ON shopping.discount_codes(valid_from, valid_until);

-- Bundle shipping: e.g. free shipping when 2+ items from same seller
CREATE TABLE IF NOT EXISTS shopping.bundle_shipping_offers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id           UUID NOT NULL,
  rule_type           VARCHAR(32) NOT NULL DEFAULT 'same_seller', -- 'same_seller', 'bundle_id'
  min_items           INT NOT NULL DEFAULT 2,
  shipping_discount   VARCHAR(32) NOT NULL DEFAULT 'free',       -- 'free', 'fixed_amount'
  fixed_amount       NUMERIC(10,2),
  currency            VARCHAR(3) DEFAULT 'USD',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bundle_shipping_seller ON shopping.bundle_shipping_offers(seller_id);

COMMENT ON TABLE shopping.price_alerts IS 'Notify user when listing price drops to target_price';
COMMENT ON TABLE shopping.saved_searches IS 'Saved search; notify_on_new = true triggers notification when new listings match';
COMMENT ON TABLE shopping.discount_codes IS 'Codes applied at checkout (percent or fixed off order)';
COMMENT ON TABLE shopping.bundle_shipping_offers IS 'Seller-defined bundle shipping (e.g. free shipping over N items)';
