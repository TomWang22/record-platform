# External PostgreSQL Setup (Docker Compose)

## Overview

The PostgreSQL database has been moved **out of Kubernetes** and is now running in **Docker Compose** on port **5433**.

## Connection Details

- **Host**: `localhost` (from host machine) or `host.docker.internal` (from K8s pods)
- **Port**: `5433` (mapped from container port 5432)
- **Container**: `record-platform-postgres-1`
- **Volume**: `record-platform_pgdata`
- **Database**: `records`

## Script Updates

### Benchmark Script (`run_pgbench_sweep.sh`)

The script now:
- ✅ Connects to `localhost:5433` (external Docker PostgreSQL)
- ✅ Checks Docker container disk space (not Kubernetes pods)
- ✅ Uses `psql` directly (not `kubectl exec`)
- ✅ Function `psql_in_pod()` is a misnomer - it actually connects to external Docker

**Note**: The function name `psql_in_pod` is kept for historical compatibility, but it connects to the external Docker PostgreSQL, not a Kubernetes pod.

### Cleanup Scripts

#### `emergency-disk-cleanup.sh`
- ✅ Checks Docker container disk space
- ✅ Monitors `record-platform-postgres-1` container
- ✅ Checks Docker volume `record-platform_pgdata`
- ✅ Still supports Kubernetes cleanup as fallback (if K8s cluster is accessible)

#### `cleanup-k8s-pvc-space.sh`
- ⚠️  This script is for Kubernetes PVCs only
- ⚠️  Not needed for external Docker PostgreSQL
- ⚠️  Only use if you still have K8s PostgreSQL running

## Disk Space Monitoring

### Check Container Disk Space

```bash
# Check container disk usage
docker exec record-platform-postgres-1 df -h /var/lib/postgresql/data

# Check WAL directory size
docker exec record-platform-postgres-1 du -sh /var/lib/postgresql/data/pg_wal

# Check Docker volume size
docker volume inspect record-platform_pgdata
```

### Check Host Disk Space

```bash
# Host disk (affects all Docker containers)
df -h

# Docker system usage
docker system df
```

## Troubleshooting

### Database in Recovery Mode

If the database is stuck in recovery:

```bash
# Check recovery status
psql -h localhost -p 5433 -U postgres -d postgres -c "SELECT pg_is_in_recovery();"

# Check container logs
docker logs record-platform-postgres-1

# Check container disk space
docker exec record-platform-postgres-1 df -h /var/lib/postgresql/data
```

### Out of Disk Space

If the container disk is >95% full:

1. **Run emergency cleanup:**
   ```bash
   ./scripts/emergency-disk-cleanup.sh
   ```

2. **Check Docker volume size:**
   ```bash
   docker volume inspect record-platform_pgdata
   ```

3. **Clean up WAL files (if safe):**
   ```bash
   # WAL files are managed by PostgreSQL
   # Check max_wal_size setting:
   docker exec record-platform-postgres-1 psql -U postgres -c "SHOW max_wal_size;"
   ```

4. **Increase Docker disk allocation** (if using Docker Desktop):
   - Docker Desktop → Settings → Resources → Disk image size

### Container Not Running

```bash
# Check container status
docker ps --filter "name=postgres" --filter "publish=5433"

# Start container if stopped
docker-compose up -d postgres

# Check logs
docker logs record-platform-postgres-1
```

## Migration Notes

- **Old setup**: PostgreSQL in Kubernetes pod (port 5432)
- **New setup**: PostgreSQL in Docker Compose (port 5433)
- **Connection**: All scripts now use `localhost:5433`
- **No kubectl needed**: Direct `psql` connections to Docker container

## Related Files

- `docker-compose.yml` - Docker Compose configuration
- `scripts/run_pgbench_sweep.sh` - Benchmark script (uses external PostgreSQL)
- `scripts/emergency-disk-cleanup.sh` - Cleanup script (checks Docker container)
- `scripts/cleanup-k8s-pvc-space.sh` - K8s cleanup (only if K8s PostgreSQL exists)

