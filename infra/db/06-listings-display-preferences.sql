-- Display Preferences Extension for Listings
-- Run on PostgreSQL port 5435 (listings database)

SET ROLE postgres;

-- Add display preferences to user_settings
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'listings' AND table_name = 'user_settings' AND column_name = 'items_per_page') THEN
    ALTER TABLE listings.user_settings ADD COLUMN items_per_page INT DEFAULT 50;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'listings' AND table_name = 'user_settings' AND column_name = 'display_style') THEN
    ALTER TABLE listings.user_settings ADD COLUMN display_style VARCHAR(20) DEFAULT 'grid';
  END IF;
END $$;

COMMENT ON COLUMN listings.user_settings.items_per_page IS 'Number of listings to display per page (e.g., 50, 100, 200)';
COMMENT ON COLUMN listings.user_settings.display_style IS 'Preferred display style: grid, list, or compact';

-- Add check constraint for valid display styles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'chk_display_style' 
    AND conrelid = 'listings.user_settings'::regclass
  ) THEN
    ALTER TABLE listings.user_settings 
    ADD CONSTRAINT chk_display_style 
    CHECK (display_style IN ('grid', 'list', 'compact'));
  END IF;
END $$;

-- Add check constraint for valid items_per_page
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'chk_items_per_page' 
    AND conrelid = 'listings.user_settings'::regclass
  ) THEN
    ALTER TABLE listings.user_settings 
    ADD CONSTRAINT chk_items_per_page 
    CHECK (items_per_page IN (25, 50, 100, 200));
  END IF;
END $$;

GRANT ALL PRIVILEGES ON SCHEMA listings TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA listings TO postgres;

