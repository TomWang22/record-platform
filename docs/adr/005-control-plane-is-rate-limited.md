# ADR-005: Control Plane Is Rate-Limited

**Status:** Accepted  
**Date:** 2026-02-07  
**Context:** Preflight and reissue often hit API 503, connection reset, or "apiserver not ready" when many `kubectl` writes run in a burst. Colima k3s is single-node; the API server has finite throughput.

## Decision

We treat the Kubernetes API server as **rate-limited infrastructure**:

* No overlapping phases that write to the API (serialize apply, cert, scale).
* One kubeconfig endpoint decision per run (6443 or native); never mutate mid-pipeline.
* Cert work (CA rotation, leaf issuance, secret patching) is single-threaded and not concurrent with load or Service churn.
* MetalLB is opt-in for preflight; core pipeline runs without MetalLB by default.
* Add explicit sleeps (2–3s) between namespace/CRD/Service creation where applicable.
* Abort phase on: any `kubectl apply` >10s, or 2× 503/connection reset, with a clear "why" message.

## Consequences

* Preflight becomes phase-gated (A: control-plane sanity, B: cert, C: load, D: MetalLB).
* MetalLB and heavy load are isolated so control-plane overload is easier to diagnose.
* Pipeline may be slower but deterministic; failures fail loudly with cause.
* See: `docs/COLIMA_K3S_CONTROL_PLANE_STABILIZATION_PLAN.md`, Runbook item 32, `docs/PREFLIGHT_PHASES_README.md`.
