-- Migration: Add catalog_id to listings and notes to shopping_cart
-- This file contains BOTH migrations - run the appropriate section for each database

-- ============================================================
-- LISTINGS DATABASE (port 5435) - Run this section only
-- ============================================================
SET ROLE postgres;

-- Add catalog_id column to listings.listings
-- This allows differentiating items with the same title and condition
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'listings' 
    AND table_name = 'listings' 
    AND column_name = 'catalog_id'
  ) THEN
    ALTER TABLE listings.listings 
    ADD COLUMN catalog_id VARCHAR(128);
    
    -- Create index for catalog_id lookups
    CREATE INDEX IF NOT EXISTS idx_listings_catalog_id ON listings.listings(catalog_id);
    
    -- Create unique constraint on (title, condition, catalog_id) to prevent duplicates
    -- Only if catalog_id is provided (NULL catalog_id means no catalog distinction)
    CREATE UNIQUE INDEX IF NOT EXISTS idx_listings_title_condition_catalog 
    ON listings.listings(user_id, title, condition, catalog_id) 
    WHERE catalog_id IS NOT NULL;
    
    COMMENT ON COLUMN listings.listings.catalog_id IS 
    'Catalog ID to differentiate items with same title and condition (e.g., SKU, product code)';
  END IF;
END $$;

RESET ROLE;
