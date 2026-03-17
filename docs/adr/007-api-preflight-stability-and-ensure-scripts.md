# ADR 007: API and Preflight Stability — Ensure Scripts and Layered Readiness

**Status:** Accepted  
**Date:** 2026-02-08  
**Context:** Colima + k3s; preflight pipeline; Runbook items 40, 46–49.

## Context and Problem

The preflight pipeline (`run-preflight-scale-and-all-suites.sh`) and test suites depend on:

1. **Kubernetes API** reachable from the host (Colima tunnel 127.0.0.1:6443 or native port).
2. **All 8 Postgres** instances (ports 5433–5440) up so pgbench and service health checks succeed.
3. **Kafka** (Docker :29093) for social/analytics/auction-monitor.

Failures observed:

- **API**: After step 1 (Colima check), kubeconfig preflight and `ensure-api-server-ready` could still see 503 or "connection reset by peer" because the 6443 tunnel was stale or the API was briefly overloaded.
- **DBs**: Daily pgbench (and preflight step 3b3) failed when Docker/Colima was stopped or Postgres containers were not started — "Connection refused" on 5437, "Database did not become ready" on 5435/5436/5438/5439/5440.
- **Layers**: No single "get ready" path; operators had to run Colima, forward 6443, start Docker Compose, then run preflight, with no clear diagnostic when something was missing.

## Decision

1. **Ensure-K8s-API**  
   Use `ensure-k8s-api.sh` (retries + re-forward 6443 on first failure) **after** the initial Colima/API check in the preflight script so the tunnel is re-verified before kubeconfig and ensure-api-server-ready. Scripts that depend on a working API (install-metallb, apply-caddy-h3-ingress, bring-up-stack) already call it; preflight now calls it at step 1b.

2. **Ensure-Pgbench-DBs-Ready**  
   New script `ensure-pgbench-dbs-ready.sh`: if Docker is available, runs `docker compose up -d` for the eight Postgres services and waits (up to 120s) for ports 5433–5440 to be reachable. The daily pgbench script (`run-daily-pgbench-standalone-with-results.sh`) runs this at the start so cron runs don’t fail when DBs are down.

3. **Ensure-Ready-For-Preflight**  
   New script `ensure-ready-for-preflight.sh`: (1) optional cross-layer diagnostic, (2) ensure-k8s-api, (3) ensure-pgbench-dbs-ready, (4) ensure Kafka :29093, then print "run preflight" or run it with `--run`. Single entry point to get to a known-good state before preflight.

4. **Documentation**  
   - Runbook: new bug/decision entry for API/preflight readiness and ensure scripts.  
   - PREFLIGHT_AND_DIAGNOSTICS.md: "Get ready to run preflight" with the above flow and layer order.

## Consequences

- **Positive**: One command (`ensure-ready-for-preflight.sh`) brings API, DBs, and Kafka up and confirms readiness; preflight is less flaky after step 1 because the tunnel is re-established if needed.
- **Positive**: Daily pgbench no longer runs blindly when DBs are down; it starts Postgres and waits.
- **Negative**: Extra few seconds at the start of preflight (ensure-k8s-api) and of daily pgbench (ensure-pgbench-dbs-ready); acceptable for stability.
- **Operational**: When preflight or suites fail, run `./scripts/colima-k3s-cross-layer-diagnostic.sh` and `./scripts/ensure-ready-for-preflight.sh` to see state and fix API/DBs/Kafka before re-running.

## References

- Runbook.md: Colima API (item 40), Reissue (46–49), "Get ready" and ensure scripts (new).
- docs/PREFLIGHT_AND_DIAGNOSTICS.md: Get ready to run preflight.
- docs/COLIMA_K3S_ANALYZE_EVERY_LAYER.md: Layer-by-layer diagnostic.
- scripts/ensure-k8s-api.sh, ensure-pgbench-dbs-ready.sh, ensure-ready-for-preflight.sh.
