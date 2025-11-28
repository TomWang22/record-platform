-- Passkey (WebAuthn) Support for Auth Service
-- Run on PostgreSQL port 5437
-- Database: records (or auth, depending on setup)

SET ROLE postgres;

-- Create auth schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS auth;

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ============================================================
-- PASSKEYS (WebAuthn) TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS auth.passkeys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id   TEXT NOT NULL UNIQUE, -- Base64URL encoded credential ID
  public_key      TEXT NOT NULL, -- Base64URL encoded public key
  counter         BIGINT NOT NULL DEFAULT 0, -- Signature counter for replay protection
  device_name     TEXT, -- User-friendly device name (e.g., "iPhone 15", "YubiKey")
  device_type     TEXT, -- 'platform' (built-in) or 'cross-platform' (USB key, etc.)
  last_used_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, credential_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_passkeys_user_id ON auth.passkeys(user_id);
CREATE INDEX IF NOT EXISTS idx_passkeys_credential_id ON auth.passkeys(credential_id);
CREATE INDEX IF NOT EXISTS idx_passkeys_last_used ON auth.passkeys(last_used_at DESC);

-- Challenge table for passkey registration/authentication
CREATE TABLE IF NOT EXISTS auth.passkey_challenges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  challenge       TEXT NOT NULL, -- Base64URL encoded challenge
  type            TEXT NOT NULL CHECK (type IN ('registration', 'authentication')),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_passkey_challenges_user_id ON auth.passkey_challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_passkey_challenges_challenge ON auth.passkey_challenges(challenge);
CREATE INDEX IF NOT EXISTS idx_passkey_challenges_expires ON auth.passkey_challenges(expires_at);

-- Function to clean up expired challenges
CREATE OR REPLACE FUNCTION auth.cleanup_expired_challenges()
RETURNS void AS $$
BEGIN
  DELETE FROM auth.passkey_challenges WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-cleanup expired challenges (runs on insert)
-- Note: In production, you might want a scheduled job instead
CREATE OR REPLACE FUNCTION auth.cleanup_challenges_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  -- Clean up expired challenges periodically
  IF random() < 0.1 THEN -- 10% chance to cleanup on each insert
    PERFORM auth.cleanup_expired_challenges();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_passkey_challenges_cleanup ON auth.passkey_challenges;
CREATE TRIGGER trg_passkey_challenges_cleanup
  AFTER INSERT ON auth.passkey_challenges
  FOR EACH ROW
  EXECUTE FUNCTION auth.cleanup_challenges_on_insert();

-- ============================================================
-- GRANTS
-- ============================================================

GRANT ALL PRIVILEGES ON SCHEMA auth TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA auth TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA auth TO postgres;

ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON SEQUENCES TO postgres;

