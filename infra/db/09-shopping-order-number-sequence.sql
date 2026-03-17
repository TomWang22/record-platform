-- Shopping: order number via sequence (no advisory lock, no MAX scan)
-- Run on shopping DB (port 5436). Fixes checkout timeouts under pgbench (many clients).
SET ROLE postgres;

-- Sequence for order numbers (one sequence; year in prefix so ORD-YYYY-NNNNNN)
CREATE SEQUENCE IF NOT EXISTS shopping.order_number_seq START 1;

-- If orders already exist, set sequence so next nextval is above max (never decrease).
-- setval(0) is invalid (min 1); use GREATEST(1, ...) so empty DB works.
DO $$
DECLARE
  max_num bigint;
  seq_val bigint;
  next_val bigint;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(order_number FROM 'ORD-[0-9]{4}-([0-9]+)') AS BIGINT)), 0) + 1
  INTO max_num
  FROM shopping.orders
  WHERE order_number ~ '^ORD-[0-9]{4}-[0-9]+$';
  SELECT COALESCE((SELECT last_value FROM pg_sequences WHERE schemaname = 'shopping' AND sequencename = 'order_number_seq'), 0)::bigint INTO seq_val;
  next_val := GREATEST(1, seq_val, max_num - 1);
  PERFORM setval('shopping.order_number_seq', next_val);
END $$;

-- Replace generate_order_number with sequence-based implementation (fast, no lock contention)
CREATE OR REPLACE FUNCTION shopping.generate_order_number()
RETURNS TEXT AS $$
BEGIN
  RETURN 'ORD-' || TO_CHAR(now(), 'YYYY') || '-' || LPAD(nextval('shopping.order_number_seq')::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION shopping.generate_order_number() IS 'Sequence-based order number; no advisory lock or MAX scan. Run 09-shopping-order-number-sequence.sql if checkout times out under load.';

-- Re-sync sequence to at least current max; never decrease (idempotent, safe when migration/ensure run in parallel or multiple times).
-- setval(0) is invalid; use GREATEST(1, ...).
DO $$
DECLARE
  cur_max bigint;
  seq_val bigint;
  next_val bigint;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(order_number FROM 'ORD-[0-9]{4}-([0-9]+)') AS BIGINT)), 0)
  INTO cur_max
  FROM shopping.orders
  WHERE order_number ~ '^ORD-[0-9]{4}-[0-9]+$';
  SELECT COALESCE((SELECT last_value FROM pg_sequences WHERE schemaname = 'shopping' AND sequencename = 'order_number_seq'), 0)::bigint INTO seq_val;
  next_val := GREATEST(1, seq_val, cur_max);
  PERFORM setval('shopping.order_number_seq', next_val);
END $$;
