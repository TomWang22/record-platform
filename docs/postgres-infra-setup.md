# Postgres Infrastructure Setup

This document describes the hardened Postgres-on-Kubernetes setup with backup/restore automation.

## Overview

- **PVC**: `pgdata-big` (100Gi) for PGDATA
- **WAL Archive**: `pg-wal-archive` (20Gi) for WAL files
- **Security**: Postgres runs as uid/gid 999 (root-squash friendly); init container also runs as 999 to prepare directories
- **Backups**: Nightly logical dumps + weekly physical basebackups to `pgbackups` PVC
- **Restore**: One-click restore jobs for both logical and physical backups

## Critical: Double-Mount PGDATA Pitfall

**⚠️ IMPORTANT**: The data PVC must be mounted **ONLY** at `/var/lib/postgresql`, **NOT** at `/var/lib/postgresql/data`.

If you mount the PVC at both locations, `/var/lib/postgresql/data` becomes a mount point, and `initdb` cannot clear it, resulting in:
```
initdb: error: directory "/var/lib/postgresql/data" exists but is not empty
```

**Correct configuration**:
- PVC mounted at: `/var/lib/postgresql`
- `PGDATA` environment variable: `/var/lib/postgresql/data`
- This allows `initdb` to create the `data` subdirectory as needed

**Incorrect configuration** (DO NOT DO THIS):
- PVC mounted at: `/var/lib/postgresql/data` ❌
- This creates a mount point that cannot be cleared

## Quick Start

### 1. Deploy Infrastructure

```bash
make pg.deploy
```

This:
- **Creates PVCs if missing** (`pgdata-big` 100Gi, `pg-wal-archive` 20Gi) - never mutates existing bound claims
- Applies `postgres-superuser` Secret
- Applies Deployment with robust init container
- Applies Service

**Note**: PVCs are immutable once bound. The `pg.pvc.ensure` target creates them only if they don't exist. To change size/storage class, create a new PVC with a different name and migrate data separately.

### 2. Check Status

```bash
# Check pod status
kubectl -n record-platform get pod -l app=postgres

# Check init container logs (if issues)
PGPOD=$(kubectl -n record-platform get pod -l app=postgres -o jsonpath='{.items[0].metadata.name}')
kubectl -n record-platform logs "$PGPOD" -c prep-dirs

# Verify volumes
kubectl -n record-platform exec -i deploy/postgres -c db -- df -h /var/lib/postgresql/data /wal-archive
```

### 3. Run Sanity Checks

```bash
make pg.sanity
```

## Makefile Targets

- `make pg.pvc.ensure` - Create PVCs if they don't exist (never mutates bound claims)
- `make pg.deploy` - Apply all postgres infrastructure (includes `pg.pvc.ensure`)
- `make pg.scale0` - Scale postgres to 0 replicas
- `make pg.scale1` - Scale postgres to 1 replica
- `make pg.restore.dump` - Restore from latest logical dump in `pgbackups`
- `make pg.bootstrap.basebackup` - Bootstrap from latest physical backup (WARNING: wipes PGDATA)
- `make pg.wipe` - Completely wipe PGDATA (WARNING: destructive)
- `make pg.backups.loader` - Create helper pod for uploading dump files
- `make pg.backups.loader.rm` - Delete backups-loader pod
- `make pg.restore.upload FILE=./dump.tar.gz` - Upload local dump and restore
- `make pg.debug.perms` - Debug permissions and mounts (shows UID, mounts, directory perms)
- `make pg.sanity` - Run sanity checks (schemas, tables, row counts)
- `make pg.space` - Check disk usage and space

## Backup Jobs

### Nightly Logical Dumps

- **Schedule**: Daily at 06:00 ET
- **Location**: `pgbackups` PVC
- **Format**: `nightly-YYYYMMDD-HHMM.tar.gz`
- **Contents**:
  - `records.dir/` - pg_restore directory format
  - `globals.sql` - Roles, extensions, etc.
  - `records.sql.gz` - Plain SQL dump
  - `pg_settings.tsv` - Server configuration
  - `extensions.tsv` - Installed extensions

### Weekly Physical Backups

- **Schedule**: Sundays at 06:20 ET
- **Location**: `pgbackups` PVC
- **Format**: `basebackup-YYYYMMDD-HHMM.bundle.tar.gz`
- **Contents**: Full physical backup with WAL

## Restore Procedures

### Restore from Logical Dump

```bash
make pg.restore.dump
```

This job:
1. Finds latest `nightly-*.tar.gz` in `pgbackups`
2. Restores `globals.sql` (ignores "already exists" errors)
3. Restores `records.dir` with `pg_restore`
4. Runs `ANALYZE`
5. Refreshes materialized views if present

### Bootstrap from Physical Backup

**WARNING**: This wipes PGDATA and requires the deployment to be scaled down.

```bash
# First, apply RBAC for the bootstrap job
kubectl -n record-platform apply -f infra/k8s/overlays/dev/jobs/bootstrap-rbac.yaml

# Then run bootstrap (interactive confirmation)
make pg.bootstrap.basebackup
```

This job:
1. Scales down postgres deployment
2. Wipes PGDATA (if cluster exists)
3. Extracts latest `basebackup-*.bundle.tar.gz` to PGDATA
4. Creates `recovery.signal`
5. Configures `restore_command` to use WAL archive
6. Scales up deployment
7. Waits for recovery to complete

### Disaster Recovery from Local Dump

**WARNING**: This completely wipes PGDATA and restores from a local dump file.

Use this procedure when you have a dump file on your local machine (e.g., `records_dump_20251102.tar.gz`) and need to restore it to a clean database.

#### Step 1: Wipe PGDATA

```bash
make pg.wipe
```

This:
1. Scales down postgres deployment
2. Runs `pgdata-wipe-full` job that:
   - Shows BEFORE state (contents)
   - Removes all contents from `/var/lib/postgresql` (PVC is mounted here)
   - Creates fresh `data` subdirectory with proper permissions (999:999, 0700)
   - Shows AFTER state (empty except for `data` directory)
3. Displays complete wipe logs

**Note**: The wipe job mounts the PVC at `/var/lib/postgresql` (not at `/var/lib/postgresql/data`) to avoid the double-mount pitfall.

#### Step 2: Upload and Restore

```bash
make pg.restore.upload FILE=./records_dump_20251102.tar.gz
```

This:
1. Ensures `backups-loader` pod is running (creates if missing)
2. Uploads the dump file to `backups-loader:/backups/`
3. Runs `restore-from-upload` job that:
   - Finds the uploaded dump (prefers `records_dump_20251102.tar.gz`, falls back to `nightly-*.tar.gz`)
   - Extracts the dump
   - Applies `globals.sql` if present (ignores "already exists" errors)
   - Creates common extensions (idempotent)
   - Restores data:
     - If `records.dir` exists: uses `pg_restore` with parallel jobs
     - Otherwise: finds and restores from `*.sql` or `*.sql.gz` files
   - Runs `ANALYZE`
   - Refreshes materialized views (best-effort)
4. Shows restore job logs (last 50 lines)

#### Helper Pod Management

```bash
# Create backups-loader pod (for manual uploads)
make pg.backups.loader

# Delete backups-loader pod
make pg.backups.loader.rm
```

The `backups-loader` pod mounts the `pgbackups` PVC and stays running for file uploads. You can also manually upload files:

```bash
kubectl -n record-platform cp ./my-dump.tar.gz backups-loader:/backups/
```

#### Complete Disaster Recovery Flow

```bash
# 1. Wipe everything (scales down, wipes PVC, shows logs)
make pg.wipe

# 2. Scale postgres back up (fresh cluster will auto-initialize)
make pg.scale1

# 3. Wait for postgres to be ready and initialized
kubectl -n record-platform wait --for=condition=ready pod -l app=postgres --timeout=300s
kubectl -n record-platform rollout status deploy/postgres --timeout=300s

# 4. Upload and restore
make pg.restore.upload FILE=./records_dump_20251102.tar.gz

# 5. Verify
make pg.sanity

# 6. Check WAL archiver health
POD=$(kubectl -n record-platform get pod -l app=postgres -o jsonpath='{.items[0].metadata.name}')
kubectl -n record-platform exec "$POD" -c db -- psql -U postgres -d records -x -c "SELECT * FROM pg_stat_archiver"
```

## Troubleshooting

### Double-Mount PGDATA Issue

**Symptoms**: `initdb: error: directory "/var/lib/postgresql/data" exists but is not empty`

**Cause**: The data PVC is mounted at both `/var/lib/postgresql` AND `/var/lib/postgresql/data`, making `/var/lib/postgresql/data` a mount point that cannot be cleared.

**Fix**:
1. Verify mount points:
   ```bash
   kubectl -n record-platform get pod -l app=postgres -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{range .spec.containers[?(@.name=="db")].volumeMounts[*]}{.name} -> {.mountPath}{"\n"}{end}{"\n"}{end}'
   ```
   Should show only: `data -> /var/lib/postgresql` (NOT `data -> /var/lib/postgresql/data`)

2. If double-mounted, patch the deployment:
   ```bash
   kubectl -n record-platform patch deploy postgres --type='strategic' -p '{"spec":{"template":{"spec":{"containers":[{"name":"db","volumeMounts":[{"name":"data","mountPath":"/var/lib/postgresql"},{"name":"wal-archive","mountPath":"/wal-archive"},{"name":"init","mountPath":"/docker-entrypoint-initdb.d"}]}]}}}}'
   ```

3. Wipe and restart:
   ```bash
   make pg.wipe
   make pg.scale1
   ```

### Root-Squash / Permission Denied on PGDATA

**Symptoms**: `initdb: error: could not change permissions of directory "/var/lib/postgresql/data": Operation not permitted` or `Permission denied` errors when accessing PGDATA

**Cause**: Some storage backends (especially NFS with root-squash) deny permission changes when the container runs as root. The solution is to run as UID 999 and ensure directories are pre-created with correct permissions.

**Fix**: The deployment is configured to run as UID 999 (not root) for root-squash compatibility:

1. **Init container `fix-run`** (runs as root, UID 0):
   - Creates `/var/run/postgresql` on an `emptyDir` volume (not on the PV)
   - Sets ownership to 999:999 and permissions to 0775
   - This avoids permission issues on the base filesystem

2. **Init container `prep-dirs`** (runs as UID 999):
   - Creates `/var/lib/postgresql/data` on the PVC
   - Sets permissions to 0700 (owned by 999:999)
   - All PGDATA work is done by UID 999 to avoid root-squash issues

3. **Main container** (runs as UID 999):
   - Mounts PVC at `/var/lib/postgresql` (not at `/var/lib/postgresql/data`)
   - Uses `PGDATA=/var/lib/postgresql/data`
   - Mounts `emptyDir` at `/var/run/postgresql` (pre-chowned by `fix-run`)
   - Postgres entrypoint can initialize because directories already have correct permissions

4. **Wipe job** (runs as UID 999):
   - Cleans PVC contents
   - Recreates `/var/lib/postgresql/data` with 0700 permissions owned by 999:999

**Why this works**:
- Your PV denies root operations (classic root-squash). So all PGDATA work must be done by uid 999.
- Postgres also touches `/var/run/postgresql` at startup; doing that as uid 999 on the base FS fails. Giving `/var/run/postgresql` its own `emptyDir` and pre-chowning it as root solves that without touching the PV.
- With those two prep steps, `initdb`/startup won't try any forbidden `chmod`s and the pod stops CrashLooping.

**Verification**:
```bash
# Check permissions and mounts (includes init container logs)
make pg.debug.perms

# Should show:
# - Container runs as UID 999
# - PVC mounted only at /var/lib/postgresql
# - /var/lib/postgresql/data exists and is 0700 owned by 999:999
# - /var/run/postgresql exists and is 0775 owned by 999:999
```

**If anything still complains**, check the last ~50 lines of:
```bash
NS=record-platform
POD=$(kubectl -n "$NS" get pod -l app=postgres -o jsonpath='{.items[0].metadata.name}')
kubectl -n "$NS" logs "$POD" -c fix-run --tail=100 || true
kubectl -n "$NS" logs "$POD" -c prep-dirs --tail=100 || true
kubectl -n "$NS" logs "$POD" -c db --tail=200
kubectl -n "$NS" exec -it "$POD" -- ls -ld /var/lib/postgresql /var/lib/postgresql/data /var/run/postgresql
kubectl -n "$NS" exec -it "$POD" -- id
```

### Init Container Failing

Check logs:
```bash
PGPOD=$(kubectl -n record-platform get pod -l app=postgres -o jsonpath='{.items[0].metadata.name}')
kubectl -n record-platform logs "$PGPOD" -c prep-dirs
```

Common issues:
- **Permission denied**: Init container runs as UID 999; ensure PVC allows writes for UID 999
- **Volume not mounted**: Check PVC exists and is bound
- **ROFS errors**: Check storage class allows writes
- **Double-mount**: See "Double-Mount PGDATA Issue" above
- **Root-squash issues**: See "Root-Squash / Permission Denied on PGDATA" above

### Postgres Not Starting

Check main container logs:
```bash
kubectl -n record-platform logs deploy/postgres -c db --tail=100
```

### WAL Archiver Not Working

Check archiver status:
```bash
kubectl -n record-platform exec -i deploy/postgres -c db -- psql -U postgres -d records -c "SELECT * FROM pg_stat_archiver;"
```

Check WAL archive directory:
```bash
kubectl -n record-platform exec -i deploy/postgres -c db -- ls -lah /wal-archive | head -20
```

### Out of Space

Check space:
```bash
make pg.space
```

If `pgdata-big` is full:
1. **Clean up old WAL files** from `/wal-archive`
2. **Vacuum/analyze** to reclaim space within the database
3. **Create a new larger PVC** (e.g., `pgdata-bigger`) and migrate data (PVCs cannot be resized once bound)

**Note**: PVCs are immutable once bound. To increase size, you must create a new PVC with a different name, migrate data, and update the Deployment to use the new PVC.

## Files Created

### Infrastructure
- `infra/k8s/base/postgres/pvc-big.yaml` - 100Gi PVC for PGDATA (create-if-missing only)
- `infra/k8s/base/postgres/secret.superuser.yaml` - Postgres superuser secret
- `infra/k8s/base/postgres/deploy.yaml` - Updated deployment with robust init
- `infra/k8s/base/postgres/wal-archive-pvc.yaml` - 20Gi PVC for WAL archive (create-if-missing only)

**Important**: PVCs are **not** included in `kustomization.yaml` to prevent accidental mutations. They are created via `make pg.pvc.ensure` (which runs automatically as part of `make pg.deploy`). Once a PVC is bound, it cannot be modified. To change size or storage class, create a new PVC with a different name and handle data migration separately.

### Jobs
- `infra/k8s/overlays/dev/jobs/restore-from-dump.yaml` - Logical restore job
- `infra/k8s/overlays/dev/jobs/bootstrap-from-basebackup.yaml` - Physical bootstrap job
- `infra/k8s/overlays/dev/jobs/bootstrap-rbac.yaml` - RBAC for bootstrap job

### Scripts
- `scripts/pg/space-check.sh` - Disk space and database size checker

### Documentation
- `ops/cursor-tasks.md` - Cursor task specification
- `docs/postgres-infra-setup.md` - This file

