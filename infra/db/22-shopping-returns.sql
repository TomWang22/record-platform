-- Shopping: returns (eBay-style). Buyer can request return; seller approves; we track status.
-- Run on port 5436 (shopping DB).

SET ROLE postgres;

CREATE TABLE IF NOT EXISTS shopping.returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES shopping.orders(id) ON DELETE CASCADE,
  purchase_id UUID NOT NULL REFERENCES shopping.purchase_history(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL, -- buyer user_id
  status VARCHAR(32) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'received', 'refunded', 'rejected')),
  reason TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_returns_order ON shopping.returns(order_id);
CREATE INDEX IF NOT EXISTS idx_returns_purchase ON shopping.returns(purchase_id);
CREATE INDEX IF NOT EXISTS idx_returns_requested_by ON shopping.returns(requested_by);
CREATE INDEX IF NOT EXISTS idx_returns_status ON shopping.returns(status);

DROP TRIGGER IF EXISTS trigger_returns_updated_at ON shopping.returns;
CREATE TRIGGER trigger_returns_updated_at
  BEFORE UPDATE ON shopping.returns
  FOR EACH ROW
  EXECUTE FUNCTION shopping.update_updated_at();

COMMENT ON TABLE shopping.returns IS 'Return requests; status: requested -> approved -> received -> refunded (or rejected).';

GRANT ALL PRIVILEGES ON TABLE shopping.returns TO postgres;
