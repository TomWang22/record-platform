-- Shopping cart: computed cost (line total and cart subtotal) for display and checkout.
-- Run on port 5436 (shopping DB). Tax and shipping are computed at checkout from ship_to_country
-- (auth.user_addresses or shopping.cart_session override); see 08-shopping-cart-tax-shipping.sql.

-- View: per-user cart summary (item count and subtotal). Use for cart total display.
CREATE OR REPLACE VIEW shopping.cart_summary AS
SELECT
  user_id,
  COUNT(*)::integer AS line_count,
  COALESCE(SUM((quantity * COALESCE(price, 0))::numeric(12,2)), 0) AS subtotal
FROM shopping.shopping_cart
GROUP BY user_id;

COMMENT ON VIEW shopping.cart_summary IS 'Cart subtotal and line count per user. Tax/shipping from ship_to_country at checkout (auth or cart_session).';

-- Optional: per-line line total for reporting/display (read-only view over cart rows)
CREATE OR REPLACE VIEW shopping.cart_lines_with_total AS
SELECT
  id,
  user_id,
  listing_id,
  item_type,
  item_id,
  quantity,
  price,
  (quantity * COALESCE(price, 0))::numeric(12,2) AS line_total,
  metadata,
  created_at,
  updated_at
FROM shopping.shopping_cart;

COMMENT ON VIEW shopping.cart_lines_with_total IS 'Cart rows with computed line_total = quantity * price for cost display.';
