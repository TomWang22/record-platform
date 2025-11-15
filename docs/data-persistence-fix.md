# Data Persistence Fix - November 12, 2025

## Critical Issue
Postgres database is being reinitialized on pod restart, losing all data including the `records` schema.

## Root Cause Analysis

### Problem
1. **Database Reinitialized**: After pod restart, `records` schema is missing
2. **Only Default Database**: Only `postgres` database exists, `records` database is gone
3. **Data Directory Exists**: `/var/lib/postgresql/data` exists with `PG_VERSION`, but data is fresh

### Why This Happens
Postgres will reinitialize if:
- `POSTGRES_DB` env var is set AND data directory appears empty/corrupt
- The `records` database doesn't exist in the data directory
- Postgres detects the database is missing and creates a fresh one

### Current Configuration Issue
The deployment has:
```yaml
env:
- { name: POSTGRES_DB, value: "records" }
- { name: PGDATA, value: "/var/lib/postgresql/data" }
```

When Postgres starts with `POSTGRES_DB=records` and the `records` database doesn't exist in the data directory, it will:
1. Create the `records` database
2. Run init scripts from `/docker-entrypoint-initdb.d`
3. But NOT restore existing data

## Solution

### Option 1: Remove POSTGRES_DB (Recommended)
Remove the `POSTGRES_DB` env var so Postgres doesn't auto-create the database. The database should already exist from previous runs.

**Change in `infra/k8s/base/postgres/deploy.yaml`:**
```yaml
env:
# Remove this line:
# - { name: POSTGRES_DB, value: "records" }
- { name: POSTGRES_USER, value: "postgres" }
- { name: PGDATA, value: "/var/lib/postgresql/data" }
```

### Option 2: Ensure Database Exists Before Starting
Add an init container that ensures the database exists before Postgres starts.

### Option 3: Use StatefulSet Instead of Deployment
StatefulSets provide better guarantees for persistent data, but requires more changes.

## Immediate Fix: Restore from Backup

1. **Restore database:**
   ```bash
   ./scripts/restore-from-local-backup.sh backups/records_20251112_partitioned.dump
   ```

2. **Verify restore:**
   ```bash
   kubectl -n record-platform exec deploy/postgres -c db -- \
     psql -U postgres -d records -c "SELECT COUNT(*) FROM records.records;"
   ```

3. **Fix deployment** to prevent reinitialization (remove `POSTGRES_DB`)

## Prevention

After restore, ensure:
1. ✅ PVC is properly mounted (`pgdata-big`)
2. ✅ `PGDATA` points to PVC location (`/var/lib/postgresql/data`)
3. ✅ Remove `POSTGRES_DB` env var (or ensure database exists before Postgres starts)
4. ✅ No duplicate volume mounts
5. ✅ Data directory permissions are correct (70:70)

## Verification

After fix, verify persistence:
```bash
# 1. Check data is on PVC
kubectl -n record-platform exec deploy/postgres -c db -- \
  df -h /var/lib/postgresql/data

# 2. Restart pod
kubectl -n record-platform rollout restart deploy/postgres

# 3. Verify data still exists
kubectl -n record-platform exec deploy/postgres -c db -- \
  psql -U postgres -d records -c "SELECT COUNT(*) FROM records.records;"
```

