-- Listings: when a report is created, app/job notifies seller via shopping.notifications (dual write).
-- This file adds optional complaint_sent_at on listing_reports so we don't double-send.
-- Run on port 5435 (listings DB). Actual notification insert is in application (shopping DB).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'listings' AND table_name = 'listing_reports' AND column_name = 'complaint_sent_at') THEN
    ALTER TABLE listings.listing_reports ADD COLUMN complaint_sent_at TIMESTAMPTZ;
    COMMENT ON COLUMN listings.listing_reports.complaint_sent_at IS 'When complaint/notification was sent to lister (app dual-writes to shopping.notifications)';
  END IF;
END $$;

-- Application flow: on INSERT listing_reports, resolve listings.listings.user_id = lister,
-- then INSERT shopping.notifications (user_id=lister, type=listing_reported, body=reason_text, payload={listing_id,report_id}),
-- then UPDATE listing_reports SET complaint_sent_at = now() WHERE id = report_id.
