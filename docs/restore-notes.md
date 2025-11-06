## Context
- Kubernetes namespace: `record-platform`
- DB name: `records`
- Postgres lives in pod with label `app=postgres`
- Bundle file copied to pod: `/tmp/pg_bundle.pkg`
- We run the restore via `kubectl exec ... bash -s -- "$DB" "$CLEAN"`

## Goal
Idempotent restore that:
- creates roles, extensions, schemas
- replays `schema.sql` and other `*.sql` safely
- ignores every psql meta-command (`\...`)
- avoids “multiple primary keys” by pre-dropping PKs only when the dump will add one
- guards `ALTER TABLE ... ADD CONSTRAINT` and `CREATE MATERIALIZED VIEW` in `DO $$...$$` blocks
- refreshes MVs and applies grants

## Current errors to fix
- `psql: error: \unrestrict: not currently in restricted mode`
- `ERROR: multiple primary keys for table "results" are not allowed`
- `awk: Unexpected end of string` (quotes in awk printf blocks)

## Invariants / preferences
- Use `psql -X -v ON_ERROR_STOP=1`
- Strip *all* `\` meta-commands before SQL hits psql
- Prefer dollar-quoting over single quotes inside awk-generated DO blocks
- Keep the script idempotent: safe to re-run with `CLEAN=0` or `CLEAN=1`

## Files and folders to look at
- @schema.sql
- @functions.sql
- @globals.sql (may contain meta-commands!)
- @show_all.txt (reference only)
- @pg_bundle_20251104T050310Z

## Repro command
kubectl -n record-platform exec -i "$PGPOD" -c db -- bash -s -- "$DB" "$CLEAN" < restore.sh

## Bundle layout
We store logical snapshot as a **directory**: `pg_bundle_YYYYMMDDTHHMMSSZ` containing `schema.sql`, `functions.sql`, `globals.sql`, and TSVs.

## How we copy the bundle into the pod
We prefer copying the **directory**:
```bash
kubectl -n record-platform cp ./pg_bundle_20251104T050310Z "$PGPOD":/tmp/pg_bundle -c db