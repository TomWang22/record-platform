-- Shopping: watchlist/wishlist with record-like snapshot columns (same shape as records.records / listings).
-- When user "unadds" from watchlist/wishlist, the row is DELETED (row leaves the DB).
-- Apply on port 5436 (shopping DB).

-- Add record/listing snapshot columns to watchlist (denormalized for display without joining)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'shopping' AND table_name = 'watchlist' AND column_name = 'artist') THEN
    ALTER TABLE shopping.watchlist ADD COLUMN artist VARCHAR(256);
    ALTER TABLE shopping.watchlist ADD COLUMN name VARCHAR(256);
    ALTER TABLE shopping.watchlist ADD COLUMN format VARCHAR(64);
    ALTER TABLE shopping.watchlist ADD COLUMN catalog_number VARCHAR(64);
    ALTER TABLE shopping.watchlist ADD COLUMN record_grade VARCHAR(16);
    ALTER TABLE shopping.watchlist ADD COLUMN sleeve_grade VARCHAR(16);
    ALTER TABLE shopping.watchlist ADD COLUMN label VARCHAR(128);
    ALTER TABLE shopping.watchlist ADD COLUMN label_code VARCHAR(64);
    ALTER TABLE shopping.watchlist ADD COLUMN release_year INTEGER;
    COMMENT ON COLUMN shopping.watchlist.artist IS 'Snapshot from listing/record at add time; unadd = DELETE row';
  END IF;
END $$;

-- Same for wishlist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'shopping' AND table_name = 'wishlist' AND column_name = 'artist') THEN
    ALTER TABLE shopping.wishlist ADD COLUMN artist VARCHAR(256);
    ALTER TABLE shopping.wishlist ADD COLUMN name VARCHAR(256);
    ALTER TABLE shopping.wishlist ADD COLUMN format VARCHAR(64);
    ALTER TABLE shopping.wishlist ADD COLUMN catalog_number VARCHAR(64);
    ALTER TABLE shopping.wishlist ADD COLUMN record_grade VARCHAR(16);
    ALTER TABLE shopping.wishlist ADD COLUMN sleeve_grade VARCHAR(16);
    ALTER TABLE shopping.wishlist ADD COLUMN label VARCHAR(128);
    ALTER TABLE shopping.wishlist ADD COLUMN label_code VARCHAR(64);
    ALTER TABLE shopping.wishlist ADD COLUMN release_year INTEGER;
    COMMENT ON COLUMN shopping.wishlist.artist IS 'Snapshot from listing/record at add time; unadd = DELETE row';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_watchlist_artist ON shopping.watchlist(artist) WHERE artist IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wishlist_artist ON shopping.wishlist(artist) WHERE artist IS NOT NULL;

-- Recently viewed: append-only (user cannot modify; only system INSERT, cleanup DELETE)
COMMENT ON TABLE shopping.recently_viewed IS 'Append-only; user cannot edit. System inserts on view, cleanup job may delete oldest per user.';

-- Search history: user can delete their own rows
COMMENT ON TABLE shopping.search_history IS 'User can DELETE their own rows (by user_id). Deletable per user.';
