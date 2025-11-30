-- Migration: Add notes column to shopping_cart
-- Run on shopping database (port 5436)

SET ROLE postgres;

-- Add notes column to shopping_cart for user-specific notes per item
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'shopping' 
    AND table_name = 'shopping_cart' 
    AND column_name = 'notes'
  ) THEN
    ALTER TABLE shopping.shopping_cart 
    ADD COLUMN notes TEXT;
    
    COMMENT ON COLUMN shopping.shopping_cart.notes IS 
    'User-specific notes to differentiate items with same condition (e.g., "Has minor scratch on side", "Original packaging")';
  END IF;
END $$;

RESET ROLE;

