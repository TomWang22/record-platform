-- Listings: seller availability (offline/unavailable), preferred hours. Alert buyers if seller offline.
-- Run on port 5435 (listings DB). Anyone can be a seller; this is "heads up" for buyers.

CREATE TABLE IF NOT EXISTS listings.seller_availability (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL UNIQUE,
  is_available      BOOLEAN NOT NULL DEFAULT TRUE,
  preferred_hours   TEXT,            -- e.g. "Mon-Fri 9am-5pm EST", or JSONB for structured
  unavailable_until  TIMESTAMPTZ,    -- e.g. vacation end
  message           TEXT,            -- e.g. "On vacation until Jan 15"
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seller_availability_user ON listings.seller_availability(user_id);
CREATE INDEX IF NOT EXISTS idx_seller_availability_available ON listings.seller_availability(is_available) WHERE is_available = FALSE;

COMMENT ON TABLE listings.seller_availability IS 'Seller availability; buyers see alert if offline or outside preferred hours';
