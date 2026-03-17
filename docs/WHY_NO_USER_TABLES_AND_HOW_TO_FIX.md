# Why “no user tables” and how to fix it

When **scripts/inspect-external-db-schemas.sh** shows **“(no user tables)”** for every DB, it means:

- The **databases exist** (e.g. `records`, `social`, `auth`, …) and only the default **`public`** schema is present.
- The **schema SQL files** in **infra/db/** that create the real schemas and tables (e.g. `auth.users`, `forum.posts`, `listings.listings`) have **not** been applied to these instances.

So you have empty DB “shells” and no application tables. That’s expected after a fresh bring-up of the 8 Postgres containers if no one has run the schema scripts yet (or if volumes were recreated and only the DB names were re-created).

---

## What the platform expects (DATA_GOVERNANCE_AND_SCHEMA_CAPS)

| Port | Database   | Expected schemas (after applying infra/db) |
|------|------------|--------------------------------------------|
| 5433 | records    | records, auth, … (primary; no row cap)     |
| 5434 | social     | forum, messages (1M cap per schema)       |
| 5435 | listings   | listings (1M)                              |
| 5436 | shopping   | shopping, feedback (1M per schema)         |
| 5437 | auth       | auth (1M)                                  |
| 5438 | postgres   | auction_monitor (1M)                       |
| 5439 | analytics  | analytics (1M)                             |
| 5440 | python_ai  | ai (1M)                                    |

Those schemas and tables are created by the SQL files listed in **docs/EXTERNAL_DB_SCHEMA_BREAKDOWN.md**.

---

## Fix: apply schemas (recommended)

Apply the schema/migration SQL to the **existing** DBs (no new DBs; they already exist):

```bash
PGPASSWORD=postgres ./scripts/apply-external-db-schemas.sh
```

- Uses **PGHOST** (default `127.0.0.1`), **PGPASSWORD**, **PGUSER** (default `postgres`).
- Runs the correct **infra/db/*.sql** files per port/DB (see EXTERNAL_DB_SCHEMA_BREAKDOWN.md).
- Idempotent where the SQL uses `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`.

After this, run the inspect script again; you should see the proper schemas and tables (and approximate row counts will stay 0 until you seed or restore data).

---

## Optional: restore from backup (data + schema)

See **docs/EXTERNAL_POSTGRES_BACKUP_AND_RESTORE.md** for a full checklist (apply schemas first, then restore, then verify) so external Postgres stays in a known state.

If you previously had data and have a backup:

- **Backup location:** Backups are written to **backups/** (e.g. `backups/record-platform-postgres-1-all-20260101-214507.sql`). The log in **backup/backup-full-*.log** refers to that directory.
- **One big dump:** A single `pg_dumpall` or full instance dump (e.g. 1.0G) usually covers **one** Postgres instance (e.g. records on 5433). Restoring it puts schema + data into that instance.
- **Eight instances:** You now have 8 separate Postgres containers (5433–5440). To have tables and data everywhere:
  1. **Apply schemas** to all 8 (see above) so every DB has the right tables.
  2. **Restore** any dump you have into the matching instance (e.g. records dump → port 5433, `records` DB) using:
     - **scripts/restore-to-external-docker.sh** (e.g. for records to 5433), or
     - **scripts/restore-from-local-backup.sh** (for in-cluster restore), or
     - manual `psql -h 127.0.0.1 -p &lt;port&gt; -U postgres -d &lt;db&gt; -f backup.sql` (or `pg_restore` for custom format).

If you only have one dump (e.g. records), apply schemas to all 8 first, then restore that dump into the records instance; the other seven will have tables but no data until you seed or add more backups.

---

## Summary

| Goal                         | Action |
|-----------------------------|--------|
| Get tables (and correct schemas) on all 8 DBs | Run **scripts/apply-external-db-schemas.sh** |
| See current state again     | Run **scripts/inspect-external-db-schemas.sh** (or write to docs/CURRENT_DB_SCHEMA_REPORT.md) |
| Restore data into one DB    | Apply schemas first, then use **restore-to-external-docker.sh** or **restore-from-local-backup.sh** for the dump you have |
| Row caps and governance     | See **docs/DATA_GOVERNANCE_AND_SCHEMA_CAPS.md** |
