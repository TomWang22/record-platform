# Emergency Disk Space Cleanup Guide

## Current Situation

Your database is stuck in a recovery loop due to "No space left on device" errors. This document provides steps to free up space and prevent this from happening again.

## Immediate Actions

### 1. Run Emergency Cleanup Script

```bash
# Dry run first to see what will be deleted
./scripts/emergency-disk-cleanup.sh --dry-run

# Actually run the cleanup
./scripts/emergency-disk-cleanup.sh
```

This will:
- Delete benchmark logs older than 1 day
- Keep only the last 2 backups
- Clean Docker build cache and unused images
- Clean old CSV files

### 2. Clean Up Unused Docker Volumes

**⚠️ WARNING: Only remove volumes you're sure are unused!**

```bash
# List unused volumes
docker volume ls -f "dangling=true"

# Check which volumes are large
docker system df -v | grep -A 50 "Local Volumes"

# Remove unused volumes (CAREFUL!)
docker volume prune -f
```

**Large volumes found:**
- `minikube: 5.114GB` (UNUSED - safe to remove if you don't need minikube)
- `postgres-external-data: 4.987GB` (UNUSED - safe to remove if you're using K8s postgres)

### 3. Clean Up Docker Images

```bash
# Remove all unused images (not just dangling)
docker image prune -a -f

# Or more aggressive: remove ALL unused resources
docker system prune -a --volumes -f
```

**⚠️ WARNING: `docker system prune -a --volumes -f` will delete:**
- All stopped containers
- All unused networks
- All unused images (not just dangling)
- All unused volumes
- All build cache

### 4. Clean Up Kubernetes PVC Backups

If you have access to the Kubernetes cluster:

```bash
# Check PVC sizes
kubectl -n record-platform get pvc

# Find backup pods
kubectl -n record-platform get pod -l job-name

# Clean up old backups in PVC (if accessible)
# The emergency cleanup script will try to do this automatically
```

### 5. Clean Up PostgreSQL WAL Files (if accessible)

If the database is running and you can connect:

```bash
# Check WAL directory size
kubectl -n record-platform exec <postgres-pod> -- du -sh /var/lib/postgresql/data/pg_wal

# Archive old WAL files (if archiving is enabled)
# Or increase max_wal_size to reduce WAL retention
```

## Prevention

### Automatic Cleanup

The benchmark script now:
- Checks disk space before running
- Refuses to run if disk is >95% full
- Warns if disk is >90% full
- Suggests running emergency cleanup

### Regular Maintenance

Add to your crontab or run weekly:

```bash
# Weekly cleanup
0 2 * * 0 /path/to/scripts/emergency-disk-cleanup.sh
```

### Monitor Disk Usage

```bash
# Check disk usage
df -h

# Check Docker usage
docker system df

# Check largest directories
du -sh */ | sort -h | tail -10
```

## Database Recovery

Once you've freed up space, the database should automatically recover. If it doesn't:

1. **Check if database pod is running:**
   ```bash
   kubectl -n record-platform get pod -l app=postgres
   ```

2. **Check database logs:**
   ```bash
   kubectl -n record-platform logs <postgres-pod> | tail -50
   ```

3. **If still stuck, restart the pod:**
   ```bash
   kubectl -n record-platform delete pod <postgres-pod>
   ```

4. **Wait for recovery to complete:**
   ```bash
   # The wait_for_db_ready function in the benchmark script will wait up to 2 minutes
   # Or manually check:
   psql -h localhost -p 5433 -U postgres -d postgres -c "SELECT pg_is_in_recovery();"
   ```

## Disk Space Targets

- **< 80%**: Healthy
- **80-85%**: Warning - consider cleanup
- **85-90%**: Warning - cleanup recommended
- **90-95%**: Critical - cleanup required
- **> 95%**: Emergency - script will refuse to run

## Quick Reference

```bash
# Emergency cleanup (aggressive)
./scripts/emergency-disk-cleanup.sh

# Normal cleanup (less aggressive)
./scripts/cleanup-disk-space.sh

# Clean old bench results only
./scripts/cleanup-old-bench-results.sh 1  # Keep last 1 day

# Clean old backups only
./scripts/cleanup-old-backups.sh --keep 2

# Check disk space
df -h
docker system df
```

