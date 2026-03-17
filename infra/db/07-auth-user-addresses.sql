-- Auth: user addresses and country for tax and shipping (all services can use via Auth API).
-- Run on port 5437 (auth DB). Users can update address/country; this drives tax rate and shipping cost.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.user_addresses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,  -- auth.users(id)
  label           VARCHAR(64),    -- 'Home', 'Work', 'Default'
  country_code    CHAR(2) NOT NULL,  -- ISO 3166-1 alpha-2 (US, GB, JP, ...) for tax and shipping
  region          VARCHAR(128),   -- State, province, prefecture
  postal_code     VARCHAR(32),
  address_line1   VARCHAR(256) NOT NULL,
  address_line2   VARCHAR(256),
  city            VARCHAR(128),
  is_default      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_addresses_id UNIQUE (id)
);

CREATE INDEX IF NOT EXISTS idx_user_addresses_user_id ON auth.user_addresses(user_id);
CREATE INDEX IF NOT EXISTS idx_user_addresses_country ON auth.user_addresses(country_code);
CREATE INDEX IF NOT EXISTS idx_user_addresses_user_default ON auth.user_addresses(user_id, is_default) WHERE is_default = TRUE;

-- Optional: default address on users for quick lookup (denormalized)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'default_address_id') THEN
    ALTER TABLE auth.users ADD COLUMN default_address_id UUID;
    COMMENT ON COLUMN auth.users.default_address_id IS 'FK to auth.user_addresses(id); used for tax/shipping';
  END IF;
END $$;

COMMENT ON TABLE auth.user_addresses IS 'User addresses; country_code drives tax rate and shipping. All DBs access via Auth API or shared reference.';
