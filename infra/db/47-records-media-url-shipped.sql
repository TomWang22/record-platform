-- Idempotent: persist cover image URLs on record media and ship date on records.
-- Run on records database (port 5433). Aligns with services/records-service/prisma/schema.prisma.

\echo '=== records: media url_or_path + records.shipped_at (47-records-media-url-shipped) ==='

ALTER TABLE records.record_media ADD COLUMN IF NOT EXISTS url_or_path TEXT;
ALTER TABLE records.records ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;

\echo 'Done. records.record_media.url_or_path and records.records.shipped_at ready.'
