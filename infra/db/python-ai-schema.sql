-- Python AI Service Database Schema
-- Database: python_ai
-- Purpose: Store AI model data, predictions, inference results, and analytics cache

-- Extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Schema for AI service
CREATE SCHEMA IF NOT EXISTS ai;

-- AI Predictions Cache
-- Stores price predictions and recommendations to avoid redundant API calls
CREATE TABLE IF NOT EXISTS ai.predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query TEXT NOT NULL,
  query_hash TEXT NOT NULL,  -- Hash of query for fast lookup
  prediction_type TEXT NOT NULL,  -- 'price', 'selling', 'buying', 'negotiation', 'bidding'
  user_id UUID,
  input_data JSONB NOT NULL,  -- Original input parameters
  prediction_result JSONB NOT NULL,  -- Full prediction result
  confidence_score NUMERIC(5,2),  -- 0.00 to 1.00
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,  -- Optional expiration for cache invalidation
  
  -- Indexes for fast lookups
  CONSTRAINT predictions_query_hash_key UNIQUE (query_hash, prediction_type, user_id)
);

CREATE INDEX IF NOT EXISTS idx_predictions_query ON ai.predictions USING gin(query gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_predictions_user ON ai.predictions(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_predictions_type ON ai.predictions(prediction_type);
CREATE INDEX IF NOT EXISTS idx_predictions_created ON ai.predictions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_expires ON ai.predictions(expires_at) WHERE expires_at IS NOT NULL;

-- AI Model Inference Log
-- Tracks all AI inferences for analytics and model improvement
CREATE TABLE IF NOT EXISTS ai.inference_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  query TEXT NOT NULL,
  inference_type TEXT NOT NULL,  -- 'selling', 'buying', 'negotiation', 'bidding'
  input_data JSONB NOT NULL,
  output_data JSONB NOT NULL,
  processing_time_ms INTEGER,  -- Time taken in milliseconds
  analytics_data_used BOOLEAN DEFAULT FALSE,  -- Whether analytics service data was used
  cache_hit BOOLEAN DEFAULT FALSE,  -- Whether result came from cache
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inference_log_user ON ai.inference_log(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inference_log_type ON ai.inference_log(inference_type);
CREATE INDEX IF NOT EXISTS idx_inference_log_created ON ai.inference_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inference_log_query ON ai.inference_log USING gin(query gin_trgm_ops);

-- Analytics Data Cache
-- Caches enriched data from analytics service to reduce API calls
CREATE TABLE IF NOT EXISTS ai.analytics_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query TEXT NOT NULL,
  query_hash TEXT NOT NULL,
  user_id UUID,
  cache_type TEXT NOT NULL,  -- 'price_trend', 'similar_searches', 'trending', 'user_history'
  cached_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,  -- When cache expires
  
  CONSTRAINT analytics_cache_key UNIQUE (query_hash, cache_type, user_id)
);

CREATE INDEX IF NOT EXISTS idx_analytics_cache_query ON ai.analytics_cache USING gin(query gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_analytics_cache_type ON ai.analytics_cache(cache_type);
CREATE INDEX IF NOT EXISTS idx_analytics_cache_expires ON ai.analytics_cache(expires_at);

-- AI Event Log
-- Stores events published to Kafka for audit and replay
CREATE TABLE IF NOT EXISTS ai.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,  -- 'selling_advice', 'buying_advice', 'negotiation_advice', 'bidding_advice', 'data_ingestion'
  user_id UUID,
  query TEXT,
  event_data JSONB NOT NULL,
  kafka_published BOOLEAN DEFAULT FALSE,  -- Whether successfully published to Kafka
  kafka_topic TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_type ON ai.events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_user ON ai.events(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_created ON ai.events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_kafka ON ai.events(kafka_published, kafka_topic) WHERE kafka_topic IS NOT NULL;

-- Model Performance Metrics
-- Tracks accuracy and performance of AI predictions
CREATE TABLE IF NOT EXISTS ai.model_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_type TEXT NOT NULL,  -- 'price_prediction', 'selling_advisor', 'buying_advisor', etc.
  metric_name TEXT NOT NULL,  -- 'accuracy', 'precision', 'recall', 'f1_score', 'mae', 'rmse'
  metric_value NUMERIC(10,4) NOT NULL,
  sample_size INTEGER,
  evaluation_period_start TIMESTAMPTZ NOT NULL,
  evaluation_period_end TIMESTAMPTZ NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_metrics_type ON ai.model_metrics(model_type);
CREATE INDEX IF NOT EXISTS idx_model_metrics_name ON ai.model_metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_model_metrics_period ON ai.model_metrics(evaluation_period_start, evaluation_period_end);

-- Cleanup function for expired cache entries
CREATE OR REPLACE FUNCTION ai.cleanup_expired_cache()
RETURNS void AS $func$
BEGIN
  DELETE FROM ai.predictions WHERE expires_at IS NOT NULL AND expires_at < now();
  DELETE FROM ai.analytics_cache WHERE expires_at < now();
END;
$func$ LANGUAGE plpgsql;

-- Function to get or create prediction cache entry
CREATE OR REPLACE FUNCTION ai.get_prediction(
  p_query TEXT,
  p_prediction_type TEXT,
  p_user_id UUID DEFAULT NULL,
  p_ttl_minutes INTEGER DEFAULT 60
)
RETURNS TABLE (
  prediction_result JSONB,
  confidence_score NUMERIC,
  created_at TIMESTAMPTZ
) AS $func$
DECLARE
  v_query_hash TEXT;
BEGIN
  v_query_hash := encode(digest(p_query, 'sha256'), 'hex');
  
  RETURN QUERY
  SELECT 
    pr.prediction_result,
    pr.confidence_score,
    pr.created_at
  FROM ai.predictions pr
  WHERE pr.query_hash = v_query_hash
    AND pr.prediction_type = p_prediction_type
    AND (pr.user_id = p_user_id OR (pr.user_id IS NULL AND p_user_id IS NULL))
    AND (pr.expires_at IS NULL OR pr.expires_at > now())
  ORDER BY pr.created_at DESC
  LIMIT 1;
END;
$func$ LANGUAGE plpgsql;

-- Function to store prediction cache
CREATE OR REPLACE FUNCTION ai.store_prediction(
  p_query TEXT,
  p_prediction_type TEXT,
  p_user_id UUID,
  p_input_data JSONB,
  p_prediction_result JSONB,
  p_confidence_score NUMERIC DEFAULT NULL,
  p_ttl_minutes INTEGER DEFAULT 60
)
RETURNS UUID AS $func$
DECLARE
  v_query_hash TEXT;
  v_id UUID;
  v_expires_at TIMESTAMPTZ;
BEGIN
  v_query_hash := encode(digest(p_query, 'sha256'), 'hex');
  v_expires_at := now() + (p_ttl_minutes || ' minutes')::INTERVAL;
  
  INSERT INTO ai.predictions (
    query,
    query_hash,
    prediction_type,
    user_id,
    input_data,
    prediction_result,
    confidence_score,
    expires_at
  ) VALUES (
    p_query,
    v_query_hash,
    p_prediction_type,
    p_user_id,
    p_input_data,
    p_prediction_result,
    p_confidence_score,
    v_expires_at
  )
  ON CONFLICT (query_hash, prediction_type, user_id)
  DO UPDATE SET
    prediction_result = EXCLUDED.prediction_result,
    confidence_score = EXCLUDED.confidence_score,
    expires_at = EXCLUDED.expires_at,
    created_at = now()
  RETURNING id INTO v_id;
  
  RETURN v_id;
END;
$func$ LANGUAGE plpgsql;

