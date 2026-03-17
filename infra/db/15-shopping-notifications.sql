-- Notifications table: in-app messages (e.g. "Item removed from cart - out of stock").
-- When user A checks out, user B (who had the same item in cart) gets the item removed and a notification
-- so they don't have to remove it manually. Run on port 5436 (shopping DB).

CREATE TABLE IF NOT EXISTS shopping.notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL,
  type       VARCHAR(64) NOT NULL,   -- 'cart_item_removed', 'order_shipped', 'price_alert', etc.
  title      VARCHAR(256) NOT NULL,
  body       TEXT,
  payload    JSONB,                  -- e.g. { item_id, listing_id, reason: 'out_of_stock' }
  read_at    TIMESTAMPTZ,            -- NULL = unread
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON shopping.notifications (user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON shopping.notifications (user_id, created_at DESC);

COMMENT ON TABLE shopping.notifications IS 'In-app notifications; e.g. cart item removed because another user bought it (out of stock).';
