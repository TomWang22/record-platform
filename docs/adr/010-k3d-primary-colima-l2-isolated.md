# ADR 010: k3d Primary; Colima k3s Isolated for MetalLB L2 Only

**Status:** Accepted  
**Date:** 2026-02  
**Context:** Preflight and test suites run on **k3d** by default (REQUIRE_COLIMA=0) for stability. MetalLB install, pool, and verification (including LB IP reachability via socat on k3d) all run on k3d. Real L2/ARP/BGP behaviour requires a real network; **Colima k3s** provides that but is heavier and was previously either required for everything or not clearly isolated.

## Decision

1. **k3d is the primary cluster** for preflight and all test suites. All steps (trim, API check, apply, MetalLB install, MetalLB verification, Caddy, suites, k6, pgbench) run on k3d when `REQUIRE_COLIMA=0`.

2. **MetalLB on k3d** is the default path when `METALLB_ENABLED=1`:
   - MetalLB controller, speaker, IPAddressPool, L2Advertisement (and optional FRR BGP) run on k3d.
   - LoadBalancer services receive an external IP from the pool (e.g. 192.168.106.241).
   - On k3d the LB IP is not natively host-reachable; **socat + loopback alias** (see `setup-lb-ip-host-access.sh`) make the LB IP reachable from the host so HTTP/1.1, HTTP/2, and HTTP/3 can be verified via the same IP. This is the **production-like path** (traffic via LB IP, not NodePort).

3. **Colima k3s is used only for optional real L2/BGP verification**, isolated to a single step:
   - When `METALLB_VERIFY_COLIMA_L2=1`, preflight runs step **3c1c** on Colima: it discovers Colima’s context (from `~/.colima/default/kubernetes/kubeconfig` or `colima status` profile), merges that kubeconfig, switches context to Colima, runs `verify-metallb-colima-l2-only.sh` (real L2/ARP/asymmetric/BGP), then **restores** kubeconfig and context to k3d for the rest of preflight and suites.
   - Colima is **not** used for apply, scale, or suites; only for this optional verification step.
   - If Colima is not running or no Colima context is found, preflight warns and continues on k3d (no failure).

4. **LB IP as first choice for HTTP/2 and HTTP/3** (separate follow-up): When MetalLB is enabled and the LB IP is reachable (socat or native), tests and run-all should use the **LB IP** for HTTP/2 and HTTP/3 rather than NodePort as the first choice; NodePort remains the fallback when LB IP is not available.

## Rationale

| Concern | k3d primary | Colima only for L2 |
|--------|-------------|---------------------|
| **Control plane stability** | Preflight and suites don’t overload a single Colima control plane. | Colima is used only for a short, isolated L2 verification. |
| **MetalLB behaviour** | L2 mode and pool work on k3d; host reachability via socat is explicit and documented. | Real ARP and asymmetric routing need a real network (Colima VM). |
| **Reproducibility** | Same k3d path for CI and local dev. | Optional Colima step is clearly separated and skippable. |
| **Operational clarity** | One primary cluster; no context thrashing. | Context switch is scoped to 3c1c and restored immediately. |

## Consequences

- Preflight and suites default to k3d; Colima is optional and only for step 3c1c when `METALLB_VERIFY_COLIMA_L2=1`.
- Colima must be running and its kubeconfig available (~/.colima/default/kubernetes/kubeconfig or profile-based path) for 3c1c to run; otherwise a warning is printed and the run continues on k3d.
- Documentation (README, ENGINEERING.md, Runbook) describes k3d as primary and Colima L2 as an isolated, optional step.
- Future work: prefer LB IP over NodePort for HTTP/2 and HTTP/3 when the LB IP is reachable (see todo / Runbook).

## References

- **ADR 008** — Multi-node required; MetalLB valid.
- **ADR 009** — k3d as default local cluster.
- **README.md** — Cluster architecture (k3d + Colima).
- **ENGINEERING.md** — Cluster topology and MetalLB.
- **scripts/run-preflight-scale-and-all-suites.sh** — Step 3c1, 3c1a, 3c1b (k3d), 3c1c (Colima L2 only).
- **scripts/verify-metallb-colima-l2-only.sh** — Real L2/BGP on Colima.
- **scripts/verify-metallb-and-traffic-policy.sh** — Full verification on current context (k3d with socat for LB IP).
