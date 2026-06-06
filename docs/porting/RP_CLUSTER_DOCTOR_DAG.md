# Record Platform cluster doctor & bootstrap DAG

The OCH cold-bootstrap toolkit (`och-cold-bootstrap-toolkit-*.tar.gz`) is extracted under `toolkit-reference/` for comparison only. **Use the RP repo targets below.**

## DAG artifacts

| File | Purpose |
|------|---------|
| `infra/bootstrap_invariants.graph.json` | Phase DAG (A.workspace → … → E.transport) |
| `scripts/lib/rp-cluster-dependency-dag.json` | Live cluster dependency graph (5433–5443, Redis 6379) |
| `scripts/cluster_health_dag.py` | Bootstrap score, doctor, drift |
| `scripts/verify-bootstrap-state.mjs` | Machine-verifiable phase JSON |
| `scripts/bootstrap-cluster.sh` | Full Colima bootstrap (calls P9 DAG) |

## Make targets

```bash
make bootstrap-invariants-order    # bench_logs/bootstrap_allowed_order.json
make visualize-bootstrap-dag       # bench_logs/bootstrap_dag.html
make cluster-doctor              # bench_logs/cluster-doctor.json
make detect-drift
make verify-bootstrap-state      # bench_logs/bootstrap-state-verify-latest.json
```

Strict doctor (exit if score < 95):

```bash
CLUSTER_DOCTOR_STRICT=1 make cluster-doctor
```

## Cold-bootstrap integration (embedded — do not run doctor separately)

`COLD_BOOTSTRAP_CONFIRM=yes RESTORE_BACKUP_DIR=… make cold-bootstrap` runs DAG phases **A→J** in one shot:

- **A–E:** workspace, crypto, host infra, hybrid materialize, restore 5433–5443
- **F–G:** `make bootstrap` + `cluster_health_dag.py bootstrap`
- **I:** MetalLB + `/etc/hosts` gate (no edge smoke)
- **J:** `cluster-doctor`, `verify-bootstrap-state`, drift, Grafana/failure summary, wall-clock JSON

Configure score gate: `RP_CLUSTER_DOCTOR_MIN_SCORE=90` (default). Strict standalone doctor: `CLUSTER_DOCTOR_STRICT=1` (95).

Edge host: `record-platform.test` via `RP_PUBLIC_HOST`. Bootstrap complete only after `make rp-preflight-network-contract`.

## Hybrid restore (not OCH runtime)

```bash
COLD_BOOTSTRAP_CONFIRM=yes RESTORE_BACKUP_DIR=backups/all-8-20260517-152701 make cold-bootstrap
```

Resolves to `backups/hybrid-rp-och/materialized-rp-runtime` (ports 5433–5443 only).
