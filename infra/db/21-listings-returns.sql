-- Listings: support for returned items (eBay-style). When a sold item is returned, seller can relist.
-- Run on port 5435 (listings DB).

SET ROLE postgres;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'listings' AND table_name = 'listings' AND column_name = 'returned_at') THEN
    ALTER TABLE listings.listings ADD COLUMN returned_at TIMESTAMPTZ;
    COMMENT ON COLUMN listings.listings.returned_at IS 'When this listing was returned (from shopping return flow); seller can relist.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'listings' AND table_name = 'listings' AND column_name = 'returned_from_order_id') THEN
    ALTER TABLE listings.listings ADD COLUMN returned_from_order_id UUID;
    COMMENT ON COLUMN listings.listings.returned_from_order_id IS 'Order id (shopping.orders) this item was returned from; cross-DB reference.';
  END IF;
END $$;
