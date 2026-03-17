# External Postgres: backup, restore, and avoiding “empty DBs”

This doc gives a **repeatable path** so externalized Postgres instances (8 containers, ports 5433–5440) stay in a known state: schemas applied, data restored when backups exist, and verification so we don’t keep hitting “no user tables” or lost data.

---

## Why we keep having issues

- **DBs exist but have no tables** when only the “create database” step runs (e.g. Docker Compose or `ensure-external-databases-created.sh`) and the **schema SQL files** in `infra/db/` are never applied.
- **Data is missing** when volumes are recreated or new containers are used and no restore is run after applying schemas.
- **Unclear order of operations** — create DBs → apply schemas → restore from backup (when available) → verify.

---

## One-time setup (per environment)

1. **Start the 8 Postgres containers** (e.g. Docker Compose) so ports 5433–5440 are mapped.
2. **Ensure DB names exist** (idempotent; does not create tables):
   ```bash
   PGPASSWORD=postgres ./scripts/ensure-external-databases-created.sh
   ```
3. **Apply all schemas** (creates schemas and tables; idempotent):
   ```bash
   PGPASSWORD=postgres ./scripts/apply-external-db-schemas.sh
   ```
4. **Restore from backup** when you have dumps:
   - **Single instance (e.g. records on 5433):**  
     `PGPORT=5433 PGDATABASE=records ./scripts/restore-to-external-docker.sh path/to/backup.dump`  
     (or the `.sql` equivalent with `psql -h 127.0.0.1 -p 5433 -U postgres -d records -f backup.sql`).
   - **Per-instance dumps:** Run restore for each port/DB that has a backup (see scripts in `scripts/restore-*` and `scripts/restore-to-external-docker.sh`).
5. **Verify**:
   ```bash
   PGPASSWORD=postgres ./scripts/inspect-external-db-schemas.sh docs/CURRENT_DB_SCHEMA_REPORT.md
   ```
   You should see schemas and tables (and row counts if data was restored).

---

## Hard backup (all 8 DBs) — complete setup for restore

Use this when you need a **full snapshot** of all 8 instances (schema, indexes, data, and tuning metadata) so you can restore everything after a loss.

### Create a hard backup

```bash
PGPASSWORD=postgres ./scripts/backup-all-8-dbs.sh
```

- **Output:** `backups/all-8-YYYYMMDD-HHMMSS/`
- **Contents per DB:** `<port>-<dbname>.dump` (custom format for pg_restore), `<port>-<dbname>.sql.gz` (plain SQL), optionally `<port>-<dbname>.sql` (plain SQL; set `BACKUP_PLAIN_SQL=1`), plus `<port>-<dbname>-pg_settings.tsv`, `<port>-<dbname>-extensions.tsv`, and `manifest.txt`.
- **Optional:** `BACKUP_DIR=/path/to/backups`, `PGHOST=127.0.0.1`, or `BACKUP_PLAIN_SQL=1` (writes plain `.sql` per DB for piping).

### Bundle layout (one script to restore)

| File pattern | Use |
|--------------|-----|
| `<port>-<dbname>.dump` | `pg_restore` (preferred when present) |
| `<port>-<dbname>.sql.gz` | `gunzip -c … \| psql … -f -` |
| `<port>-<dbname>.sql` | `psql … -f <file>` (only if backup was run with `BACKUP_PLAIN_SQL=1`) |

**Single script restores all 8 or one DB:** `scripts/restore-all-8-from-backup.sh` chooses per DB: `.dump` → `.sql.gz` → `.sql`. Restore one DB by port or name: `RESTORE_PORTS=5433` or `RESTORE_DB=records`. **One-shot full restore (ensure DBs + restore):** `scripts/full-restore-postgres-from-all-8.sh 20260306-040148` (or pass the full path `backups/all-8-20260306-040148`).

### Restore from a hard backup (all 8 or one DB)

1. Start Postgres container(s) for the port(s) you need (e.g. `docker compose up -d` for postgres, postgres-social, …).
2. Ensure DB names exist: `PGPASSWORD=postgres ./scripts/ensure-external-databases-created.sh`
3. Restore (one script; uses `.dump` → `.sql.gz` → `.sql` per DB):

   ```bash
   BACKUP_DIR=backups/all-8-YYYYMMDD-HHMMSS PGPASSWORD=postgres ./scripts/restore-all-8-from-backup.sh
   ```

4. Restore only some ports: `RESTORE_PORTS="5433 5437" BACKUP_DIR=backups/all-8-YYYYMMDD-HHMMSS ./scripts/restore-all-8-from-backup.sh`
5. Restore a single DB by name: `RESTORE_DB=records BACKUP_DIR=backups/all-8-YYYYMMDD-HHMMSS ./scripts/restore-all-8-from-backup.sh`
6. Pipe-friendly (no restore script): `gunzip -c backups/all-8-*/5434-social.sql.gz | psql -h 127.0.0.1 -p 5434 -U postgres -d social -f -`, or with plain SQL: `psql -h 127.0.0.1 -p 5434 -U postgres -d social -f backups/all-8-*/5434-social.sql`
7. Verify: `PGPASSWORD=postgres ./scripts/inspect-external-db-schemas.sh docs/CURRENT_DB_SCHEMA_REPORT.md`

---

## Strict full restore (schema + data + extensions + settings drift)

For **true full-state restoration** — nothing silently skipped, deterministic and verifiable — use the strict restore script. It uses every file in the backup dir: `.dump`, `*-extensions.tsv`, `*-pg_settings.tsv`.

**What it does per database:**

1. Recreate database (drop + create; port 5438 uses default DB `postgres`, no drop).
2. Restore `.dump` with pg_restore.
3. Verify user tables exist (fails if table count = 0).
4. Apply extensions from `*-extensions.tsv` (CREATE EXTENSION IF NOT EXISTS).
5. Compare current `pg_settings` to `*-pg_settings.tsv` and log drift (non-fatal).
6. Record table counts and row counts in a report.

**Optional:** Scales down `record-platform` deployments before restore and scales them back up after (set `SKIP_SCALE=1` to skip).

```bash
PGPASSWORD=postgres ./scripts/restore_full_backup_strict.sh backups/all-8-20260306-040148
# or by suffix:
PGPASSWORD=postgres ./scripts/restore_full_backup_strict.sh 20260306-040148
```

**Reports:** `backups/restore_reports/restore_report_YYYYMMDD-HHMMSS.txt` and `.json` (started, finished, per-DB table/row counts, failed_count). Exit code 1 if any DB failed validation (e.g. no tables restored).

**Env:** `SKIP_SCALE=1` (do not scale k8s), `RESTORE_REPORT_DIR=<path>`, `PGHOST=127.0.0.1`.

---

## Where backups are stored

- **Hard backup (all 8):** `backups/all-8-YYYYMMDD-HHMMSS/` (see above).
- **Legacy / single instance:** `backups/` (e.g. `backups/record-platform-postgres-1-all-20260101-214507.sql`). Logs under `backup/` may refer to this path.
- **One full instance dump** (e.g. 1.0G) usually covers one Postgres instance (e.g. records). Restore it into the matching port/DB after schemas are applied.

### Restore by port (all 8 DBs)

| Port | Service / DB name | Example restore (single DB) |
|------|-------------------|-----------------------------|
| 5433 | records | `PGPORT=5433 PGDATABASE=records ./scripts/restore-to-external-docker.sh backups/all-8-*/5433-records.dump` |
| 5434 | social | `pg_restore -h 127.0.0.1 -p 5434 -U postgres -d social --clean --if-exists backups/all-8-*/5434-social.dump` |
| 5435 | listings | `pg_restore -h 127.0.0.1 -p 5435 -U postgres -d listings --clean --if-exists backups/all-8-*/5435-listings.dump` |
| 5436 | shopping | `pg_restore -h 127.0.0.1 -p 5436 -U postgres -d shopping --clean --if-exists backups/all-8-*/5436-shopping.dump` |
| 5437 | auth | `pg_restore -h 127.0.0.1 -p 5437 -U postgres -d auth --clean --if-exists backups/all-8-*/5437-auth.dump` |
| 5438 | auction_monitor (DB `postgres`) | `pg_restore -h 127.0.0.1 -p 5438 -U postgres -d postgres --clean --if-exists backups/all-8-*/5438-postgres.dump` |
| 5439 | analytics | `pg_restore -h 127.0.0.1 -p 5439 -U postgres -d analytics --clean --if-exists backups/all-8-*/5439-analytics.dump` |
| 5440 | python_ai | `pg_restore -h 127.0.0.1 -p 5440 -U postgres -d python_ai --clean --if-exists backups/all-8-*/5440-python_ai.dump` |

Or use **`scripts/restore-all-8-from-backup.sh`** with `BACKUP_DIR=backups/all-8-YYYYMMDD-HHMMSS` to restore all at once. For plain SQL: `gunzip -c backups/all-8-*/5434-social.sql.gz | psql -h 127.0.0.1 -p 5434 -U postgres -d social -f -`.

---

## Checklist: “DBs clearly stored and applied”

| Step | Command / action |
|------|-------------------|
| 1. Containers up | Docker Compose or your bring-up; ports 5433–5440 mapped |
| 2. DB names exist | `PGPASSWORD=postgres ./scripts/ensure-external-databases-created.sh` |
| 3. Schemas + tables | `PGPASSWORD=postgres ./scripts/apply-external-db-schemas.sh` |
| 4. Restore (if backup) | `restore-to-external-docker.sh` or `psql ... -f backup.sql` per instance |
| 5. Verify | `PGPASSWORD=postgres ./scripts/inspect-external-db-schemas.sh` |

After step 3 you always have tables. After step 4 you have data where backups exist. Step 5 confirms state.

---

## Related

- **scripts/backup-all-8-dbs.sh** — Hard backup of all 8 DBs (schema, indexes, data, pg_settings, extensions).
- **scripts/restore-all-8-from-backup.sh** — Restore all 8 DBs from a hard backup directory.
- **scripts/full-restore-postgres-from-all-8.sh** — One-shot: ensure DBs exist, then restore from a given all-8 bundle (e.g. `./scripts/full-restore-postgres-from-all-8.sh 20260306-040148`).
- **scripts/restore_full_backup_strict.sh** — Strict full restore: schema, data, extensions, pg_settings drift comparison, verification, report; uses every file in the backup dir; fails if tables missing.
- **docs/EXTERNAL_DB_SCHEMA_BREAKDOWN.md** — Which `infra/db/*.sql` files apply to which port/DB.
- **docs/SCHEMA_TABLE_BREAKDOWN.md** — Port → database → schema → table for all 8 DBs.
- **docs/WHY_NO_USER_TABLES_AND_HOW_TO_FIX.md** — Why inspect shows “no user tables” and how to fix it (apply schemas, then optionally restore).
- **scripts/restore-to-external-docker.sh** — Restore a single dump into external Docker Postgres (e.g. records on 5433).
- **scripts/restore-from-local-backup.sh** — Restore into in-cluster Postgres.
