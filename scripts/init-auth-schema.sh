#!/usr/bin/env bash
set -euo pipefail

# Script to initialize the auth schema and users table
# This fixes the issue where auth.users table doesn't exist

NS="${NS:-record-platform}"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5433}"
PGUSER="${PGUSER:-postgres}"
PGDATABASE="${PGDATABASE:-records}"
PGPASSWORD="${PGPASSWORD:-postgres}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

say "=== Initializing Auth Schema ==="

# Check if we're connecting to Kubernetes or local
# CRITICAL: Since auth-service connects via host.docker.internal (which may not work from kind),
# we need to create the schema in BOTH places:
# 1. Kubernetes Postgres (what auth-service might actually connect to)
# 2. Docker Postgres (what run_pgbench_sweep.sh uses)

say "Initializing auth schema in all Postgres instances..."

# Function to initialize schema in a given Postgres
init_schema() {
  local name="$1"
  shift
  say "Initializing auth schema in $name..."
  "$@" <<'SQL'
-- Ensure required extensions exist
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create auth schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS auth;

-- Grant usage to record_app role (if it exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_app') THEN
    GRANT USAGE ON SCHEMA auth TO record_app;
  END IF;
END $$;

-- Create auth.users table matching Prisma schema exactly
CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT NOT NULL,
  password_hash TEXT NOT NULL,
  settings JSONB,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT users_email_key UNIQUE (email)
);

-- Create index on email
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON auth.users(email);

-- Grant permissions to record_app role (if it exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON auth.users TO record_app;
  END IF;
END $$;

-- Insert seed users (idempotent)
INSERT INTO auth.users(id, email, password_hash, created_at) VALUES
  ('00000000-0000-0000-0000-0000000000aa', 'pvc@test.local', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', CURRENT_TIMESTAMP),
  ('2901355e-7d04-4da1-b3a7-c22807326b94', 'seed@example.com', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', CURRENT_TIMESTAMP),
  ('0dc268d0-a86f-4e12-8d10-9db0f1b735e0', 'tom@example.com', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', CURRENT_TIMESTAMP),
  ('950a40b1-d12e-4839-aefd-0d353b90182a', 'tw5126@example.com', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;

-- Verify
SELECT 'Schema initialized' as status, count(*) as user_count FROM auth.users;
SQL
}

# Initialize in Kubernetes Postgres (if it exists)
if kubectl -n "$NS" get deployment postgres >/dev/null 2>&1; then
  if init_schema "Kubernetes Postgres" kubectl -n "$NS" exec deploy/postgres -c db -- psql -U postgres -d records; then
    ok "Kubernetes Postgres schema initialized"
  else
    warn "Failed to initialize Kubernetes Postgres schema"
  fi
fi

# Initialize in Docker Postgres (external)
say "Initializing auth schema in Docker Postgres..."
export PGPASSWORD
if init_schema "Docker Postgres" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE"; then
  ok "Docker Postgres schema initialized"
else
  warn "Failed to initialize Docker Postgres schema (may not be running)"
fi

# Use Kubernetes Postgres for verification (since that's what auth-service likely uses)
if kubectl -n "$NS" get deployment postgres >/dev/null 2>&1; then
  psql_cmd() {
    kubectl -n "$NS" exec deploy/postgres -c db -- psql -U postgres -d records "$@"
  }
else
  export PGPASSWORD
  psql_cmd() {
    psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" "$@"
  }
fi

say "Creating auth schema and users table..."

psql_cmd -v ON_ERROR_STOP=1 <<'SQL'
-- Ensure required extensions exist
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create auth schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS auth;

-- Grant usage to record_app role (if it exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_app') THEN
    GRANT USAGE ON SCHEMA auth TO record_app;
  END IF;
END $$;

-- Create auth.users table matching Prisma schema exactly
-- Prisma schema: id UUID, email CITEXT unique, password_hash TEXT NOT NULL, settings JSONB, created_at TIMESTAMP(3)
CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT NOT NULL,
  password_hash TEXT NOT NULL,
  settings JSONB,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT users_email_key UNIQUE (email)
);

-- Create index on email (Prisma migration creates this)
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON auth.users(email);

-- Grant permissions to record_app role (if it exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'record_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON auth.users TO record_app;
    -- Note: UUID default uses gen_random_uuid(), not a sequence, so no sequence grant needed
  END IF;
END $$;

-- Insert seed users (idempotent - ON CONFLICT DO NOTHING)
-- Using bcrypt hash for 'password' (10 rounds) as default password for all seed users
-- This is a real bcrypt hash of 'password' - all seed users can login with password: "password"
-- For production, use proper password hashes
INSERT INTO auth.users(id, email, password_hash, created_at) VALUES
  ('00000000-0000-0000-0000-0000000000aa', 'pvc@test.local', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', CURRENT_TIMESTAMP),
  ('2901355e-7d04-4da1-b3a7-c22807326b94', 'seed@example.com', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', CURRENT_TIMESTAMP),
  ('0dc268d0-a86f-4e12-8d10-9db0f1b735e0', 'tom@example.com', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', CURRENT_TIMESTAMP),
  ('950a40b1-d12e-4839-aefd-0d353b90182a', 'tw5126@example.com', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;

-- Verify table was created and has seed data
SELECT 
  schemaname,
  tablename,
  (SELECT count(*) FROM auth.users) as row_count
FROM pg_tables 
WHERE schemaname = 'auth' AND tablename = 'users';

-- Show inserted users
SELECT id, email, created_at FROM auth.users ORDER BY created_at;
SQL

if [[ $? -eq 0 ]]; then
  ok "Auth schema and users table created successfully"
  
  say "Verifying schema..."
  psql_cmd -c "\dn auth" || warn "Schema verification failed"
  psql_cmd -c "\dt auth.*" || warn "Table verification failed"
  
  say "Testing auth-service connection..."
  # Check if auth-service can see the table
  if kubectl -n "$NS" get deployment auth-service >/dev/null 2>&1; then
    say "Auth service deployment found - you may need to restart it to pick up the schema"
    say "To restart: kubectl -n $NS rollout restart deployment/auth-service"
  fi
else
  fail "Failed to create auth schema"
fi

say "=== Auth Schema Initialization Complete ==="

