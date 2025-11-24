-- Auction Monitor Database Schema
-- Stores historical auction results from discogs, popsike, gripseeat
-- Port: 5438

-- Create schema
CREATE SCHEMA IF NOT EXISTS auction_monitor;

-- Auction results table
-- Stores historical auction data from various sources
CREATE TABLE IF NOT EXISTS auction_monitor.auction_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT NOT NULL CHECK (source IN ('discogs', 'popsike', 'gripseeat', 'ebay')),
    external_id TEXT NOT NULL,  -- ID from the source platform
    record_id UUID,  -- Link to records.records if matched
    title TEXT NOT NULL,
    artist TEXT,
    label TEXT,
    catalog_number TEXT,
    format TEXT,  -- LP, 7", 12", etc.
    condition_record TEXT,  -- M, NM, EX, VG+, VG, G+, G, P
    condition_sleeve TEXT,
    price NUMERIC(10, 2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    shipping_cost NUMERIC(10, 2) DEFAULT 0,
    total_cost NUMERIC(10, 2) NOT NULL,  -- price + shipping + fees
    sold_at TIMESTAMPTZ NOT NULL,
    auction_url TEXT,
    image_url TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint: one result per source + external_id
    UNIQUE(source, external_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_auction_results_source ON auction_monitor.auction_results(source);
CREATE INDEX IF NOT EXISTS idx_auction_results_sold_at ON auction_monitor.auction_results(sold_at DESC);
CREATE INDEX IF NOT EXISTS idx_auction_results_record_id ON auction_monitor.auction_results(record_id) WHERE record_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auction_results_price ON auction_monitor.auction_results(price DESC);
CREATE INDEX IF NOT EXISTS idx_auction_results_created_at ON auction_monitor.auction_results(created_at DESC);

-- Full-text search index for title/artist
CREATE INDEX IF NOT EXISTS idx_auction_results_search ON auction_monitor.auction_results USING gin(
    to_tsvector('simple', COALESCE(title, '') || ' ' || COALESCE(artist, '') || ' ' || COALESCE(label, ''))
);

-- User saved auctions (users can save past auction results for reference)
CREATE TABLE IF NOT EXISTS auction_monitor.user_saved_auctions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    auction_result_id UUID NOT NULL REFERENCES auction_monitor.auction_results(id) ON DELETE CASCADE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(user_id, auction_result_id)
);

CREATE INDEX IF NOT EXISTS idx_user_saved_auctions_user_id ON auction_monitor.user_saved_auctions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_saved_auctions_auction_result_id ON auction_monitor.user_saved_auctions(auction_result_id);

-- Auction monitoring jobs (tracks what we're monitoring)
CREATE TABLE IF NOT EXISTS auction_monitor.monitoring_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('discogs', 'popsike', 'gripseeat', 'ebay')),
    query TEXT NOT NULL,  -- Search query or record identifier
    active BOOLEAN NOT NULL DEFAULT true,
    last_run_at TIMESTAMPTZ,
    last_result_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(user_id, source, query)
);

CREATE INDEX IF NOT EXISTS idx_monitoring_jobs_user_id ON auction_monitor.monitoring_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_monitoring_jobs_active ON auction_monitor.monitoring_jobs(active) WHERE active = true;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION auction_monitor.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_auction_results_updated_at
    BEFORE UPDATE ON auction_monitor.auction_results
    FOR EACH ROW
    EXECUTE FUNCTION auction_monitor.update_updated_at();

CREATE TRIGGER update_monitoring_jobs_updated_at
    BEFORE UPDATE ON auction_monitor.monitoring_jobs
    FOR EACH ROW
    EXECUTE FUNCTION auction_monitor.update_updated_at();

-- Function to upsert auction result (used by auction-monitor service)
CREATE OR REPLACE FUNCTION auction_monitor.upsert_auction_result(
    p_source TEXT,
    p_external_id TEXT,
    p_title TEXT,
    p_price NUMERIC,
    p_total_cost NUMERIC,
    p_sold_at TIMESTAMPTZ,
    p_artist TEXT DEFAULT NULL,
    p_label TEXT DEFAULT NULL,
    p_catalog_number TEXT DEFAULT NULL,
    p_format TEXT DEFAULT NULL,
    p_condition_record TEXT DEFAULT NULL,
    p_condition_sleeve TEXT DEFAULT NULL,
    p_currency TEXT DEFAULT 'USD',
    p_shipping_cost NUMERIC DEFAULT 0,
    p_auction_url TEXT DEFAULT NULL,
    p_image_url TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO auction_monitor.auction_results (
        source, external_id, title, artist, label, catalog_number, format,
        condition_record, condition_sleeve, price, currency, shipping_cost,
        total_cost, sold_at, auction_url, image_url, notes
    ) VALUES (
        p_source, p_external_id, p_title, p_artist, p_label, p_catalog_number, p_format,
        p_condition_record, p_condition_sleeve, p_price, p_currency, p_shipping_cost,
        p_total_cost, p_sold_at, p_auction_url, p_image_url, p_notes
    )
    ON CONFLICT (source, external_id) DO UPDATE SET
        title = EXCLUDED.title,
        artist = EXCLUDED.artist,
        label = EXCLUDED.label,
        catalog_number = EXCLUDED.catalog_number,
        format = EXCLUDED.format,
        condition_record = EXCLUDED.condition_record,
        condition_sleeve = EXCLUDED.condition_sleeve,
        price = EXCLUDED.price,
        currency = EXCLUDED.currency,
        shipping_cost = EXCLUDED.shipping_cost,
        total_cost = EXCLUDED.total_cost,
        sold_at = EXCLUDED.sold_at,
        auction_url = EXCLUDED.auction_url,
        image_url = EXCLUDED.image_url,
        notes = EXCLUDED.notes,
        updated_at = NOW()
    RETURNING id INTO v_id;
    
    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions (adjust as needed for your app user)
-- GRANT USAGE ON SCHEMA auction_monitor TO record_app;
-- GRANT ALL ON ALL TABLES IN SCHEMA auction_monitor TO record_app;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auction_monitor TO record_app;

COMMENT ON SCHEMA auction_monitor IS 'Historical auction results from discogs, popsike, gripseeat, and ebay';
COMMENT ON TABLE auction_monitor.auction_results IS 'Stores historical auction data from various sources';
COMMENT ON TABLE auction_monitor.user_saved_auctions IS 'User-saved auction results for reference';
COMMENT ON TABLE auction_monitor.monitoring_jobs IS 'Tracks active auction monitoring jobs';

