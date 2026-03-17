-- Add resellable column to purchase_history if missing (shopping-service expects it for checkout and resell).
-- Idempotent; safe to run after 06-shopping-schema.sql. Run on port 5436, database shopping (and records/postgres if present).
SET ROLE postgres;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'shopping' AND table_name = 'purchase_history' AND column_name = 'resellable'
  ) THEN
    ALTER TABLE shopping.purchase_history ADD COLUMN resellable BOOLEAN NOT NULL DEFAULT TRUE;
    CREATE INDEX IF NOT EXISTS idx_purchase_history_resellable
      ON shopping.purchase_history(user_id, resellable) WHERE resellable = TRUE;
  END IF;
END $$;

COMMENT ON COLUMN shopping.purchase_history.resellable IS 'Whether this purchase can be resold (eBay-style)';
