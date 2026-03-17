# External DB schema breakdown (8 DBs)

**Purpose:** Map each of the 8 external Postgres instances (ports 5433–5440) to the exact `infra/db/*.sql` schema/migration files to apply. **Do not create new DBs** — they already exist; this doc is for applying schemas only.

See also: **docs/DATA_GOVERNANCE_AND_SCHEMA_CAPS.md** (row caps per schema), **scripts/ensure-external-databases-created.sh** (ensures DB names exist), **scripts/apply-external-db-schemas.sh** (applies these files to existing DBs).

---

## Port → database → schema files (apply in order)

| Port | Database   | Schema / migration files to apply (in order) |
|------|------------|----------------------------------------------|
| **5433** | records    | `03-database.sql`, `46-records-prisma-columns.sql`. Optional: `10-content-hash-migrations.sql`, `11-catalog-data-lake-model.sql`, `41-partition-records.sql`, `42-partition-cutover.sql`, `43-optimize-knn-trgm.sql`, `44-optimize-planner.sql`, `45-drop-unused-indexes-records.sql`, `12-apply-gold-defaults.sql`. |
| **5434** | social     | `04-social-schema.sql`, `04-social-schema-upload-type-migration.sql`, `04-social-schema-archive-recall-kickban.sql`, `04-social-schema-roles-migration.sql`, `04-social-schema-messages-standalone.sql`, `18-social-messages-roles-leave.sql`. Optional: `10-content-hash-migrations.sql`. |
| **5435** | listings   | `05-listings-schema.sql`, … `09-listings-reports.sql`, `16-listings-seller-shipping-promotions.sql`, `19-listings-seller-availability.sql`, `20-listings-flag-notify-seller.sql`. |
| **5436** | shopping   | `06-shopping-schema.sql`, … `15-shopping-notifications.sql`, `17-shopping-price-alerts-saved-searches.sql`. Optional: `10-content-hash-migrations.sql`. |
| **5437** | auth       | `07-auth-schema.sql`, `07-auth-schema-extended.sql`, `07-auth-passkeys.sql`, `07-auth-user-addresses.sql`. |
| **5438** | postgres   | Auction monitor uses **default DB `postgres`**. Apply: `07-auction-monitor-schema.sql`, `07-auction-monitor-schema-extended.sql`. |
| **5439** | analytics  | `08-analytics-schema.sql`. |
| **5440** | python_ai  | `09-python-ai-schema.sql` (or `python-ai-schema.sql`). |

---

## Cross-DB / optional

- **10-content-hash-migrations.sql** — Safe on multiple DBs; adds content_hash/notes_hash where schemas exist (social, shopping, records). Run once per DB that has those schemas/tables.
- **11-db-roles.sql** — Creates roles and schema grants (auth, records, listings, analytics). Run once per instance if you use dedicated roles; otherwise skip.
- **11-catalog-data-lake-model.sql** — Records/catalog; apply on **records** (5433) if using data lake model.
- **31-data-summary.sql**, **31-loader-helpers.sql** — Loader/analytics helpers; apply where needed (e.g. analytics or records).
- **comprehensive-db-tuning.sql**, **service-specific-tuning.sql**, **optimize-listings-db.sql** — Tuning; apply per instance/DB as desired.

---

## Quick reference: DB names and create scripts (no new DBs)

| Port | DB name   | Create script (only if DB missing) | Apply schemas to |
|------|-----------|-----------------------------------|------------------|
| 5433 | records   | 00-create-records-database.sql    | records          |
| 5434 | social    | 00-create-social-database.sql     | social           |
| 5435 | listings  | 00-create-listings-database.sql   | listings         |
| 5436 | shopping  | 00-create-shopping-database.sql   | shopping         |
| 5437 | auth      | 00-create-auth-database.sql       | auth             |
| 5438 | postgres  | (none; use default DB)            | postgres         |
| 5439 | analytics | 00-create-analytics-database.sql | analytics        |
| 5440 | python_ai | 00-create-python-ai-database.sql  | python_ai        |

---

## Applying schemas

1. **No new DBs:** Use **scripts/ensure-external-databases-created.sh** only to ensure DB names exist on already-running Postgres.
2. **Apply schemas:** Use **scripts/apply-external-db-schemas.sh** to run the files above against the correct host:port and database (idempotent where SQL uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
3. **Service migrations:** Some services (e.g. Prisma) apply their own migrations; the table above matches what the platform expects and what the 00-create-* comments describe.
