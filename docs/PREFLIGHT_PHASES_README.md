# Preflight Phase Model

Preflight is **phase-gated** so the control plane is never overloaded. See `docs/COLIMA_K3S_CONTROL_PLANE_STABILIZATION_PLAN.md` for the full plan.

## Phases

| Phase | Purpose | MetalLB | Load (pgbench/k6) | Writes to API |
|-------|---------|---------|-------------------|---------------|
| **0** | Freeze (one-time): Colima only, single cluster, read-only stable; then exit. No reissue, no MetalLB, no pgbench/k6. | No | No | No (exit after check) |
| **A** | Control-plane sanity: API, namespaces, base manifests, rollouts | No | No | Yes (serialized) |
| **B** | Cert issuance & rotation: CA, leaf, secrets, restart workloads, verify mTLS | No | No | Yes (serialized) |
| **C** | Data-plane load: pgbench, k6, metrics | No | Yes | No |
| **D** | Network/LB: MetalLB, Services, verify allocations | Yes | No | Yes (serialized) |
| **E** | Chaos / full stack (optional, never default) | Optional | Optional | — |

## Environment variables

* **PREFLIGHT_PHASE** — `A` \| `B` \| `C` \| `D` \| `full` (default: `full` = run A→B→C, skip D unless enabled).
* **PREFLIGHT_PHASE0** — `1` = run Phase 0 only (freeze check + exit). Colima only, single cluster, read-only; no reissue, MetalLB, pgbench, k6. See `docs/PREFLIGHT_PHASED_PLAN_20260207.md`.
* **METALLB_ENABLED** — `0` (default) or `1`. If `0`, steps 3c1 (MetalLB install) and 3c2 (Caddy apply as LoadBalancer) are skipped; Caddy stays NodePort for core preflight.
* **APPLY_RATE_LIMIT_SLEEP** — Seconds to sleep between apply batches (default: `2`; minimum `1`). Phase 5 guardrail.
* **PREFLIGHT_ABORT_ON_SLOW_APPLY** — If set, any `kubectl apply` taking >10s aborts the phase (default: enabled when `PREFLIGHT_PHASE` is set).
* **PREFLIGHT_WRITE_LOCK_FILE** — Lock file for Phase 1B serialized writes (default: `/tmp/preflight-write.lock`). Use empty to disable lock. On macOS, `flock` is not built-in: run **`brew install flock`** to use file locking; otherwise the script uses a portable **mkdir-based lock** (same semantics, no extra install).
* **PREFLIGHT_ABORT_ON_503** — Abort on 503/reset during writes (default: `1`). See phased plan.

## One kubeconfig decision per run

At the start of preflight we select the API endpoint (6443 if reachable, else native) and **freeze** kubeconfig for the rest of the run. We do not mutate the cluster server URL mid-pipeline.

## How to run

* **Phase 0 only (freeze check, then exit):**  
  `PREFLIGHT_PHASE0=1 ./scripts/run-preflight-scale-and-all-suites.sh`  
  Or run the check script alone: `./scripts/preflight-phase0-freeze-check.sh`
* **Phase A only (control-plane sanity, no MetalLB, no load):**  
  `PREFLIGHT_PHASE=A METALLB_ENABLED=0 ./scripts/run-preflight-scale-and-all-suites.sh`
* **Full preflight without MetalLB (A+B+C, no D):**  
  `METALLB_ENABLED=0 ./scripts/run-preflight-scale-and-all-suites.sh`
* **With MetalLB (include Phase D):**  
  `METALLB_ENABLED=1 ./scripts/run-preflight-scale-and-all-suites.sh`
* **Suites only (no pgbench/k6):**  
  `RUN_FULL_LOAD=0 METALLB_ENABLED=0 ./scripts/run-preflight-scale-and-all-suites.sh`
* **Run all 8 pgbench sweeps without preflight** (e.g. when control plane is broken or you only need DB metrics):  
  `./scripts/run-all-8-pgbench-standalone.sh`  
  Default: **deep** (clients 8..256), **RUN_PLAN_DUMP=1**, **PLAN_CACHE_MODE=force_generic_plan** (no rogue prepared statements), **Little's Law** (lat_est_ms in CSVs). Produces a combined **EXPLAIN (ANALYZE, BUFFERS)** log for all 8 DBs/schemas: `${PGBENCH_LOG%.log}-explain-all-schemas-dbs.log`.  
  **Survives disconnect:** `nohup ./scripts/run-all-8-pgbench-standalone.sh >> /tmp/pgbench-standalone.log 2>&1 &` then `tail -f /tmp/pgbench-standalone.log`. Or `RUN_DETACHED=1 ./scripts/run-all-8-pgbench-standalone.sh`.  
  Optional: `PGBENCH_MODE=quick`, `PGBENCH_PARALLEL=1`, `RUN_EXPLAIN_ALL=0`. Prereq: Postgres 5433–5440 up, migrations applied.

## Phase 1 reissue (health gate + abort)

When **REISSUE_PHASE1_ABORT=1** (default), the reissue script (step 3a) runs a **health gate** (3× readyz) before the first secret apply and **aborts on first write failure** (max 1 retry after readyz). No 12-retry storm. Set **REISSUE_PHASE1_ABORT=0** to restore legacy retry behavior. See `docs/ETCD_WRITE_BUDGET_PLAN.md`.

## References

* `docs/PREFLIGHT_PHASED_PLAN_20260207.md` — Phase 0–5 plan (freeze, read/write split, cert lifecycle, load budget, MetalLB gated, guardrails).
* `docs/COLIMA_K3S_CONTROL_PLANE_STABILIZATION_PLAN.md`
* `docs/adr/005-control-plane-is-rate-limited.md`
* Runbook.md item 32 (API 503 / reset-by-peer)
