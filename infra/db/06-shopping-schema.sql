-- Shopping/Collector Service Database Schema
-- Port: 5436 (separate from main, social, listings)
-- Features: Shopping cart, watchlist, recently viewed, wishlist, purchase/search history, LFU/LRU caching

-- Create schema
CREATE SCHEMA IF NOT EXISTS shopping;

-- Shopping Cart - temporary items user is considering
CREATE TABLE IF NOT EXISTS shopping.shopping_cart (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  listing_id UUID, -- Optional: can add items not yet listed
  item_type TEXT NOT NULL, -- 'listing', 'record', 'custom'
  item_id UUID NOT NULL, -- ID of the item (listing, record, etc.)
  quantity INTEGER NOT NULL DEFAULT 1,
  price DECIMAL(10, 2), -- Snapshot price at add time
  metadata JSONB, -- Additional item data (title, image, etc.)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_shopping_cart_user_id ON shopping.shopping_cart(user_id);
CREATE INDEX idx_shopping_cart_user_item ON shopping.shopping_cart(user_id, item_type, item_id);

-- Watchlist - items user wants to monitor (price changes, availability)
CREATE TABLE IF NOT EXISTS shopping.watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  listing_id UUID,
  item_type TEXT NOT NULL, -- 'listing', 'record', 'auction'
  item_id UUID NOT NULL,
  notify_on TEXT[] DEFAULT '{}', -- ['price_drop', 'availability', 'bid_end']
  metadata JSONB, -- Snapshot of item at watch time
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, item_type, item_id)
);

CREATE INDEX idx_watchlist_user_id ON shopping.watchlist(user_id);
CREATE INDEX idx_watchlist_item ON shopping.watchlist(item_id, item_type);

-- Recently Viewed - track what user has viewed (LRU cache in Redis, persisted here)
CREATE TABLE IF NOT EXISTS shopping.recently_viewed (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  item_type TEXT NOT NULL, -- 'listing', 'record', 'user', 'forum_post'
  item_id UUID NOT NULL,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB, -- Snapshot of item at view time
  UNIQUE(user_id, item_type, item_id)
);

CREATE INDEX idx_recently_viewed_user_time ON shopping.recently_viewed(user_id, viewed_at DESC);
CREATE INDEX idx_recently_viewed_item ON shopping.recently_viewed(item_id, item_type);

-- Wishlist - items user wants to buy later
CREATE TABLE IF NOT EXISTS shopping.wishlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  listing_id UUID,
  item_type TEXT NOT NULL, -- 'listing', 'record', 'custom'
  item_id UUID NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0, -- User-defined priority
  notes TEXT,
  metadata JSONB, -- Snapshot of item at wish time
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, item_type, item_id)
);

CREATE INDEX idx_wishlist_user_priority ON shopping.wishlist(user_id, priority DESC);
CREATE INDEX idx_wishlist_item ON shopping.wishlist(item_id, item_type);

-- Purchase History - completed purchases
CREATE TABLE IF NOT EXISTS shopping.purchase_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  order_id UUID NOT NULL, -- Link to order system
  listing_id UUID,
  item_type TEXT NOT NULL, -- 'listing', 'record', 'auction'
  item_id UUID NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  price_paid DECIMAL(10, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  purchase_type TEXT NOT NULL, -- 'buy_now', 'auction_win', 'best_offer'
  status TEXT NOT NULL DEFAULT 'completed', -- 'completed', 'pending', 'cancelled', 'refunded'
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB -- Full purchase details
);

CREATE INDEX idx_purchase_history_user_time ON shopping.purchase_history(user_id, purchased_at DESC);
CREATE INDEX idx_purchase_history_order ON shopping.purchase_history(order_id);
CREATE INDEX idx_purchase_history_item ON shopping.purchase_history(item_id, item_type);

-- Search History - track user searches (for recommendations)
CREATE TABLE IF NOT EXISTS shopping.search_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  query TEXT NOT NULL,
  query_type TEXT NOT NULL, -- 'listing', 'record', 'user', 'forum'
  filters JSONB, -- Applied filters (price range, condition, etc.)
  result_count INTEGER,
  clicked_item UUID, -- If user clicked a result
  searched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_search_history_user_time ON shopping.search_history(user_id, searched_at DESC);
CREATE INDEX idx_search_history_query ON shopping.search_history(query);
CREATE INDEX idx_search_history_type_time ON shopping.search_history(query_type, searched_at DESC);

-- Cache Metadata - track LFU/LRU stats (synced from Redis)
CREATE TABLE IF NOT EXISTS shopping.cache_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  cache_key TEXT NOT NULL,
  cache_type TEXT NOT NULL, -- 'lfu', 'lru', 'recently_viewed'
  access_count INTEGER NOT NULL DEFAULT 0, -- For LFU
  last_access TIMESTAMPTZ NOT NULL DEFAULT now(), -- For LRU
  metadata JSONB,
  UNIQUE(user_id, cache_key)
);

CREATE INDEX idx_cache_metadata_user_type ON shopping.cache_metadata(user_id, cache_type);
CREATE INDEX idx_cache_metadata_lfu ON shopping.cache_metadata(cache_type, access_count DESC); -- For LFU eviction
CREATE INDEX idx_cache_metadata_lru ON shopping.cache_metadata(cache_type, last_access ASC); -- For LRU eviction

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION shopping.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_shopping_cart_updated_at
  BEFORE UPDATE ON shopping.shopping_cart
  FOR EACH ROW
  EXECUTE FUNCTION shopping.update_updated_at();

CREATE TRIGGER trigger_watchlist_updated_at
  BEFORE UPDATE ON shopping.watchlist
  FOR EACH ROW
  EXECUTE FUNCTION shopping.update_updated_at();

CREATE TRIGGER trigger_wishlist_updated_at
  BEFORE UPDATE ON shopping.wishlist
  FOR EACH ROW
  EXECUTE FUNCTION shopping.update_updated_at();

-- Function to clean old recently viewed (keep last 100 per user)
CREATE OR REPLACE FUNCTION shopping.cleanup_old_recently_viewed()
RETURNS void AS $$
BEGIN
  DELETE FROM shopping.recently_viewed
  WHERE id NOT IN (
    SELECT id
    FROM shopping.recently_viewed
    ORDER BY viewed_at DESC
    LIMIT 100
  );
END;
$$ LANGUAGE plpgsql;

-- Function to clean old search history (keep last 1000 per user)
CREATE OR REPLACE FUNCTION shopping.cleanup_old_search_history()
RETURNS void AS $$
BEGIN
  DELETE FROM shopping.search_history
  WHERE id NOT IN (
    SELECT id
    FROM shopping.search_history
    ORDER BY searched_at DESC
    LIMIT 1000
  );
END;
$$ LANGUAGE plpgsql;

-- Grant permissions (if using separate user)
-- GRANT USAGE ON SCHEMA shopping TO shopping_user;
-- GRANT ALL ON ALL TABLES IN SCHEMA shopping TO shopping_user;
-- GRANT ALL ON ALL SEQUENCES IN SCHEMA shopping TO shopping_user;

