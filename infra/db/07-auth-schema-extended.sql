-- Extended Auth Service Database Schema
-- Adds OAuth, MFA, and verification code support
-- Run on PostgreSQL port 5437 (auth database)

SET ROLE postgres;

-- Ensure auth schema exists
CREATE SCHEMA IF NOT EXISTS auth;

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ============================================================
-- EXTENDED USERS TABLE
-- ============================================================

-- Add new columns to users table (if they don't exist)
DO $$ 
BEGIN
  -- Phone number for SMS verification
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'phone') THEN
    ALTER TABLE auth.users ADD COLUMN phone TEXT;
  END IF;

  -- Email verification status
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'email_verified') THEN
    ALTER TABLE auth.users ADD COLUMN email_verified BOOLEAN DEFAULT FALSE;
  END IF;

  -- Phone verification status
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'phone_verified') THEN
    ALTER TABLE auth.users ADD COLUMN phone_verified BOOLEAN DEFAULT FALSE;
  END IF;

  -- MFA enabled flag
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'mfa_enabled') THEN
    ALTER TABLE auth.users ADD COLUMN mfa_enabled BOOLEAN DEFAULT FALSE;
  END IF;

  -- Updated timestamp
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'updated_at') THEN
    ALTER TABLE auth.users ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
  END IF;
END $$;

-- Create trigger to update updated_at
CREATE OR REPLACE FUNCTION auth.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON auth.users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION auth.update_updated_at();

-- ============================================================
-- OAUTH PROVIDERS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS auth.oauth_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, -- 'google', 'github', etc.
  provider_user_id TEXT NOT NULL, -- External provider's user ID
  email TEXT, -- Email from provider
  profile_data JSONB, -- Full profile data from provider
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_user_id ON auth.oauth_providers(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_provider_user ON auth.oauth_providers(provider, provider_user_id);

-- ============================================================
-- MFA SETTINGS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS auth.mfa_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  totp_secret TEXT NOT NULL, -- Base32 encoded TOTP secret
  backup_codes TEXT[], -- Array of hashed backup codes
  enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mfa_user_id ON auth.mfa_settings(user_id);

-- ============================================================
-- VERIFICATION CODES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS auth.verification_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'email' or 'phone'
  target TEXT NOT NULL, -- Email address or phone number
  code TEXT NOT NULL, -- Verification code (hashed)
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verification_user_type ON auth.verification_codes(user_id, type);
CREATE INDEX IF NOT EXISTS idx_verification_target ON auth.verification_codes(target);
CREATE INDEX IF NOT EXISTS idx_verification_expires ON auth.verification_codes(expires_at);

-- Cleanup expired codes (run periodically)
CREATE OR REPLACE FUNCTION auth.cleanup_expired_codes()
RETURNS void AS $$
BEGIN
  DELETE FROM auth.verification_codes
  WHERE expires_at < now() OR used = TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SESSIONS TABLE (minimal; for pgbench and session store)
-- ============================================================
CREATE TABLE IF NOT EXISTS auth.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON auth.sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON auth.sessions(expires_at);

-- ============================================================
-- GRANTS
-- ============================================================

GRANT ALL PRIVILEGES ON SCHEMA auth TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA auth TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA auth TO postgres;

ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON SEQUENCES TO postgres;

