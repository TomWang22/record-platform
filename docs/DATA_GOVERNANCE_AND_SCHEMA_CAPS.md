# Data Governance and Schema Row Caps

**Policy:** Each schema outside port 5433 (records) is capped at **1 million rows** per schema for data lake and query stability. Port 5433 (records) can exceed 1M as the primary collection store.

---

## Scope

| Port | Database   | Schemas              | Cap (rows per schema) |
|------|------------|----------------------|------------------------|
| 5433 | records    | records, auth, …     | No hard cap (primary)  |
| 5434 | social     | forum, messages      | 1M per schema          |
| 5435 | listings   | listings             | 1M                      |
| 5436 | shopping   | shopping, feedback   | 1M per schema          |
| 5437 | auth       | auth                 | 1M                      |
| 5438 | postgres   | auction_monitor      | 1M                      |
| 5439 | analytics  | analytics            | 1M                      |
| 5440 | python_ai  | ai                   | 1M                      |

---

## Rationale

- **Query and planning stability:** Very large tables outside the main records DB can slow planning and increase memory use; capping keeps hot paths predictable.
- **Data lake / governance:** Clear ownership and size limits per schema simplify retention, archival, and compliance.
- **Seeding and testing:** Seeder and load scripts can target up to 1M rows per schema outside 5433 (e.g. `LISTINGS_ROWS`, `SOCIAL_POSTS_ROWS`) to stay under cap.

---

## Enforcement

- **Application / ETL:** Enforce at insert or batch level (e.g. reject or archive when count exceeds 1M per schema).
- **Monitoring:** Periodic checks per schema (e.g. `SELECT count(*) FROM schema.table`) and alerts when approaching 1M.
- **Archival:** Before hitting cap, archive or move old rows to cold storage and keep only recent 1M in the live schema.

---

## Related

- **docs/COLD_TUNING_AND_SEEDING.md** — Seeding targets (2.4M overall, 1M+ outside 5433) and hot tenant.
- **docs/WHY_NO_USER_TABLES_AND_HOW_TO_FIX.md** — Why inspect shows “no user tables” and how to apply schemas (apply-external-db-schemas.sh) or restore from backup.
- **docs/EXTERNAL_POSTGRES_BACKUP_AND_RESTORE.md** — Checklist so external Postgres stays in a known state (apply schemas, restore from backup, verify).
- **docs/SHOPPING_SCHEMA_AND_FEATURES.md** — Shopping cart cost, recently viewed, watchlist, country, feedback/reviews (eBay-style).
- **docs/SCHEMA_DESIGN_EXTENSIONS.md** — Records CSV alignment, listings (shipping, seller availability, promotions, flagging), shopping (price alerts, saved searches, discounts, bundle shipping), social (roles, leave, who-read), payment simulation.
- **scripts/seed-all-dbs.sh** — Row counts via env vars; keep totals per schema ≤ 1M when scaling.
