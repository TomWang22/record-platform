\echo '=== records.records partition cutover ==='
\echo 'Ensure Prisma schema/client have been updated before running.'

BEGIN;

-------------------------------------------------------------------------------
-- Acquire locks to guarantee exclusive access during swap
-------------------------------------------------------------------------------
LOCK TABLE records.records                IN ACCESS EXCLUSIVE MODE;
LOCK TABLE records.records_partitioned    IN ACCESS EXCLUSIVE MODE;
LOCK TABLE records.record_media           IN ACCESS EXCLUSIVE MODE;
LOCK TABLE records.aliases                IN ACCESS EXCLUSIVE MODE;

-------------------------------------------------------------------------------
-- Drop FKs that still point at the legacy primary key
-------------------------------------------------------------------------------
ALTER TABLE records.record_media DROP CONSTRAINT IF EXISTS record_media_record_id_fkey;
ALTER TABLE records.aliases      DROP CONSTRAINT IF EXISTS aliases_record_id_fkey;

-------------------------------------------------------------------------------
-- Rename tables (legacy -> records_legacy, partitioned -> records)
-------------------------------------------------------------------------------
ALTER TABLE records.records RENAME TO records_legacy;
ALTER TABLE records.records_partitioned RENAME TO records;

-------------------------------------------------------------------------------
-- Rename primary key constraints to preserve historic names
-------------------------------------------------------------------------------
ALTER TABLE records.records_legacy RENAME CONSTRAINT records_pkey TO records_legacy_pkey;
ALTER TABLE records.records      RENAME CONSTRAINT records_partitioned_pkey TO records_pkey;

-------------------------------------------------------------------------------
-- Update dependent table keys and constraints
-------------------------------------------------------------------------------
ALTER TABLE records.record_media DROP CONSTRAINT IF EXISTS record_media_pkey;
ALTER TABLE records.record_media ADD CONSTRAINT record_media_pkey PRIMARY KEY (id, user_id);

ALTER TABLE records.record_media DROP CONSTRAINT IF EXISTS record_media_record_id_index_key;
ALTER TABLE records.record_media ADD CONSTRAINT record_media_record_id_user_id_index_key
  UNIQUE (record_id, user_id, index);

ALTER TABLE records.record_media
  ADD CONSTRAINT record_media_record_id_fkey
    FOREIGN KEY (record_id, user_id)
    REFERENCES records.records (id, user_id)
    ON DELETE CASCADE;

ALTER TABLE records.aliases DROP CONSTRAINT IF EXISTS aliases_pkey;
ALTER TABLE records.aliases ADD CONSTRAINT aliases_pkey
  PRIMARY KEY (record_id, user_id, alias);

ALTER TABLE records.aliases
  ADD CONSTRAINT aliases_record_id_fkey
    FOREIGN KEY (record_id, user_id)
    REFERENCES records.records (id, user_id)
    ON DELETE CASCADE;

-------------------------------------------------------------------------------
-- Recreate table triggers on the new partitioned parent
-------------------------------------------------------------------------------
CREATE TRIGGER trg_records_touch
BEFORE UPDATE ON records.records
FOR EACH ROW EXECUTE FUNCTION records.touch_updated_at();

CREATE TRIGGER trg_records_norm
BEFORE INSERT OR UPDATE ON records.records
FOR EACH ROW EXECUTE FUNCTION records.set_norm_cols();

CREATE TRIGGER records_hot_sync_ins
AFTER INSERT ON records.records
FOR EACH ROW EXECUTE FUNCTION records_hot.sync_hot();

CREATE TRIGGER records_hot_sync_del
AFTER DELETE ON records.records
FOR EACH ROW EXECUTE FUNCTION records_hot.sync_hot();

CREATE TRIGGER records_hot_sync_upd
AFTER UPDATE OF user_id, search_norm ON records.records
FOR EACH ROW EXECUTE FUNCTION records_hot.sync_hot();

-------------------------------------------------------------------------------
-- Drop dual-write triggers/functions on the legacy table
-------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_records_mirror_upsert ON records.records_legacy;
DROP TRIGGER IF EXISTS trg_records_mirror_delete ON records.records_legacy;
DROP FUNCTION IF EXISTS records.mirror_records_partitioned();
DROP FUNCTION IF EXISTS records.delete_records_partitioned();

COMMIT;

\echo 'Cutover complete. Validate counts, run VACUUM ANALYZE on records.records, and refresh dependent materialized views.'

