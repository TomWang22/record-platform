-- Analytics Database Schema
-- Stores analytics data, trends, snapshots, and aggregated metrics
-- Port: 5439
-- Note: This is optional - analytics service can also work with Redis/Kafka only

-- Create schema
CREATE SCHEMA IF NOT EXISTS analytics;

-- Price snapshots (historical price data for records)
CREATE TABLE IF NOT EXISTS analytics.price_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    record_id UUID NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('discogs', 'popsike', 'gripseeat', 'ebay', 'manual')),
    price NUMERIC(10, 2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    condition_record TEXT,
    condition_sleeve TEXT,
    snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(record_id, source, snapshot_date, condition_record, condition_sleeve)
);

CREATE INDEX IF NOT EXISTS idx_price_snapshots_record_id ON analytics.price_snapshots(record_id);
CREATE INDEX IF NOT EXISTS idx_price_snapshots_snapshot_date ON analytics.price_snapshots(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_price_snapshots_source ON analytics.price_snapshots(source);

-- Search analytics (track search patterns and trends)
CREATE TABLE IF NOT EXISTS analytics.search_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    query TEXT NOT NULL,
    result_count INTEGER DEFAULT 0,
    clicked_result_id UUID,
    search_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session_id TEXT,
    user_agent TEXT,
    ip_address INET
);

CREATE INDEX IF NOT EXISTS idx_search_analytics_user_id ON analytics.search_analytics(user_id);
CREATE INDEX IF NOT EXISTS idx_search_analytics_query ON analytics.search_analytics(query);
CREATE INDEX IF NOT EXISTS idx_search_analytics_timestamp ON analytics.search_analytics(search_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_search_analytics_session_id ON analytics.search_analytics(session_id);

-- Trend snapshots (aggregated trend data)
CREATE TABLE IF NOT EXISTS analytics.trend_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    record_id UUID NOT NULL,
    metric_type TEXT NOT NULL CHECK (metric_type IN ('price_avg', 'price_median', 'price_min', 'price_max', 'volume', 'search_count')),
    metric_value NUMERIC(12, 4) NOT NULL,
    snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
    period TEXT NOT NULL CHECK (period IN ('daily', 'weekly', 'monthly', 'yearly')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(record_id, metric_type, snapshot_date, period)
);

CREATE INDEX IF NOT EXISTS idx_trend_snapshots_record_id ON analytics.trend_snapshots(record_id);
CREATE INDEX IF NOT EXISTS idx_trend_snapshots_date ON analytics.trend_snapshots(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_trend_snapshots_metric_type ON analytics.trend_snapshots(metric_type);

-- User behavior analytics
CREATE TABLE IF NOT EXISTS analytics.user_behavior (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('view', 'search', 'add_to_collection', 'remove_from_collection', 'share', 'export')),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('record', 'collection', 'search', 'listing')),
    entity_id UUID,
    metadata JSONB,
    event_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_behavior_user_id ON analytics.user_behavior(user_id);
CREATE INDEX IF NOT EXISTS idx_user_behavior_event_type ON analytics.user_behavior(event_type);
CREATE INDEX IF NOT EXISTS idx_user_behavior_timestamp ON analytics.user_behavior(event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_user_behavior_metadata ON analytics.user_behavior USING gin(metadata);

-- Aggregated metrics (pre-computed aggregations for performance)
CREATE TABLE IF NOT EXISTS analytics.aggregated_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_name TEXT NOT NULL,
    metric_value JSONB NOT NULL,
    aggregation_date DATE NOT NULL DEFAULT CURRENT_DATE,
    period TEXT NOT NULL CHECK (period IN ('hourly', 'daily', 'weekly', 'monthly')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(metric_name, aggregation_date, period)
);

CREATE INDEX IF NOT EXISTS idx_aggregated_metrics_name ON analytics.aggregated_metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_aggregated_metrics_date ON analytics.aggregated_metrics(aggregation_date DESC);

-- Function to clean old analytics data (retention policy)
CREATE OR REPLACE FUNCTION analytics.cleanup_old_data(retention_days INTEGER DEFAULT 365)
RETURNS TABLE(deleted_count BIGINT, table_name TEXT) AS $$
DECLARE
    v_count BIGINT;
BEGIN
    -- Clean search analytics older than retention period
    DELETE FROM analytics.search_analytics
    WHERE search_timestamp < NOW() - (retention_days || ' days')::INTERVAL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN QUERY SELECT v_count, 'search_analytics'::TEXT;
    
    -- Clean user behavior older than retention period
    DELETE FROM analytics.user_behavior
    WHERE event_timestamp < NOW() - (retention_days || ' days')::INTERVAL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN QUERY SELECT v_count, 'user_behavior'::TEXT;
    
    -- Keep price snapshots and trend snapshots (they're aggregated data)
    -- Only clean if explicitly requested with very old retention
    IF retention_days > 730 THEN
        DELETE FROM analytics.price_snapshots
        WHERE snapshot_date < CURRENT_DATE - (retention_days || ' days')::INTERVAL;
        GET DIAGNOSTICS v_count = ROW_COUNT;
        RETURN QUERY SELECT v_count, 'price_snapshots'::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions (adjust as needed for your app user)
-- GRANT USAGE ON SCHEMA analytics TO record_app;
-- GRANT ALL ON ALL TABLES IN SCHEMA analytics TO record_app;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA analytics TO record_app;

COMMENT ON SCHEMA analytics IS 'Analytics data, trends, snapshots, and aggregated metrics';
COMMENT ON TABLE analytics.price_snapshots IS 'Historical price data for records';
COMMENT ON TABLE analytics.search_analytics IS 'Search patterns and trends';
COMMENT ON TABLE analytics.trend_snapshots IS 'Aggregated trend data';
COMMENT ON TABLE analytics.user_behavior IS 'User behavior event tracking';
COMMENT ON TABLE analytics.aggregated_metrics IS 'Pre-computed aggregated metrics for performance';

