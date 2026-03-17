-- Shopping cart: ship-to country for tax and shipping (driven by auth user address).
-- Run on port 5436 (shopping DB). One row per user: ship_to override; tax/shipping computed at checkout.

CREATE TABLE IF NOT EXISTS shopping.cart_session (
  user_id         UUID PRIMARY KEY,
  ship_to_country CHAR(2),       -- Override; if NULL, use auth user default address country
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE shopping.cart_session IS 'Per-user cart ship-to; tax rate and shipping cost derived at checkout from country (Auth address or this override).';

-- Orders: ensure we have ship_to_country for reporting (orders already have shipping_cost, tax, total)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'shopping' AND table_name = 'orders' AND column_name = 'ship_to_country') THEN
    ALTER TABLE shopping.orders ADD COLUMN ship_to_country CHAR(2);
    COMMENT ON COLUMN shopping.orders.ship_to_country IS 'Country order was shipped to (from auth user address or override); drives tax/shipping applied';
  END IF;
END $$;
