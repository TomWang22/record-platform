-- Auth Service Database Schema
-- Run on PostgreSQL port 5437
-- Database: records (or auth, depending on setup)
-- User: postgres / postgres (or configure as needed)

SET ROLE postgres;

-- Create auth schema
CREATE SCHEMA IF NOT EXISTS auth;

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ============================================================
-- AUTH SCHEMA
-- ============================================================

-- Users table (moved from main database)
-- Extended columns (email_verified, phone_verified, mfa_enabled) required by auth-service and pgbench
CREATE TABLE IF NOT EXISTS auth.users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         CITEXT UNIQUE NOT NULL,
  password_hash TEXT,
  settings      JSONB DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  phone         TEXT,
  email_verified BOOLEAN DEFAULT FALSE,
  phone_verified BOOLEAN DEFAULT FALSE,
  mfa_enabled   BOOLEAN DEFAULT FALSE,
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON auth.users(email);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON auth.users(created_at DESC);

-- ============================================================
-- GRANTS (if using role-based access)
-- ============================================================

-- Grant permissions to postgres user (adjust as needed)
GRANT ALL PRIVILEGES ON SCHEMA auth TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA auth TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA auth TO postgres;

-- Set default privileges for future objects
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON SEQUENCES TO postgres;

