CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_records_artist_trgm ON records."Record" USING gin ("artist" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_records_catalog ON records."Record" ("catalogNumber");
