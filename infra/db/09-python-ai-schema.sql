-- Python AI Service Database Schema
-- Stores AI model data, predictions, training data, and model metadata
-- Port: 5440
-- Note: This is optional - Python AI service can work with Redis only for caching

-- Create schema
CREATE SCHEMA IF NOT EXISTS ai;

-- Model metadata (tracks AI models and their versions)
CREATE TABLE IF NOT EXISTS ai.model_metadata (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_name TEXT NOT NULL,
    model_version TEXT NOT NULL,
    model_type TEXT NOT NULL CHECK (model_type IN ('price_prediction', 'recommendation', 'classification', 'embedding')),
    model_path TEXT,  -- Path to model file or identifier
    training_date TIMESTAMPTZ,
    accuracy_metrics JSONB,  -- Store accuracy, precision, recall, etc.
    hyperparameters JSONB,  -- Model hyperparameters
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(model_name, model_version)
);

CREATE INDEX IF NOT EXISTS idx_model_metadata_name ON ai.model_metadata(model_name);
CREATE INDEX IF NOT EXISTS idx_model_metadata_active ON ai.model_metadata(is_active) WHERE is_active = true;

-- Price predictions (store predictions made by AI models)
CREATE TABLE IF NOT EXISTS ai.price_predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    record_id UUID NOT NULL,
    model_id UUID NOT NULL REFERENCES ai.model_metadata(id),
    predicted_price NUMERIC(10, 2) NOT NULL,
    confidence_score NUMERIC(5, 4),  -- 0.0000 to 1.0000
    input_features JSONB,  -- Features used for prediction
    actual_price NUMERIC(10, 2),  -- Actual price if available (for training)
    prediction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_predictions_record_id ON ai.price_predictions(record_id);
CREATE INDEX IF NOT EXISTS idx_price_predictions_model_id ON ai.price_predictions(model_id);
CREATE INDEX IF NOT EXISTS idx_price_predictions_date ON ai.price_predictions(prediction_date DESC);

-- Training data (store data used for model training)
CREATE TABLE IF NOT EXISTS ai.training_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    record_id UUID NOT NULL,
    features JSONB NOT NULL,  -- Input features
    target_value NUMERIC(10, 2) NOT NULL,  -- Target value (price, rating, etc.)
    data_source TEXT NOT NULL,  -- Where this data came from
    quality_score NUMERIC(5, 4),  -- Data quality score
    used_in_training BOOLEAN NOT NULL DEFAULT false,
    training_run_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_data_record_id ON ai.training_data(record_id);
CREATE INDEX IF NOT EXISTS idx_training_data_used ON ai.training_data(used_in_training) WHERE used_in_training = true;
CREATE INDEX IF NOT EXISTS idx_training_data_training_run_id ON ai.training_data(training_run_id);

-- Training runs (track model training sessions)
CREATE TABLE IF NOT EXISTS ai.training_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id UUID NOT NULL REFERENCES ai.model_metadata(id),
    training_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    training_completed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
    training_metrics JSONB,  -- Loss, accuracy, etc. over time
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_training_runs_model_id ON ai.training_runs(model_id);
CREATE INDEX IF NOT EXISTS idx_training_runs_status ON ai.training_runs(status);
CREATE INDEX IF NOT EXISTS idx_training_runs_started_at ON ai.training_runs(training_started_at DESC);

-- Embeddings (store vector embeddings for records)
-- NOTE: Requires pgvector extension. Uncomment after installing pgvector:
-- CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS ai.record_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    record_id UUID NOT NULL,
    model_id UUID NOT NULL REFERENCES ai.model_metadata(id),
    -- embedding VECTOR(1536),  -- Uncomment after installing pgvector extension
    embedding_data BYTEA,  -- Temporary: store as BYTEA until pgvector is installed
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(record_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_record_embeddings_record_id ON ai.record_embeddings(record_id);
CREATE INDEX IF NOT EXISTS idx_record_embeddings_model_id ON ai.record_embeddings(model_id);
-- Vector similarity search index (uncomment after installing pgvector)
-- CREATE INDEX IF NOT EXISTS idx_record_embeddings_vector ON ai.record_embeddings USING ivfflat(embedding vector_cosine_ops);

-- Prediction feedback (user feedback on predictions for model improvement)
CREATE TABLE IF NOT EXISTS ai.prediction_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prediction_id UUID NOT NULL REFERENCES ai.price_predictions(id),
    user_id UUID,
    feedback_type TEXT NOT NULL CHECK (feedback_type IN ('accurate', 'too_high', 'too_low', 'not_relevant')),
    actual_price NUMERIC(10, 2),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prediction_feedback_prediction_id ON ai.prediction_feedback(prediction_id);
CREATE INDEX IF NOT EXISTS idx_prediction_feedback_user_id ON ai.prediction_feedback(user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION ai.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
CREATE TRIGGER update_model_metadata_updated_at
    BEFORE UPDATE ON ai.model_metadata
    FOR EACH ROW
    EXECUTE FUNCTION ai.update_updated_at();

-- Function to get latest prediction for a record
CREATE OR REPLACE FUNCTION ai.get_latest_prediction(p_record_id UUID, p_model_name TEXT DEFAULT NULL)
RETURNS TABLE(
    prediction_id UUID,
    predicted_price NUMERIC,
    confidence_score NUMERIC,
    model_name TEXT,
    prediction_date TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        pp.id,
        pp.predicted_price,
        pp.confidence_score,
        mm.model_name,
        pp.prediction_date
    FROM ai.price_predictions pp
    JOIN ai.model_metadata mm ON pp.model_id = mm.id
    WHERE pp.record_id = p_record_id
      AND (p_model_name IS NULL OR mm.model_name = p_model_name)
      AND mm.is_active = true
    ORDER BY pp.prediction_date DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions (adjust as needed for your app user)
-- GRANT USAGE ON SCHEMA ai TO record_app;
-- GRANT ALL ON ALL TABLES IN SCHEMA ai TO record_app;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ai TO record_app;

COMMENT ON SCHEMA ai IS 'AI model data, predictions, training data, and model metadata';
COMMENT ON TABLE ai.model_metadata IS 'Tracks AI models and their versions';
COMMENT ON TABLE ai.price_predictions IS 'Price predictions made by AI models';
COMMENT ON TABLE ai.training_data IS 'Data used for model training';
COMMENT ON TABLE ai.training_runs IS 'Model training session tracking';
COMMENT ON TABLE ai.record_embeddings IS 'Vector embeddings for records (requires pgvector extension)';
COMMENT ON TABLE ai.prediction_feedback IS 'User feedback on predictions for model improvement';

