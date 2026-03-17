# k3d → k3s/Colima: Where Your Data Lives

## Why cart/order counts dropped after switching

**Shopping carts and orders** (and all other app data) live in **external PostgreSQL** run by Docker Compose, **not** inside the Kubernetes cluster. The cluster (k3d or Colima/k3s) only runs the app pods; they connect to Postgres via `host.docker.internal` and ports 5433–5440.

So:

- **Same machine, same Docker Compose**: If you kept the same `docker compose` stack and the same volumes, data on 5433–5440 (including 5436/shopping) is unchanged when you switch context from k3d to Colima. Nothing is “lost” by switching clusters.
- **New machine or new stack**: If you brought up Colima (or a new Docker host) and ran `docker compose up -d` there, you get **new** Postgres containers and **new** volumes. Those DBs start empty. That’s why you see far fewer carts/orders (e.g. 5000 carts vs millions).
- **Preflight “removes in-cluster Postgres”**: Preflight explicitly removes any in-cluster Kafka/Zookeeper/Postgres so that **only** external Postgres (Docker) is used. If you previously had data in in-cluster Postgres (e.g. on k3d), that data is not migrated to the external stack; it was never in the same place as the current 5433–5440.

So the “mysterious” loss is usually: **different Postgres instance (new volumes)** or **moving from in-cluster DB to external DB** without a one-time migration/restore.

## What to do

1. **Re-seed at scale (recommended)**  
   Use the same seeding/load scripts you used before, against the **current** external Postgres (localhost 5433–5440):
   - Seed jobs: `kubectl apply -f infra/k8s/overlays/dev/jobs/` (seed-auth, seed-records).
   - Bulk load: e.g. `scripts/seed-all-eight-databases.sh` (see docs/ANALYTICS_PYTHON_AI_DUAL_WRITE_AND_AUTH.md), or `TARGET_ROWS=... ./scripts/load-records-millions.sh` and similar for carts/orders/social if you have them.
   - pgbench can also populate data; see `scripts/run_pgbench_sweep.sh` and `docs/COLD_TUNING_AND_PGBENCH.md`.

2. **Restore from backup**  
   If you have dumps from the old environment, restore them into the **current** Docker Postgres (same host/volumes you use with Colima). See `docs/archive/COLIMA_DATA_RESTORE_STATUS.md` and restore scripts (e.g. `scripts/restore-postgres-databases.sh`); ensure backup format matches your schema (postgres DB + schemas vs separate databases).

3. **Preflight and migrations**  
   Use `SKIP_PREFLIGHT_MIGRATIONS=1` when DBs are already migrated so preflight doesn’t re-run migrations every time. When you add schema changes, run the relevant `ensure-*` scripts once (e.g. `ensure-social-migrations.sh`, `ensure-shopping-order-number-sequence.sh`).

## Summary

| Data            | Location              | k3d → k3s |
|-----------------|-----------------------|-----------|
| Carts, orders   | External Postgres 5436 (Docker) | Same data only if same Docker Compose + volumes. New stack = new (empty) DB. |
| Auth, records, etc. | External Postgres 5433, 5437, etc. | Same as above. |
| In-cluster DB   | Removed by preflight  | Not used; any old in-cluster data is not in 5433–5440. |

Re-seed or restore into the current external Postgres to get back to millions of rows.

## Check which volumes exist and load millions

**List Postgres volumes (and see that data is in Docker, not in the cluster):**

```bash
./scripts/check-postgres-volumes.sh
```

This lists the 8 named volumes (`pgdata`, `pgdata-social`, `pgdata-listings`, etc.) used by `docker-compose.yml` and whether they exist. Same host = same volumes when you switch kube context.

**Load millions into each DB/schema:**

- **All eight DBs (aligned seed):**  
  `ROWS_PER_SCHEMA=2000000 ./scripts/seed-all-eight-databases.sh`  
  See `docs/ANALYTICS_PYTHON_AI_DUAL_WRITE_AND_AUTH.md` (default is ~1.5M per schema).

- **Records only:**  
  `TARGET_ROWS=2500000 ./scripts/load-records-millions.sh`  
  See `scripts/PGBENCH_HARDENING.md`.

- **Per-schema overrides:**  
  Use env vars such as `TARGET_ROWS`, `TARGET_POSTS`, `TARGET_LISTINGS` as documented in the seed/load scripts.
