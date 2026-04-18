# Preflight Phase Barrier Contract (v1)

This document defines **guarded transitions** between heavy preflight phases so one phase does not leave latent load (gateway shaper queues, connection churn, throttle keys) that falsifies the next.

## Goal

Each phase ends in a **stable equilibrium** before the next begins:

- No saturated in-process gateway shaper wait queues
- No stuck watchdog throttle halving shaper capacity (when Redis is used)
- Cluster headroom within configured thresholds
- Workload pods in `HOUSING_NS` in `Running` (or `Succeeded` for Jobs)
- Jaeger Query reachable when `JAEGER_QUERY_BASE` is set

## Canonical implementation

- **Script:** `scripts/phase-barrier.sh <phase-name>`
- **Make:** `make phase-barrier PHASE_NAME=post-kafka-alignment`
- **Preflight:** `scripts/run-preflight-scale-and-all-suites.sh` invokes barriers at fixed anchors (see script header env `PREFLIGHT_PHASE_BARRIER_*`).

## Barrier layers (v1 script)

| Layer | Behavior |
|--------|-----------|
| **Cluster headroom** | Same semantics as `scripts/cluster-stability-guard.sh` (`kubectl top nodes`, CPU/MEM % → idle/free vs `CLUSTER_GUARD_*`). Skippable: `PHASE_BARRIER_SKIP_CLUSTER_HEADROOM=1`. |
| **Pod stability** | In `HOUSING_NS` only: fail if any pod is not `Running` and not `Succeeded` (requires `jq`). Skippable: `PHASE_BARRIER_SKIP_POD_STABILITY=1`. |
| **Gateway drain** | `kubectl rollout restart deployment/api-gateway` + `rollout status` + `PHASE_BARRIER_POST_GATEWAY_SLEEP_SEC` (default 5). Stateless gateway: clears E2E shaper `inUse` / waiter queue. Skippable: `PHASE_BARRIER_SKIP_GATEWAY_RESTART=1`. |
| **Watchdog reset** | Best-effort `DEL` on `och:gw:watchdog_throttle` via `deploy/redis` + `redis-cli` when present. For external Redis, set **`PHASE_BARRIER_WATCHDOG_REDIS_DEL_CMD`** to a shell snippet that deletes the key. Skippable: `PHASE_BARRIER_SKIP_WATCHDOG_CLEAR=1`. |
| **Jaeger** | Runs `scripts/verify-jaeger-liveness.sh` when `JAEGER_QUERY_BASE` is set. Skippable: `PHASE_BARRIER_SKIP_JAEGER=1`. |
| **Pool stabilize** | Optional trailing `sleep` via `PHASE_BARRIER_TRAILING_STABILIZE_SEC` (e.g. `10` after integration-heavy phases). |

## Preflight anchors (defaults on)

| Barrier name | When |
|----------------|------|
| `post-kafka-alignment` | Immediately after a successful **6a2c9** Kafka alignment suite. |
| `pre-step7-suites` | Before step 7 suite matrix (QUIC L1 span + `_run_all_suites`). Controlled by `PREFLIGHT_PHASE_BARRIER_PRE_STEP7` (default on). Legacy: `PREFLIGHT_GATEWAY_DRAIN_BEFORE_STEP7=0` skips this barrier. |
| `post-integration` | After repo Vitest stack / system contracts (**7a0c**), before per-service Vitest + housing bash suites. Trailing stabilize default **10s** via `PHASE_BARRIER_POST_INTEGRATION_STABILIZE_SEC`. |
| `post-k6-service-grid` | After **7a3–7a7** k6 per-service edge smoke (when that block runs), before listings lab / Phase D. |

Disable individual barriers with `PREFLIGHT_PHASE_BARRIER_POST_KAFKA=0`, `PREFLIGHT_PHASE_BARRIER_PRE_STEP7=0`, etc.

## Strict transition rule

A transition **fails** (script exits non-zero; preflight uses `fail` / `return 1`) when:

- Headroom check runs and a node is below threshold, or
- A bad pod is found in `HOUSING_NS`, or
- Gateway rollout does not complete within `PHASE_BARRIER_GATEWAY_ROLLOUT_TIMEOUT`, or
- Jaeger liveness is required and Query is unreachable after retries

Watchdog `DEL` and missing in-cluster Redis are **non-fatal** (informational only).

## Optional hardening (future)

- Expose shaper internals (`inUse`, wait queue depth, `effectiveMax`) on a gateway `/_internal/shaper` endpoint and gate barriers on metrics instead of (or in addition to) rollout restart.
- `E2E_TRAFFIC_SHAPER_MAX_WAITERS` is already configurable in `services/api-gateway/src/e2e-traffic-shaper.ts` (see dev overlay).

## Relation to transport / tracing

Barriers are **orthogonal** to QUIC capture and Jaeger verification: they prevent **application-path** false negatives (for example `e2e_shaper_queue_full` 503) caused by phase bleed-through, not transport proofs.
