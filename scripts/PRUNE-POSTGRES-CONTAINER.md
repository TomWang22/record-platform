# PostgreSQL Container Disk Space Pruning

## Overview

The `prune-postgres-container.sh` script safely prunes disk space in the PostgreSQL Docker container **while benchmarks are running**. It only removes safe-to-delete bloat without affecting important data.

## Usage

```bash
# Run pruning (safe during benchmarks)
./scripts/prune-postgres-container.sh

# The script automatically detects:
# - Recovery mode (more aggressive WAL cleanup)
# - Active queries (skips locked operations)
# - Disk usage (reports before/after)
```

## What It Cleans

### 1. **VACUUM** (if not locked)
- Reclaims space from dead tuples
- Safe to run during benchmarks (may skip if table is locked)

### 2. **pg_stat_statements** (if >100MB)
- Truncates query statistics (safe - just resets stats)
- Doesn't affect database data

### 3. **WAL Files** (old segments)
- **Recovery mode**: Keeps last 16 segments, deletes older ones
- **Normal mode**: Keeps last 32 segments (if archiving disabled)
- **Archiving enabled**: Conservative cleanup only

### 4. **Temporary Files**
- `/tmp` files older than 30 minutes
- PostgreSQL temp files (`pgsql_tmp*`) - safe to delete immediately

### 5. **Log Files** (if present)
- Old PostgreSQL log files (keeps last 10)

### 6. **Informational Checks**
- Large unused indexes (read-only, doesn't delete)
- Table bloat statistics (read-only)

## Safety Features

✅ **Safe during benchmarks**: Only removes bloat, never touches active data  
✅ **Recovery-aware**: More aggressive cleanup when database is recovering  
✅ **Lock-aware**: Skips operations if tables are locked  
✅ **Read-only checks**: Reports bloat without modifying data  

## When to Run

- **During benchmarks**: Safe to run anytime
- **Disk at 95%+**: Run to free space before failures
- **After benchmarks**: Clean up temporary files
- **Recovery mode**: Run to free space for recovery

## Example Output

```
[14:16:07] ℹ️  Pruning disk space in PostgreSQL container: record-platform-postgres-1
[14:16:07] ℹ️  Current disk usage: 57.4G used, 0 available (100% used)
[14:16:07] ℹ️  Step 1: Running VACUUM ANALYZE...
[14:16:07] ⚠️  VACUUM failed (may be locked by benchmark, continuing...)
[14:16:08] ⚠️  Database appears to be in recovery mode - aggressively cleaning old WAL
[14:16:08] ✅  Deleted 47 old WAL segment files
[14:16:08] ℹ️  Disk usage after pruning: 56.6G used, 0 available (100% used)
[14:16:08] ✅ Pruning complete
```

## Integration with Benchmark Script

The benchmark script (`run_pgbench_sweep.sh`) checks disk space before running but doesn't prune automatically. You can run this script in parallel:

```bash
# Terminal 1: Run benchmark
./scripts/run_pgbench_sweep.sh

# Terminal 2: Prune disk space (safe to run during benchmark)
./scripts/prune-postgres-container.sh
```

## Troubleshooting

### Disk Still at 100%

If pruning doesn't free enough space:

1. **Check host disk space**: The container's disk is actually the host's disk
   ```bash
   df -h
   ```

2. **Run host cleanup**:
   ```bash
   ./scripts/emergency-disk-cleanup.sh
   ```

3. **Check Docker volumes**:
   ```bash
   docker volume ls
   docker volume prune  # Removes unused volumes
   ```

4. **Increase Docker disk allocation** (Docker Desktop):
   - Settings → Resources → Disk image size

### VACUUM Fails

This is normal during benchmarks - the table may be locked. The script continues with other cleanup steps.

### Recovery Mode

If the database is in recovery mode, the script automatically:
- Detects recovery status
- Performs more aggressive WAL cleanup
- Frees space to allow recovery to complete

## Related Scripts

- `emergency-disk-cleanup.sh` - Host-level cleanup (backups, logs, Docker)
- `cleanup-k8s-pvc-space.sh` - Kubernetes PVC cleanup (if using K8s PostgreSQL)
- `run_pgbench_sweep.sh` - Benchmark script (checks disk space before running)

