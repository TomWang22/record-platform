# ADR 010: MetalLB L2 Verification Isolated to Colima k3s

**Status:** Accepted

## Context

- **Preflight and suites** run on **k3d (2-node)** by default (`REQUIRE_COLIMA=0`) so the control plane stays stable (ADR 009; Colima k3s can be overwhelmed under heavy apply/suite load).
- **MetalLB** is installed and used on k3d: LoadBalancer services get an external IP; on k3d the LB IP is in the Docker network and is **not** natively reachable from the host, so we use **loopback alias + socat** (TCP/UDP 443 → NodePort 30443) so the host can curl the LB IP and run HTTP/1.1, HTTP/2, and HTTP/3 tests via that IP.
- On k3d, **L2/ARP and BGP behaviour** are effectively simulated (traffic to the LB IP is forwarded by socat to NodePort). **Real L2** (ARP, asymmetric routing, BGP session to a real peer) requires a real network stack (e.g. Colima k3s in a VM with real interfaces).
- We want **one pipeline**: k3d for everything (preflight, MetalLB install, verification with socat, all suites), with an **optional** step that runs **only** real L2/BGP verification on Colima k3s, without moving the rest of the workload to Colima.

## Decision

1. **k3d remains the only cluster used for preflight and suites** unless the user explicitly sets `REQUIRE_COLIMA=1`. MetalLB install (3c1), FRR BGP (3c1a), and MetalLB verification (3c1b) all run on **k3d**. LB IP reachability on k3d is achieved via **socat + loopback alias**; HTTP/1.1, HTTP/2, and HTTP/3 via LB IP are verified on k3d.

2. **Real L2/BGP verification is optional and isolated to Colima k3s.** When `METALLB_VERIFY_COLIMA_L2=1`:
   - Preflight **discovers** Colima’s context (from `~/.colima/default/kubernetes/kubeconfig` or profile-based path; merge into `KUBECONFIG` if not already present).
   - In **step 3c1c only**, preflight **switches** to Colima’s context, runs **verify-metallb-colima-l2-only.sh** (real L2/BGP on Colima k3s), then **restores** kubeconfig and context to k3d. No other step runs on Colima.

3. **Colima context discovery** does not require Colima to be the current context. Preflight merges Colima’s kubeconfig file and uses either a context whose name matches `colima|colima-default`, or the current-context from that file, or the first context in that file, so step 3c1c works even when the active context is k3d and Colima’s context name is e.g. `default`.

4. **verify-metallb-colima-l2-only.sh** may be invoked by preflight after a context switch; when `METALLB_VERIFY_COLIMA_FULL=1` it does not require the context name to contain "colima", so it runs correctly when preflight has switched to Colima’s context (whatever its name).

5. **Documentation**: README.md and ENGINEERING.md state that k3d is primary; Colima is used only for optional MetalLB L2 verification (step 3c1c); Runbook and docs reference this ADR and the cluster topology section.

## Justification

| Concern | k3d | Colima k3s |
|--------|-----|------------|
| **Preflight + suites** | Stable; 2-node spreads load; deterministic networking. | Single control plane; can be overwhelmed by heavy apply + suites. |
| **MetalLB install / LB IP** | Works; socat gives host reachability to LB IP; all protocols (H1/H2/H3) verified. | Real L2; LB IP natively reachable from host. |
| **L2/ARP/BGP** | Simulated (socat forwards to NodePort). | Real L2: ARP, asymmetric routing, BGP to FRR meaningful. |

So: **default path is k3d for everything**; **optional Colima-only step** for real L2/BGP keeps the pipeline simple and avoids running heavy preflight on Colima.

## Consequences

- Users run `REQUIRE_COLIMA=0 METALLB_ENABLED=1` for full preflight and suites on k3d with MetalLB and LB IP (via socat). Adding `METALLB_VERIFY_COLIMA_L2=1` runs step 3c1c on Colima and then restores k3d; no need to run preflight twice or manually switch context.
- Colima must be running (`colima start --with-kubernetes`) for 3c1c to succeed when `METALLB_VERIFY_COLIMA_L2=1`; if Colima is stopped or kubeconfig is missing, preflight warns and continues (3c1/3c1a/3c1b already passed on k3d).
- Clear separation: **k3d = system under test and primary path; Colima = optional real L2/BGP verification only.**

## References

- **ADR 009** — k3d as default local cluster; REQUIRE_COLIMA=0.
- **ADR 008** — Multi-node required; MetalLB valid infra.
- **README.md** — Cluster architecture (k3d + Colima).
- **ENGINEERING.md** — Cluster topology and MetalLB usage.
- **scripts/run-preflight-scale-and-all-suites.sh** — Step 3c1c and _get_colima_context_for_metallb.
- **scripts/verify-metallb-colima-l2-only.sh** — Real L2/BGP on Colima.
