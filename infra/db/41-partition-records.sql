\echo '=== records.records partition migration helper ==='
\echo 'This script prepares dependent tables and builds the hash-partitioned replacement.'
\echo 'Review docs/db-partition-migration.md for the full runbook before executing.'

BEGIN;

-------------------------------------------------------------------------------
-- 1. Ensure dependent tables carry user_id
-------------------------------------------------------------------------------
\echo '-> Adding user_id to dependent tables if missing'

ALTER TABLE records.record_media
  ADD COLUMN IF NOT EXISTS user_id uuid;

UPDATE records.record_media rm
SET user_id = r.user_id
FROM records.records r
WHERE rm.record_id = r.id
  AND rm.user_id IS DISTINCT FROM r.user_id;

ALTER TABLE records.record_media
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE records.aliases
  ADD COLUMN IF NOT EXISTS user_id uuid;

UPDATE records.aliases a
SET user_id = r.user_id
FROM records.records r
WHERE a.record_id = r.id
  AND a.user_id IS DISTINCT FROM r.user_id;

ALTER TABLE records.aliases
  ALTER COLUMN user_id SET NOT NULL;

-------------------------------------------------------------------------------
-- 2. Build the new partitioned table
-------------------------------------------------------------------------------
\echo '-> Creating partitioned replacement table records.records_partitioned'

DROP TABLE IF EXISTS records.records_partitioned CASCADE;

CREATE TABLE records.records_partitioned (
  LIKE records.records INCLUDING DEFAULTS INCLUDING GENERATED
)
PARTITION BY HASH (user_id);

ALTER TABLE records.records_partitioned
  ADD PRIMARY KEY (id, user_id);

-------------------------------------------------------------------------------
-- 3. Create hash partitions (32 buckets)
-------------------------------------------------------------------------------
\echo '-> Creating hash partitions records.records_p00 .. records.records_p31'

DO $$
DECLARE
  i integer;
  suffix text;
BEGIN
  FOR i IN 0..31 LOOP
    suffix := lpad(i::text, 2, '0');
    EXECUTE format(
      'CREATE TABLE records.records_p%s PARTITION OF records.records_partitioned
         FOR VALUES WITH (MODULUS 32, REMAINDER %s);',
      suffix,
      i
    );
  END LOOP;
END
$$;

-------------------------------------------------------------------------------
-- 4. Recreate indexes on the parent (these cascade to partitions)
-------------------------------------------------------------------------------
\echo '-> Creating indexes on partitioned parent'

CREATE INDEX IF NOT EXISTS idx_records_partitioned_artist_gist_trgm
  ON records.records_partitioned USING gist (artist_norm gist_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_records_partitioned_catalog_gist_trgm
  ON records.records_partitioned USING gist (catalog_norm gist_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_records_partitioned_label_gist_trgm
  ON records.records_partitioned USING gist (label_norm gist_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_records_partitioned_name_gist_trgm
  ON records.records_partitioned USING gist (name_norm gist_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_records_partitioned_name_trgm
  ON records.records_partitioned USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_records_partitioned_artist_trgm
  ON records.records_partitioned USING gin (artist gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_records_partitioned_catalog_trgm
  ON records.records_partitioned USING gin (catalog_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_records_partitioned_user
  ON records.records_partitioned USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_records_partitioned_user_updated
  ON records.records_partitioned USING btree (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_records_partitioned_search_norm_gist
  ON records.records_partitioned USING gist (search_norm gist_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_records_partitioned_search_norm_gin
  ON records.records_partitioned USING gin (search_norm gin_trgm_ops);

-------------------------------------------------------------------------------
-- 5. Hot-tenant partial indexes (need to be recreated after swap if tenant set changes)
-------------------------------------------------------------------------------
\echo '-> Recreating tenant-scoped partial indexes'

CREATE INDEX IF NOT EXISTS records_partitioned_hot_knn_main
  ON records.records_partitioned USING gist (search_norm gist_trgm_ops)
  WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;

CREATE INDEX IF NOT EXISTS records_partitioned_hot_gin_main
  ON records.records_partitioned USING gin (search_norm gin_trgm_ops)
  WITH (fastupdate=off)
  WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;

-------------------------------------------------------------------------------
-- 6. Dual-write triggers during transition
-------------------------------------------------------------------------------
\echo '-> Installing mirror triggers between legacy and partition tables'

DROP TRIGGER IF EXISTS trg_records_mirror_upsert ON records.records;
DROP TRIGGER IF EXISTS trg_records_mirror_delete ON records.records;
DROP FUNCTION IF EXISTS records.mirror_records_partitioned();
DROP FUNCTION IF EXISTS records.delete_records_partitioned();

CREATE OR REPLACE FUNCTION records.mirror_records_partitioned()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO records.records_partitioned VALUES (NEW.*)
  ON CONFLICT (id, user_id) DO UPDATE
    SET artist               = EXCLUDED.artist,
        name                 = EXCLUDED.name,
        format               = EXCLUDED.format,
        catalog_number       = EXCLUDED.catalog_number,
        record_grade         = EXCLUDED.record_grade,
        sleeve_grade         = EXCLUDED.sleeve_grade,
        has_insert           = EXCLUDED.has_insert,
        has_booklet          = EXCLUDED.has_booklet,
        has_obi_strip        = EXCLUDED.has_obi_strip,
        has_factory_sleeve   = EXCLUDED.has_factory_sleeve,
        is_promo             = EXCLUDED.is_promo,
        notes                = EXCLUDED.notes,
        purchased_at         = EXCLUDED.purchased_at,
        price_paid           = EXCLUDED.price_paid,
        created_at           = EXCLUDED.created_at,
        updated_at           = EXCLUDED.updated_at,
        insert_grade         = EXCLUDED.insert_grade,
        booklet_grade        = EXCLUDED.booklet_grade,
        obi_strip_grade      = EXCLUDED.obi_strip_grade,
        factory_sleeve_grade = EXCLUDED.factory_sleeve_grade,
        release_year         = EXCLUDED.release_year,
        release_date         = EXCLUDED.release_date,
        pressing_year        = EXCLUDED.pressing_year,
        label                = EXCLUDED.label,
        label_code           = EXCLUDED.label_code,
        artist_norm          = EXCLUDED.artist_norm,
        name_norm            = EXCLUDED.name_norm,
        label_norm           = EXCLUDED.label_norm,
        catalog_norm         = EXCLUDED.catalog_norm,
        search_norm          = EXCLUDED.search_norm;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION records.delete_records_partitioned()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM records.records_partitioned
  WHERE id = OLD.id
    AND user_id = OLD.user_id;
  RETURN OLD;
END $$;

CREATE TRIGGER trg_records_mirror_upsert
AFTER INSERT OR UPDATE ON records.records
FOR EACH ROW EXECUTE FUNCTION records.mirror_records_partitioned();

CREATE TRIGGER trg_records_mirror_delete
AFTER DELETE ON records.records
FOR EACH ROW EXECUTE FUNCTION records.delete_records_partitioned();

COMMIT;

\echo '=== Partition preparation complete ==='
\echo 'Next steps:'
\echo '  1) Backfill via:'
\echo '       INSERT INTO records.records_partitioned SELECT * FROM records.records ON CONFLICT DO NOTHING;'
\echo '  2) Validate counts and run VACUUM/ANALYZE on records_partitioned'
\echo '  3) Follow docs/db-partition-migration.md to swap tables and rebuild foreign keys'

