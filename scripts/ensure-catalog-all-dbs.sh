#!/usr/bin/env bash
# Create catalog schema (data_lake, data_model, data_object) on all 8 DBs and populate from information_schema.
# Run after DBs are up. Safe to run multiple times (idempotent inserts / upserts where needed).
# Ports: 5433=records, 5434=social, 5435=listings, 5436=shopping, 5437=auth, 5438=analytics, 5439=auction_monitor, 5440=python_ai.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DDL="$REPO_ROOT/infra/db/11-catalog-data-lake-model.sql"
PGHOST="${PGHOST:-127.0.0.1}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

if [[ ! -f "$DDL" ]]; then
  warn "Catalog DDL not found: $DDL"
  exit 0
fi

# port -> data_lake name
declare -A LAKE_NAME
LAKE_NAME[5433]=records
LAKE_NAME[5434]=social
LAKE_NAME[5435]=listings
LAKE_NAME[5436]=shopping
LAKE_NAME[5437]=auth
LAKE_NAME[5438]=analytics
LAKE_NAME[5439]=auction_monitor
LAKE_NAME[5440]=python_ai

for port in 5433 5434 5435 5436 5437 5438 5439 5440; do
  name="${LAKE_NAME[$port]:-$port}"
  connected=""
  for db in records postgres; do
    if PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U postgres -d "$db" -tAc "SELECT 1" >/dev/null 2>&1; then
      connected="$db"
      break
    fi
  done
  if [[ -z "$connected" ]]; then
    warn "Cannot connect to port $port ($name), skipping catalog"
    continue
  fi
  if ! PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U postgres -d "$connected" -f "$DDL" >/dev/null 2>&1; then
    warn "Catalog DDL on $name (port $port) had issues"
    continue
  fi
  # Populate: one data_lake row, then data_model from schemata, then data_object from tables
  PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U postgres -d "$connected" -v ON_ERROR_STOP=0 -v lake_name="$name" <<'EOSQL'
INSERT INTO catalog.data_lake (name, description) VALUES (:'lake_name', 'Data lake for ' || :'lake_name' || ' DB')
  ON CONFLICT (name) DO NOTHING;
EOSQL
  PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U postgres -d "$connected" -v ON_ERROR_STOP=0 -v lake_name="$name" <<'EOSQL'
INSERT INTO catalog.data_model (data_lake_id, name, schema_name)
SELECT l.id, s.schema_name, s.schema_name
FROM catalog.data_lake l,
     (SELECT schema_name FROM information_schema.schemata
      WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast','catalog') AND schema_name NOT LIKE 'pg_%') s
WHERE l.name = :'lake_name'
ON CONFLICT (data_lake_id, schema_name) DO NOTHING;
EOSQL
  PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$port" -U postgres -d "$connected" -v ON_ERROR_STOP=0 <<'EOSQL'
INSERT INTO catalog.data_object (data_model_id, schema_name, object_name, object_type)
SELECT dm.id, t.table_schema, t.table_name, t.table_type
FROM information_schema.tables t
JOIN catalog.data_model dm ON dm.schema_name = t.table_schema
WHERE t.table_schema NOT IN ('pg_catalog','information_schema')
ON CONFLICT (data_model_id, schema_name, object_name) DO NOTHING;
EOSQL
  ok "Catalog applied and populated for $name (port $port, db $connected)"
done
exit 0