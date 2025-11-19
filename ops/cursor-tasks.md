# Cursor: Postgres-on-K8s hardening & backup/restore automation

## Goals

1. Use PVC `pgdata-big` for PGDATA and `pg-wal-archive` for WAL archive.

2. Pod security: run PG as uid/gid 999; init as root to fix perms; PGDATA mode 0700.

3. Keep superuser password in Secret.

4. Logical nightly dumps + weekly `pg_basebackup` jobs to `pgbackups` PVC.

5. One-click **restore Job** that can:

   - restore from latest `pg_dump` (logical)

   - OR bootstrap from `pg_basebackup` (physical) with WAL.

6. Scripts/Make targets to invoke the above.

7. Smoke checks: free space, WAL archiver healthy, schemas present, row counts.

## Deliverables

- `infra/k8s/base/postgres/deployment.yaml`

  - Deployment with:

    - volumes: `data -> pgdata-big`, `wal-archive -> pg-wal-archive`

    - `envFrom: secretRef: postgres-superuser`

    - `PGDATA=/var/lib/postgresql/data`

    - init container `prep-dirs` (root) that:

      - prints mounts

      - `chown -R 999:999 /var/lib/postgresql/data /wal-archive || true`

      - `chmod 0700 /var/lib/postgresql/data || true`

      - `chmod 0775 /wal-archive || true`

    - main container (uid/gid 999) with:

      - archiving args:

        ```

        -c wal_level=replica

        -c archive_mode=on

        -c archive_command=test ! -f /wal-archive/%f && cp %p /wal-archive/%f

        -c archive_timeout=60s

        -c max_wal_size=2GB

        -c min_wal_size=80MB

        ```

- `infra/k8s/base/postgres/secret.superuser.yaml`

  - Secret `postgres-superuser` with key `POSTGRES_PASSWORD`.

- `infra/k8s/base/postgres/wal-archive-pvc.yaml` (already present)

- `infra/k8s/base/postgres/cron/pg-dump-nightly.yaml` (use user's version)

- `infra/k8s/base/postgres/cron/pg-basebackup-weekly.yaml` (use user's version)

- `infra/k8s/jobs/restore-from-dump.yaml`

  - Job that:

    - mounts `pgbackups`

    - picks latest `nightly-*.tar.gz`

    - restores `globals.sql` (ignore "role exists" errors),

    - restores `records.dir` with `pg_restore --clean --if-exists --no-owner --no-privileges -j 4`,

    - runs ANALYZE + refresh MVs if present.

- `infra/k8s/jobs/bootstrap-from-basebackup.yaml`

  - Job that:

    - stops the Postgres Deployment (scale 0),

    - wipes `PGDATA` on `pgdata-big` (careful: only when no cluster is present),

    - extracts latest `basebackup-*.bundle.tar.gz` to PGDATA,

    - places `recovery.signal`, sets `restore_command='cp /wal-archive/%f %p'` (PG16 → `primary_conninfo` optional),

    - starts the Deployment (scale 1) and waits for recovery to finish.

- `scripts/pg/space-check.sh`

  - Prints `df -h`, `pg_database_size`, and WAL disk usage.

- `Makefile` targets:

  - `pg.deploy` → apply deployment/secret/pvcs.

  - `pg.scale0` / `pg.scale1` → scale DB down/up.

  - `pg.restore.dump` → run the restore-from-dump job.

  - `pg.bootstrap.basebackup` → run the physical bootstrap job.

  - `pg.sanity` → check schemas, tables, MV refresh, and show counts.

## Acceptance checks

- `kubectl -n record-platform get deploy postgres` shows `1/1` after rollout.

- `kubectl -n record-platform exec -it deploy/postgres -c db -- df -h /var/lib/postgresql/data /wal-archive` shows the PVC sizes (not the root FS).

- `kubectl -n record-platform exec -it deploy/postgres -c db -- psql -U postgres -d records -c "select now()"` works.

- WAL archiver logs contain lines like: `archived transaction log file "000000010000000000000027"`.

- Nightly dump and weekly basebackup artifacts appear in `pgbackups` and old ones are pruned.

