-- Shopping: shipments and random tracking number (eBay-style).
-- Run on port 5436 (shopping DB). After checkout we create a shipment with a generated tracking number.

SET ROLE postgres;

-- One shipment per order (1:1 for simplicity; can extend to multiple packages later).
CREATE TABLE IF NOT EXISTS shopping.shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES shopping.orders(id) ON DELETE CASCADE,
  tracking_number VARCHAR(64) NOT NULL UNIQUE,
  carrier VARCHAR(64) NOT NULL DEFAULT 'SIMULATED',
  status VARCHAR(32) NOT NULL DEFAULT 'shipped' CHECK (status IN ('pending', 'shipped', 'in_transit', 'delivered')),
  shipped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shipments_order_id ON shopping.shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_tracking ON shopping.shipments(tracking_number);
CREATE INDEX IF NOT EXISTS idx_shipments_status ON shopping.shipments(status);

-- Generate a random tracking number for simulation (e.g. TRK-1A2B3C4D5E).
CREATE OR REPLACE FUNCTION shopping.generate_tracking_number()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  result TEXT := 'TRK-';
  i INT;
BEGIN
  FOR i IN 1..10 LOOP
    result := result || substr(chars, 1 + floor(random() * length(chars))::int, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE shopping.shipments IS 'One shipment per order; tracking_number generated at checkout (simulated).';
COMMENT ON FUNCTION shopping.generate_tracking_number() IS 'Random tracking number for simulation (TRK-xxxxxxxxxx).';

-- Trigger updated_at
DROP TRIGGER IF EXISTS trigger_shipments_updated_at ON shopping.shipments;
CREATE TRIGGER trigger_shipments_updated_at
  BEFORE UPDATE ON shopping.shipments
  FOR EACH ROW
  EXECUTE FUNCTION shopping.update_updated_at();

GRANT ALL PRIVILEGES ON TABLE shopping.shipments TO postgres;
