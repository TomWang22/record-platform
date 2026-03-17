# Schema report and diff (dump as source of truth)

Use the **restore bundle** (e.g. `backups/all-8-20260226-223226`) as the source of truth for data; **migrations** run after restore to bring schema “dead on” with the baseline. `setup-from-nuclear.sh` does: ensure (create DBs/schemas) → restore (load dump) → **ensure again** (re-apply migrations so tables/columns the dump doesn’t have are added).

To compare what’s in the DB now vs a baseline:

## 1. Generate “after restore” report

```bash
PGPASSWORD=postgres ./scripts/inspect-external-db-schemas.sh docs/CURRENT_DB_SCHEMA_REPORT_after_restore.md
```

## 2. Diff vs baseline

Baseline is the committed report (or a previous snapshot). **Note:** `diff` exits with code **1** when the files differ (that’s normal). So a bare `diff ... > file` will make your shell show “exit 1” even though the diff was written. Use the script below to get **exit 0**:

```bash
./scripts/schema-report-diff.sh
```

Or run diff directly (exit 1 when files differ is expected):

```bash
diff -u docs/CURRENT_DB_SCHEMA_REPORT.md docs/CURRENT_DB_SCHEMA_REPORT_after_restore.md > docs/CURRENT_DB_SCHEMA_REPORT_diff.txt || true
```

- **`docs/CURRENT_DB_SCHEMA_REPORT.md`** — baseline (e.g. from a previous run or from the dump’s expected state).
- **`docs/CURRENT_DB_SCHEMA_REPORT_after_restore.md`** — current state after restore from `backups/all-8-*`.
- **`docs/CURRENT_DB_SCHEMA_REPORT_diff.txt`** — unified diff of the two.

## 3. Update baseline from the dump

After restoring from the bundle, you can refresh the baseline so it matches the dump:

```bash
PGPASSWORD=postgres ./scripts/inspect-external-db-schemas.sh docs/CURRENT_DB_SCHEMA_REPORT.md
```

Then commit `docs/CURRENT_DB_SCHEMA_REPORT.md` if you want the repo’s “expected” report to match the restored state.

## Migrations fixed to match restore

- **23-listings-lifecycle-status.sql** — Adds `visible_until` if not exists before commenting (so it works when the dump doesn’t have that column).
- **09-shopping-order-number-sequence.sql** — Uses `GREATEST(1, seq_val, ...)` so `setval(0)` is never passed (empty DB safe).
- **05-listings-timeline-duration.sql** — Included in `ensure-all-schemas-and-tuning.sh` so `visible_until` / `visible_from` / `duration_days` exist after restore.
