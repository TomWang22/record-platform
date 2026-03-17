-- Shopping Service Migration: Add Orders Table
-- Run on PostgreSQL port 5436 (shopping database)

SET ROLE postgres;

-- Orders table for managing checkout and purchases
CREATE TABLE IF NOT EXISTS shopping.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  order_number VARCHAR(64) UNIQUE NOT NULL, -- Human-readable order number (e.g., ORD-2024-001234)
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'cancelled', 'refunded'
  payment_status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'paid', 'failed', 'refunded'
  payment_method TEXT, -- 'credit_card', 'paypal', 'simulated', etc.
  payment_transaction_id TEXT, -- External payment transaction ID
  subtotal DECIMAL(10, 2) NOT NULL DEFAULT 0,
  shipping_cost DECIMAL(10, 2) NOT NULL DEFAULT 0,
  tax DECIMAL(10, 2) NOT NULL DEFAULT 0,
  total DECIMAL(10, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  shipping_address JSONB, -- Full shipping address
  billing_address JSONB, -- Full billing address
  notes TEXT, -- Order notes
  metadata JSONB, -- Additional order data
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ, -- When order was completed
  cancelled_at TIMESTAMPTZ -- When order was cancelled
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON shopping.orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON shopping.orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_status ON shopping.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON shopping.orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON shopping.orders(created_at DESC);

-- Function to generate order number
CREATE OR REPLACE FUNCTION shopping.generate_order_number()
RETURNS TEXT AS $$
DECLARE
  order_num TEXT;
  year_part TEXT;
  seq_num INTEGER;
BEGIN
  year_part := TO_CHAR(now(), 'YYYY');
  
  -- Get next sequence number for this year
  SELECT COALESCE(MAX(CAST(SUBSTRING(order_number FROM 'ORD-\d{4}-(\d+)') AS INTEGER)), 0) + 1
  INTO seq_num
  FROM shopping.orders
  WHERE order_number LIKE 'ORD-' || year_part || '-%';
  
  order_num := 'ORD-' || year_part || '-' || LPAD(seq_num::TEXT, 6, '0');
  RETURN order_num;
END;
$$ LANGUAGE plpgsql;

-- Add updated_at trigger for orders
DROP TRIGGER IF EXISTS trigger_orders_updated_at ON shopping.orders;
CREATE TRIGGER trigger_orders_updated_at
  BEFORE UPDATE ON shopping.orders
  FOR EACH ROW
  EXECUTE FUNCTION shopping.update_updated_at();

-- Add resellable flag to purchase_history (for eBay-style reselling)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'shopping' AND table_name = 'purchase_history' AND column_name = 'resellable') THEN
    ALTER TABLE shopping.purchase_history ADD COLUMN resellable BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_purchase_history_resellable ON shopping.purchase_history(user_id, resellable) WHERE resellable = TRUE;

COMMENT ON TABLE shopping.orders IS 'Orders table for managing checkout and purchases';
COMMENT ON COLUMN shopping.orders.order_number IS 'Human-readable order number (e.g., ORD-2024-001234)';
COMMENT ON COLUMN shopping.orders.payment_status IS 'Payment status: pending, processing, paid, failed, refunded';
COMMENT ON COLUMN shopping.orders.status IS 'Order status: pending, processing, completed, cancelled, refunded';
COMMENT ON COLUMN shopping.purchase_history.resellable IS 'Whether this purchase can be resold (eBay-style)';

-- GRANTS (ensure postgres user has privileges)
GRANT ALL PRIVILEGES ON SCHEMA shopping TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA shopping TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA shopping TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA shopping GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA shopping GRANT ALL ON SEQUENCES TO postgres;

