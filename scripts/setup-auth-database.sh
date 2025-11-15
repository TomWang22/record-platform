#!/usr/bin/env bash
set -euo pipefail

NS="${NS:-record-platform}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

say "=== Setting up Auth Database ==="

PG_POD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [[ -z "$PG_POD" ]]; then
  fail "PostgreSQL pod not found"
fi

say "Creating schemas, roles, and tables..."

kubectl -n "$NS" exec "$PG_POD" -c db -- psql -U postgres -d records -X -P pager=off -v ON_ERROR_STOP=1 <<'SQL'
-- Create schemas
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS records;

-- Create record_app role (PostgreSQL doesn't support IF NOT EXISTS for CREATE ROLE)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'record_app') THEN
    CREATE ROLE record_app WITH LOGIN PASSWORD 'SUPER_STRONG_APP_PASSWORD';
  END IF;
END
$$;

-- Grant permissions
GRANT USAGE ON SCHEMA public, auth, records TO record_app;

-- Create auth.users table
CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT UNIQUE NOT NULL,
  password_hash TEXT,
  settings JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Grant permissions on table
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.users TO record_app;

-- Verify setup
SELECT 'Schemas created:' as status;
SELECT schema_name FROM information_schema.schemata WHERE schema_name IN ('auth', 'records');

SELECT 'Tables created:' as status;
SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema = 'auth';

SELECT 'Roles created:' as status;
SELECT rolname FROM pg_roles WHERE rolname = 'record_app';

ok "Database setup complete"
SQL

say "=== Testing connection as record_app ==="
kubectl -n "$NS" exec "$PG_POD" -c db -- psql -U record_app -d records -c "SET search_path = auth; SELECT current_schema, COUNT(*) as user_count FROM users;" 2>&1 | head -5

ok "Auth database setup complete!"

