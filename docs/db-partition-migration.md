## records.records Partition Migration Runbook

> **Status:** Draft – review and rehearse in non-prod before executing

This document outlines the operational steps to convert `records.records` into a hash-partitioned table keyed on `user_id`. The migration keeps the existing table online using dual-write triggers, then swaps in the new parent once backfill completes.

### 0. Pre-flight

- Ensure a recent base backup exists and WAL archiving is healthy.
- Confirm no long-running transactions on `records.records`.
- Pull latest code and apply the Prisma schema changes in `services/records-service/prisma/schema.prisma`.

### 1. Update dependent tables (one-time)

```sql
\i infra/db/41-partition-records.sql
```

This script:

- Adds `user_id` to `records.record_media` and `records.aliases`.
- Builds `records.records_partitioned` partitioned by hash (`MODULUS 32`).
- Recreates indexes/partial indexes on the new parent.
- Installs dual-write triggers so `records.records_partitioned` stays current.

Validate `user_id` fill-in:

```sql
SELECT count(*) FROM records.record_media WHERE user_id IS NULL;
SELECT count(*) FROM records.aliases WHERE user_id IS NULL;
```

### 2. Backfill

```sql
INSERT INTO records.records_partitioned
SELECT * FROM records.records
ON CONFLICT DO NOTHING;
```

Large datasets may require batching by `user_id` to watch progress:

```sql
INSERT INTO records.records_partitioned
SELECT * FROM records.records
WHERE user_id BETWEEN '00000000-0000-0000-0000-000000000000'::uuid
                  AND '3ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid
ON CONFLICT DO NOTHING;
```

After backfill:

```sql
SELECT count(*) FROM records.records;
SELECT count(*) FROM records.records_partitioned;
VACUUM (ANALYZE) records.records_partitioned;
```

### 3. Cutover

1. Pause writers (optional but recommended) or ensure app runs at low traffic.
2. Acquire locks:
   ```sql
   BEGIN;
   LOCK TABLE records.records IN ACCESS EXCLUSIVE MODE;
   LOCK TABLE records.records_partitioned IN ACCESS EXCLUSIVE MODE;
   ```
3. Drop FKs referencing the old table (`records.aliases`, `records.record_media`, etc.).
4. Swap tables:
   ```sql
   ALTER TABLE records.records RENAME TO records_legacy;
   ALTER TABLE records.records_partitioned RENAME TO records;
   ```
5. Recreate foreign keys pointing to `(id, user_id)` on the new table.
6. Recreate app triggers (`records_hot.sync_hot`, `records.notify_invalidate`) on the new parent if needed.
7. Drop dual-write triggers.
8. Commit.

### 4. Post-cutover validation

```sql
SELECT count(*) FROM records.records;
SELECT count(*) FROM records_legacy;
SELECT 1 FROM records.records EXCEPT SELECT 1 FROM records_legacy LIMIT 1; -- expect no rows
```

Refresh materialized views:

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY records.aliases_mv;
REFRESH MATERIALIZED VIEW CONCURRENTLY records.search_doc_mv;
```

### 5. Cleanup

- Drop `records.records_legacy` once satisfied.
- Remove any temporary batching metadata.
- Ensure Prisma client has been regenerated and deployed.

### 6. Rollback

If swap fails mid-flight:

1. Drop new FK definitions.
2. Rename tables back:
   ```sql
   ALTER TABLE records.records RENAME TO records_partitioned;
   ALTER TABLE records.records_legacy RENAME TO records;
   ```
3. Recreate original FKs against legacy table.
4. Drop dual-write triggers if not already removed.
5. Investigate, fix, and rerun.

---

Coordinate closely with the application team—Prisma changes introduce composite primary keys. Update any service code (TypeScript/SQL) that assumed `id` alone uniquely identified a record. Once the migration is complete, rerun pgBench/redis-prewarm suites to confirm KNN/TRGM latency targets. 

