# PostgreSQL Data Restore Status

## Issue Summary

**Critical Problem**: Databases were restored but have **0 tables** and only **7.5MB size** (backup files are 1GB+).

**Root Cause**: Backup files contain `CREATE DATABASE records` and `\connect records` commands, but our Docker Compose architecture uses the `postgres` database with schemas (not separate databases).

## Current Status

### Backup Files Available
- ✅ `record-platform-postgres-1-all-20260101-223214.sql` - **1.0GB** (main postgres/records)
- ✅ `record-platform-postgres-auth-1-all-20260101-223214.sql` - **36MB**
- ✅ `record-platform-postgres-social-1-all-20260101-223214.sql` - **165MB**
- ✅ `record-platform-postgres-listings-1-all-20260101-223214.sql` - **658MB**
- ✅ `record-platform-postgres-shopping-1-all-20260101-223214.sql` - **16MB**
- ✅ `record-platform-postgres-auction-monitor-1-all-20260101-223214.sql` - **65KB**
- ✅ `record-platform-postgres-analytics-1-all-20260101-223214.sql` - **22KB**
- ✅ `record-platform-postgres-python-ai-1-all-20260101-223214.sql` - **13MB**

### Database Status (After Restore Attempt)
- ❌ `postgres` database: **7.5MB** (should be ~1GB+)
- ❌ `records` schema: **0 tables** (backup is 1GB)
- ✅ All 8 PostgreSQL containers: **Running and healthy**

### Pod Status Issues (Related to Empty Databases)
- ❌ `auth-service`: **75 restarts** - **OOMKilled (exit 137)** + health check failures
- ❌ `listings-service`: **77 restarts** - startup probe timeout
- ❌ `social-service`: **101 restarts** - health check failures  
- ❌ `shopping-service`: **77 restarts** - liveness probe failures
- ❌ `python-ai-service`: **81 restarts** - health check failures
- ❌ `api-gateway`: Readiness/liveness probe failures

**Root Cause of Pod Failures**: Services are likely failing because:
1. **OOMKilled (exit 137)**: Services hitting memory limits (2Gi limit)
2. **Empty databases**: Queries failing because schemas have no data
3. **Health check timeouts**: Services can't initialize properly without data

## Architecture Context

Per `README.md`:
- **All 8 PostgreSQL instances run in Docker Compose** (outside Kubernetes)
- Each service connects to its database via `host.docker.internal:PORT`
- Port mapping: `5433:5432` (main), `5434:5432` (social), `5435:5432` (listings), etc.
- Services use **schemas** within the `postgres` database, not separate databases

## Restore Problem

The backup files were created from a setup that used separate databases (`CREATE DATABASE records`), but our current architecture uses:
- Single `postgres` database
- Multiple schemas: `records`, `auth`, `social`, `listings`, etc.

**The restore script was updated** to filter out:
- `CREATE DATABASE` commands
- `ALTER DATABASE` commands  
- `\connect` commands

## Next Steps

1. **Fix Restore Script**: Updated `scripts/restore-postgres-databases.sh` to filter out database creation commands
2. **Re-run Restore**: Execute restore with filtered backup files
3. **Verify Data**: Check that schemas have tables and data
4. **Fix Pod Memory Issues**: Increase memory limits if OOMKilled continues after data is restored

## Commands to Run

```bash
# Set Docker host for Colima
export DOCKER_HOST=unix:///Users/tom/.colima/default/docker.sock

# Run restore with updated script
./scripts/restore-postgres-databases.sh

# Verify restore worked
docker compose exec -T postgres psql -U postgres -d postgres -c "SELECT schemaname, COUNT(*) as table_count FROM pg_tables WHERE schemaname IN ('records', 'auth', 'social', 'listings') GROUP BY schemaname;"

# Check database sizes
docker compose exec -T postgres psql -U postgres -d postgres -c "SELECT pg_size_pretty(pg_database_size('postgres')) as db_size;"
```

## Notes

- Database connectivity from Kind cluster works fine (tested successfully)
- PostgreSQL containers are all healthy
- The issue is purely with the restore process and pod memory limits
