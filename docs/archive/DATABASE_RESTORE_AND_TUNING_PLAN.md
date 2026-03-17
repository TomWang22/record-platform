# Database Restore and Tuning Plan

## Overview

This document outlines the plan to restore SQL backup files and apply comprehensive database tuning for optimal performance (target: 10+ second overall reduction in query time).

## Database Mapping

| Backup File | Port | Database | Service |
|------------|------|----------|---------|
| `record-platform-postgres-1-all-20260101-223214.sql` | 5433 | records | records (main) |
| `record-platform-postgres-social-1-all-20260101-223214.sql` | 5434 | records | social |
| `record-platform-postgres-listings-1-all-20260101-223214.sql` | 5435 | records | listings |
| `record-platform-postgres-shopping-1-all-20260101-223214.sql` | 5436 | shopping | shopping |
| `record-platform-postgres-auth-1-all-20260101-223214.sql` | 5437 | auth | auth |
| `record-platform-postgres-auction-monitor-1-all-20260101-223214.sql` | 5438 | postgres | auction-monitor |
| `record-platform-postgres-analytics-1-all-20260101-223214.sql` | 5439 | analytics | analytics |
| `record-platform-postgres-python-ai-1-all-20260101-223214.sql` | 5440 | python_ai | python-ai |

**Canonical mapping**: Ports must match `docker-compose.yml` and README (Multi-Database Architecture). Use **docs/BACKUPS_AND_TUNING.md** and **scripts/restore-all-databases-from-dumps.sh** for restore.

## Step 1: Restore SQL Backups

**Script**: `scripts/restore-and-tune-all-databases.sh`

Restores each backup file to its corresponding database:
```bash
PGPASSWORD=postgres psql -h localhost -p <PORT> -U postgres -d records < backup_file.sql
```

**Notes**:
- Large files may take time (check file sizes first)
- Logs saved to `/tmp/restore-*.log`
- Verify each restore completes successfully

## Step 2: Extract Tuning Settings from Backups

The backup files contain valuable tuning information:
- **Autovacuum settings**: `autovacuum_vacuum_scale_factor`, `autovacuum_analyze_scale_factor`
- **Trigram indexes**: GIN/GiST indexes for fuzzy search
- **Hot sharding/indexes**: Tenant-specific optimizations
- **MVCC settings**: Already tuned in backups

**Extracted to**:
- `/tmp/autovacuum_settings.txt`
- `/tmp/trigram_indexes.txt`
- `/tmp/hot_definitions.txt`

## Step 3: Apply Comprehensive Tuning

### 3.1 Records Service (Port 5433)

**Fuzzy Search (Trigram Indexes)**:
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_records_artist_trgm ON records.records USING gin (artist gin_trgm_ops);
CREATE INDEX idx_records_name_trgm ON records.records USING gin (name gin_trgm_ops);
CREATE INDEX idx_records_catalog_trgm ON records.records USING gin (catalog_number gin_trgm_ops);
CREATE INDEX idx_records_search_norm_gin ON records.records USING gin (search_norm gin_trgm_ops);
```

**Hot Tenant Indexes** (for primary user):
```sql
CREATE INDEX idx_records_search_norm_gin_bench 
  ON records.records USING gin (search_norm gin_trgm_ops) 
  WHERE user_id = '0dc268d0-a86f-4e12-8d10-9db0f1b735e0'::uuid;
```

**Autovacuum Tuning**:
```sql
ALTER TABLE records.records SET (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.05
);
```

**Full-Text Search**:
```sql
CREATE INDEX idx_records_search_tsv_all ON records.records USING gin (search_tsv);
```

### 3.2 Listings Service (Port 5435)

**Trigram Indexes**:
```sql
CREATE INDEX idx_search_q_trgm ON listings.search_history USING gin (q gin_trgm_ops);
```

**Autovacuum** (write-heavy):
```sql
ALTER TABLE listings.listings SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_scale_factor = 0.05
);
```

### 3.3 Shopping Service (Port 5436)

**Autovacuum** (write-heavy):
```sql
ALTER TABLE shopping.shopping_cart SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_scale_factor = 0.05
);
ALTER TABLE shopping.orders SET (
  autovacuum_vacuum_scale_factor = 0.1,
  autovacuum_analyze_scale_factor = 0.05
);
```

### 3.4 Generic Tuning (All Services)

- **MVCC**: Already optimized in backups
- **Statistics**: Run `ANALYZE` on all tables after restore
- **Query Planner**: Tuned via `random_page_cost`, `effective_cache_size` (see `infra/db/44-optimize-planner.sql`)

## Step 4: Query Plan Optimization

**Target**: Reduce overall query time by 10+ seconds

**Methods**:
1. **EXPLAIN ANALYZE** on all slow queries
2. **Index usage verification**: Ensure indexes are used
3. **Partition pruning**: Verify partition-aware queries
4. **Statistics freshness**: Keep statistics up to date (autovacuum)

**Verification**:
```sql
-- Check index usage
SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname IN ('records', 'listings', 'shopping')
ORDER BY idx_scan DESC;

-- Check table statistics
SELECT schemaname, relname, last_analyze, n_live_tup, n_dead_tup
FROM pg_stat_user_tables
WHERE schemaname IN ('records', 'listings', 'shopping');
```

## Step 5: Performance Validation (pgbench)

**After tuning is complete**, run pgbench scripts to validate performance:

- Location: `scripts/load/` (various pgbench scripts)
- Purpose: Validate tuning improvements
- Metrics: TPS, latency, query time

## Tuning Checklist

### Records Service
- [x] Restore backup
- [ ] Enable `pg_trgm` extension
- [ ] Create trigram indexes (artist, name, catalog, search_norm)
- [ ] Create hot tenant indexes
- [ ] Create full-text search indexes
- [ ] Tune autovacuum (scale_factor: 0.02/0.05)
- [ ] Run ANALYZE

### Listings Service
- [x] Restore backup
- [ ] Enable `pg_trgm` extension
- [ ] Create trigram index on search_history.q
- [ ] Tune autovacuum (scale_factor: 0.1/0.05)
- [ ] Run ANALYZE

### Shopping Service
- [x] Restore backup
- [ ] Tune autovacuum on cart/orders/purchase_history
- [ ] Run ANALYZE

### All Services
- [ ] Verify indexes exist and are used
- [ ] Check query plans (EXPLAIN ANALYZE)
- [ ] Monitor autovacuum activity
- [ ] Validate statistics freshness

## Expected Performance Improvements

1. **Fuzzy Search**: 5-10x faster with trigram indexes
2. **Hot Tenant Queries**: 2-3x faster with partial indexes
3. **Write Performance**: Improved with autovacuum tuning (reduced bloat)
4. **Query Planner**: Better decisions with fresh statistics
5. **Overall Target**: 10+ second reduction in end-to-end query time

## Execution

```bash
# Run the restoration and tuning script
./scripts/restore-and-tune-all-databases.sh

# Verify tuning
psql -h localhost -p 5433 -U postgres -d records -c "SELECT COUNT(*) FROM pg_indexes WHERE indexdef LIKE '%trgm%';"

# Run smoke test to verify everything works
./scripts/test-microservices-http2-http3.sh
```

## Notes

- **No PgBouncer**: As requested, no connection pooling yet (tuning raw PostgreSQL)
- **MVCC**: Already optimized in backups (row versioning)
- **Hot Sharding**: Tenant-specific indexes for primary users
- **Autovacuum**: Critical for write-heavy workloads (prevent bloat)
