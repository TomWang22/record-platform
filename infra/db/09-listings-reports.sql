-- Listings: report/flag items (with valid reason); message to lister; lister must take down if upheld.
-- Run on port 5435 (listings DB). Can integrate with social messaging to notify lister.

CREATE TABLE IF NOT EXISTS listings.listing_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id      UUID NOT NULL REFERENCES listings.listings(id) ON DELETE CASCADE,
  reporter_id     UUID NOT NULL,
  reason_code     VARCHAR(64) NOT NULL,  -- 'wrong_item', 'counterfeit', 'misleading', 'prohibited', 'other'
  reason_text     TEXT,                  -- Required detail for valid reason
  status          VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'upheld', 'dismissed', 'listing_removed')),
  message_to_lister_id UUID,             -- Optional: FK to social message (e.g. messages.messages) when sent to lister
  reviewed_at     TIMESTAMPTZ,
  reviewed_by     UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_reports_listing ON listings.listing_reports(listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_reports_reporter ON listings.listing_reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_listing_reports_status ON listings.listing_reports(status);

COMMENT ON TABLE listings.listing_reports IS 'Flag/report incorrect listings; valid reason required. Message sent to lister; lister must take down if upheld.';
