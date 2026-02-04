-- Untangle records from auth: drop FK so records.user_id is a plain UUID.
-- Auth stays on 5437 (standalone); records on 5433. No cross-DB FK.
-- Run once: PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d records -f infra/db/drop-records-user-id-fk.sql

ALTER TABLE records.records DROP CONSTRAINT IF EXISTS records_user_id_fkey;
