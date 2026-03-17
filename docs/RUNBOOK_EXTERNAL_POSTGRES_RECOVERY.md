# Runbook: External Postgres 8-DB Full Recovery

Production-grade procedure for restoring all 8 external Postgres databases from a full backup. Use this when recovering from failure or restoring to a known state.

---

## 1. Preconditions

**Docker containers healthy:**

```bash
docker ps
```

**Expected:** All 8 DB containers Up (healthy):

| Port | Service / DB      | Container / Compose service |
|------|-------------------|-----------------------------|
| 5433 | records           | records (or main)           |
| 5434 | social            | social                      |
| 5435 | listings          | listings                    |
| 5436 | shopping          | shopping                    |
| 5437 | auth              | auth                        |
| 5438 | auction_monitor   | auction-monitor             |
| 5439 | analytics         | analytics                   |
| 5440 | python_ai         | python_ai (or python-ai)    |

If any are missing or unhealthy: `cd <repo> && docker compose up -d` (or start the relevant containers). Wait until all 8 ports accept connections.

---

## 2. Ensure Correct Postgres Client Version

**Must match dump version (e.g. 16.x):**

```bash
pg_restore --version
psql --version
```

If mismatch (e.g. host has 15, dump is 16):

```bash
brew install postgresql@16
brew link --force postgresql@16
```

Ensure `psql` and `pg_restore` in your PATH are 16.x when restoring a 16.x dump.

---

## 2b. Password (no prompts)

The restore script uses `PGPASSWORD` (default `postgres` for local Docker). To avoid prompts when using a different password or in production:

- **Option A:** `export PGPASSWORD=yourpassword` before running restore (or pass it in the bring-up invocation).
- **Option B (recommended for production):** Create `~/.pgpass` with one line per instance:
  ```
  localhost:5433:*:postgres:yourpassword
  localhost:5434:*:postgres:yourpassword
  localhost:5435:*:postgres:yourpassword
  localhost:5436:*:postgres:yourpassword
  localhost:5437:*:postgres:yourpassword
  localhost:5438:*:postgres:yourpassword
  localhost:5439:*:postgres:yourpassword
  localhost:5440:*:postgres:yourpassword
  ```
  Then `chmod 600 ~/.pgpass`. No password prompts for any port.

---

## 3. Restore Procedure (Per DB)

**Standard DBs (NOT 5438):** Drop and recreate the database, then restore.

For each `<PORT>` / `<DB>` pair below, run:

```bash
psql -h localhost -p <PORT> -U postgres -c "DROP DATABASE IF EXISTS <DB>;"
psql -h localhost -p <PORT> -U postgres -c "CREATE DATABASE <DB>;"

pg_restore \
  -h localhost \
  -p <PORT> \
  -U postgres \
  -d <DB> \
  --clean \
  --if-exists \
  -v \
  backups/all-8-<timestamp>/<PORT>-<DB>.dump
```

**Port → DB mapping (standard):**

| Port | DB        | Dump file (example)              |
|------|-----------|-----------------------------------|
| 5433 | records   | backups/all-8-<timestamp>/5433-records.dump   |
| 5434 | postgres  | (social schema in postgres DB)   |
| 5435 | records   | (listings schema; use records DB on 5435)      |
| 5436 | postgres  | (shopping schema)                |
| 5437 | postgres  | (auth schema)                    |
| 5439 | analytics | 5439-analytics.dump              |
| 5440 | python_ai | 5440-python_ai.dump              |

Adjust `<timestamp>` to your backup directory (e.g. `all-8-20260306-040148`). For 5434/5436/5437 the database name is typically `postgres` and the dump file may be named by port (e.g. `5434-postgres.dump`). Use the actual dump filenames produced by your backup script.

---

## 4. Special Case: 5438 (auction_monitor)

Port 5438 uses the **default database `postgres`**. Do **not** drop it: the container healthcheck and other sessions may be connected, so `DROP DATABASE postgres` fails with "database is being accessed by other users". The automated restore script restores **in-place** with `pg_restore --clean --if-exists` so objects are replaced without dropping the database.

Manual one-liner (if not using the script):

```bash
pg_restore -h localhost -p 5438 -U postgres -d postgres --clean --if-exists -v backups/all-8-<timestamp>/5438-postgres.dump
```

If your backup uses a different DB name (e.g. `auction_monitor`), use the standard drop/create/restore flow for that DB name.

---

## 5. Verification

**Show schemas:**

```bash
psql -h localhost -p 5433 -U postgres -d records -c "\dn"
```

**Show all tables (all schemas):**

```bash
psql -h localhost -p 5433 -U postgres -d records -c "\dt *.*"
```

**Row sanity check (examples):**

```bash
psql -h localhost -p 5436 -U postgres -d postgres -c "SELECT COUNT(*) FROM shopping.orders;"
psql -h localhost -p 5434 -U postgres -d postgres -c "SELECT COUNT(*) FROM social.messages;"
```

Adjust port/database/schema to match your layout.

---

## 6. Post-Restore Validation Checklist

- [ ] All expected schemas present (`\dn` per DB).
- [ ] Row counts non-zero where expected (e.g. orders, messages).
- [ ] Sequences advanced (no duplicate key errors on insert).
- [ ] App containers / pods connect successfully (health checks pass).
- [ ] No crash loops in services that use these DBs.

---

## 7. Lessons Learned

- **pg_restore version** must match dump version (e.g. 16.x).
- **`\dt`** only shows tables in the current `search_path`; use `\dt *.*` for all schemas.
- **Schemas ≠ public** — social, shopping, auth, listings, etc. use named schemas.
- **5438** is a special case (default DB name and restore target).
- Backup directory naming: `backups/all-8-<timestamp>` (e.g. from `scripts/restore-all-8-from-backup.sh` or your backup pipeline).

---

## 8. Automated restore (bring-up hook)

Restore can be run as part of infra bring-up so it is deterministic and repeatable:

```bash
# Restore from a specific backup directory
RESTORE_BACKUP_DIR=backups/all-8-20260312-091418 ./scripts/bring-up-external-infra.sh

# Restore from the latest backup (newest backups/all-8-YYYYMMDD-HHMMSS by folder name)
RESTORE_BACKUP_DIR=latest ./scripts/bring-up-external-infra.sh
```

The restore script can also be run standalone (explicit path recommended; use `RESTORE_ALLOW_LATEST=1` only for local dev if passing `latest`):

```bash
./scripts/restore-external-postgres-from-backup.sh backups/all-8-20260312-091418
RESTORE_ALLOW_LATEST=1 ./scripts/restore-external-postgres-from-backup.sh latest
```

- **CI/prod:** Use an **explicit snapshot only**. Set `RESTORE_BACKUP_DIR=backups/all-8-20260312-091418` (or your `all-8-<timestamp>` dir). Do **not** use `latest` in CI/prod.
- **Local dev:** You may use `RESTORE_BACKUP_DIR=latest` (resolves to newest `backups/all-8-*`). If calling the restore script directly with `latest`, set `RESTORE_ALLOW_LATEST=1` or the script will exit with an error (enforces explicit snapshot outside dev).
- `latest` resolves to the most recent `backups/all-8-*` directory (folder names: `all-8-YYYYMMDD-HHMMSS`). A pg_restore major-version guard (16.x) runs before restore; mismatch fails fast. The script terminates active connections to each DB before DROP so restore works with live containers and healthchecks; port 5438 (default DB `postgres`) is restored in-place without drop. After restore, run `./scripts/inspect-external-db-schemas.sh docs/CURRENT_DB_SCHEMA_REPORT.md` to refresh the schema report; the inspector asserts expected DBs per port (e.g. 5434 must have postgres, records, social). If the assertion fails, run restore from the same snapshot then re-run the inspector.

---

## See Also

- `scripts/restore-external-postgres-from-backup.sh` — **recommended**: restore all 8 DBs from a backup dir; supports `latest`; version guard; terminates connections before drop (works with live infra); 5438 in-place.
- `scripts/restore-all-8-from-backup.sh` — restore from backup directory (BACKUP_DIR or suffix).
- `scripts/full-restore-postgres-from-all-8.sh` — ensure DBs exist then restore.
- `scripts/restore_full_backup_strict.sh` — drop/create DB, pg_restore, extensions, pg_settings drift report.
- `docs/EXTERNAL_POSTGRES_BACKUP_AND_RESTORE.md` — backup and restore architecture.
- **Runbook.md** — "PostgreSQL restore and recover" section for quick reference and links.
