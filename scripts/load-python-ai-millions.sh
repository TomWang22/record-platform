#!/usr/bin/env bash
# Load millions of rows into python_ai DB (port 5440): ai.model_metadata, ai.price_predictions, ai.training_data, ai.training_runs, ai.record_embeddings.
# Respects schema and FKs. Realistic model types, prices, dates.
# Usage: TARGET_MODELS=100 TARGET_PREDICTIONS=1000000 ./scripts/load-python-ai-millions.sh
#   PGSQL_VIA_DOCKER=1 — run psql inside Postgres container (avoids host psql segfault)
set -Euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_HOST="${PYTHON_AI_DB_HOST:-localhost}"
DB_PORT="${PYTHON_AI_DB_PORT:-5440}"
DB_USER="${PYTHON_AI_DB_USER:-postgres}"
DB_NAME="${PYTHON_AI_DB_NAME:-records}"
DB_PASS="${PYTHON_AI_DB_PASS:-postgres}"
# shellcheck source=scripts/lib/load-db-common.sh
source "$REPO_ROOT/scripts/lib/load-db-common.sh"

TARGET_MODELS="${TARGET_MODELS:-100}"
TARGET_PREDICTIONS="${TARGET_PREDICTIONS:-1000000}"
TARGET_TRAINING_DATA="${TARGET_TRAINING_DATA:-800000}"
TARGET_EMBEDDINGS="${TARGET_EMBEDDINGS:-500000}"
BATCH_SIZE="${BATCH_SIZE:-50000}"
STATEMENT_TIMEOUT="${STATEMENT_TIMEOUT:-3600}"

echo "$(ts) === Load python_ai DB (port $DB_PORT), schema ai ==="
if ! _psql_connect postgres "SELECT 1;" >/dev/null 2>&1; then
  echo "$(ts) Cannot connect to Postgres at $DB_HOST:$DB_PORT" >&2
  exit 1
fi
echo "$(ts) Connected"

_psql_connect postgres "
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'records') THEN
    CREATE DATABASE records;
  END IF;
END \$\$;
" >/dev/null 2>&1 || true

if ! psql -d records -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema = 'ai' AND table_name = 'model_metadata';" 2>/dev/null | grep -q 1; then
  echo "$(ts) ai schema missing. Run infra/db/09-python-ai-schema.sql first." >&2
  exit 1
fi

# 1) ai.model_metadata — UNIQUE(model_name, model_version), model_type IN ('price_prediction','recommendation','classification','embedding')
CURRENT=$(psql -d records -tAc "SELECT count(*) FROM ai.model_metadata;" 2>/dev/null | tr -d ' ' || echo "0")
echo "$(ts) ai.model_metadata: $CURRENT (target $TARGET_MODELS)"
while [[ "$CURRENT" -lt "$TARGET_MODELS" ]]; do
  NEED=$(( TARGET_MODELS - CURRENT ))
  THIS=$(( NEED < 100 ? NEED : 100 ))
  psql -d records -c "SET statement_timeout = '${STATEMENT_TIMEOUT}s';
INSERT INTO ai.model_metadata (model_name, model_version, model_type, model_path, training_date, accuracy_metrics, hyperparameters, is_active)
SELECT 'model_' || g.n, 'v' || (g.n % 10) || '.' || (g.n % 100), (ARRAY['price_prediction','recommendation','classification','embedding'])[1 + (g.n % 4)], '/models/model_' || g.n, now() - (g.n || ' days')::interval, '{\"accuracy\": 0.95}'::jsonb, '{}'::jsonb, true
FROM generate_series(1, $THIS) AS g(n)
ON CONFLICT (model_name, model_version) DO NOTHING;
" >/dev/null 2>&1 || break
  CURRENT=$(psql -d records -tAc "SELECT count(*) FROM ai.model_metadata;" 2>/dev/null | tr -d ' ')
  echo "$(ts)   model_metadata: $CURRENT"
done

# 2) ai.price_predictions — FK model_id; sample model IDs once per batch
CURRENT=$(psql -d records -tAc "SELECT count(*) FROM ai.price_predictions;" 2>/dev/null | tr -d ' ' || echo "0")
echo "$(ts) ai.price_predictions: $CURRENT (target $TARGET_PREDICTIONS) [statement_timeout=${STATEMENT_TIMEOUT}s]"
while [[ "$CURRENT" -lt "$TARGET_PREDICTIONS" ]]; do
  NEED=$(( TARGET_PREDICTIONS - CURRENT ))
  THIS=$(( BATCH_SIZE < NEED ? BATCH_SIZE : NEED ))
  psql -d records -c "SET statement_timeout = '${STATEMENT_TIMEOUT}s';
WITH model_sample AS (
  SELECT id, row_number() OVER () AS rn FROM (SELECT id FROM ai.model_metadata ORDER BY random() LIMIT 100) t
),
series AS (SELECT g.n FROM generate_series(1, $THIS) AS g(n))
INSERT INTO ai.price_predictions (record_id, model_id, predicted_price, confidence_score, input_features, actual_price, prediction_date)
SELECT gen_random_uuid(), (SELECT id FROM model_sample WHERE rn = 1 + (s.n % (SELECT count(*) FROM model_sample))), (random() * 400 + 10)::numeric(10,2), (random() * 0.3 + 0.7)::numeric(5,4), '{}'::jsonb, (random() * 380 + 15)::numeric(10,2), now() - (random() * interval '365 days')
FROM series s;
" >/dev/null 2>&1 || break
  CURRENT=$(psql -d records -tAc "SELECT count(*) FROM ai.price_predictions;" 2>/dev/null | tr -d ' ')
  echo "$(ts)   price_predictions: $CURRENT"
done

# 3) ai.training_data — no FK to model (training_run_id optional)
CURRENT=$(psql -d records -tAc "SELECT count(*) FROM ai.training_data;" 2>/dev/null | tr -d ' ' || echo "0")
echo "$(ts) ai.training_data: $CURRENT (target $TARGET_TRAINING_DATA)"
while [[ "$CURRENT" -lt "$TARGET_TRAINING_DATA" ]]; do
  NEED=$(( TARGET_TRAINING_DATA - CURRENT ))
  THIS=$(( BATCH_SIZE < NEED ? BATCH_SIZE : NEED ))
  psql -d records -c "SET statement_timeout = '${STATEMENT_TIMEOUT}s';
INSERT INTO ai.training_data (record_id, features, target_value, data_source, quality_score, used_in_training)
SELECT gen_random_uuid(), '{\"price\": 50}'::jsonb, (random() * 300 + 10)::numeric(10,2), (ARRAY['discogs','popsike','manual'])[1 + (g.n % 3)], (random() * 0.5 + 0.5)::numeric(5,4), (random() > 0.3)
FROM generate_series(1, $THIS) AS g(n);
" >/dev/null 2>&1 || break
  CURRENT=$(psql -d records -tAc "SELECT count(*) FROM ai.training_data;" 2>/dev/null | tr -d ' ')
  echo "$(ts)   training_data: $CURRENT"
done

# 4) ai.record_embeddings — FK model_id, UNIQUE(record_id, model_id); sample model IDs once per batch
CURRENT=$(psql -d records -tAc "SELECT count(*) FROM ai.record_embeddings;" 2>/dev/null | tr -d ' ' || echo "0")
echo "$(ts) ai.record_embeddings: $CURRENT (target $TARGET_EMBEDDINGS)"
while [[ "$CURRENT" -lt "$TARGET_EMBEDDINGS" ]]; do
  NEED=$(( TARGET_EMBEDDINGS - CURRENT ))
  THIS=$(( BATCH_SIZE < NEED ? BATCH_SIZE : NEED ))
  psql -d records -c "SET statement_timeout = '${STATEMENT_TIMEOUT}s';
WITH model_sample AS (
  SELECT id, row_number() OVER () AS rn FROM (SELECT id FROM ai.model_metadata ORDER BY random() LIMIT 100) t
),
series AS (SELECT g.n FROM generate_series(1, $THIS) AS g(n))
INSERT INTO ai.record_embeddings (record_id, model_id, embedding_data)
SELECT gen_random_uuid(), (SELECT id FROM model_sample WHERE rn = 1 + (s.n % (SELECT count(*) FROM model_sample))), decode(md5(s.n::text), 'hex')
FROM series s
ON CONFLICT (record_id, model_id) DO NOTHING;
" >/dev/null 2>&1 || break
  CURRENT=$(psql -d records -tAc "SELECT count(*) FROM ai.record_embeddings;" 2>/dev/null | tr -d ' ')
  echo "$(ts)   record_embeddings: $CURRENT"
done

echo "$(ts) Done. Run run_python-ai_pgbench_sweep.sh for benchmarking."
