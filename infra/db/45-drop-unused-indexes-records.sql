-- Drop known-unused indexes on records.records only. Run on records DB (port 5433).
-- PROTECTED (never drop): idx_records_*_bench, idx_records_search_tsv_all,
--   idx_records_user_id_btree, ix_records_user_id_updated_at.
-- Unused indexes waste shared_buffers and slow writes/planning.

SET search_path = records, public;

DROP INDEX CONCURRENTLY IF EXISTS records.idx_records_partitioned_artist_trgm;
DROP INDEX CONCURRENTLY IF EXISTS records.idx_records_partitioned_name_trgm;
DROP INDEX CONCURRENTLY IF EXISTS records.idx_records_partitioned_catalog_trgm;
DROP INDEX CONCURRENTLY IF EXISTS records.ix_records_artist_trgm;
DROP INDEX CONCURRENTLY IF EXISTS records.ix_records_name_trgm;
DROP INDEX CONCURRENTLY IF EXISTS records.ix_records_catalog_trgm;
