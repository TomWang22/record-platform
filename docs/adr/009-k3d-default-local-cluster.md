# ADR 009: k3d as Default Local Development Cluster

**Status:** Accepted

## Context

The platform previously assumed **Colima + k3s** as the only supported local cluster for preflight, test suites, and validation. Colima provides a Linux VM with k3s and works well for VM realism and host networking tests, but:

- Colima requires a tunnel (e.g. 127.0.0.1:6443) for host→API access; tunnel flakiness caused connection resets and reissue failures.
- MetalLB LoadBalancer IPs on Colima are host-reachable (VM network), but on **k3d** the LB IP lives in the Docker network and is often not reachable from the host, forcing port-forward for Caddy strict TLS verification.
- CI and “same-host” validation benefit from a lighter, non-VM option: **k3d** (Kubernetes in Docker) with 2 nodes and MetalLB.

We needed a single pipeline that supports both Colima and k3d without switching code paths by hand, and without requiring port-forward for strict TLS when the host cannot reach the LoadBalancer.

## Decision

1. **k3d is the default local cluster** for preflight and test suites when running on a single host (see ADR 008: 2-node minimum). Colima remains supported when `REQUIRE_COLIMA=1` (default for backward compatibility can stay 1; repos may set default to 0 for k3d-first).

2. **`REQUIRE_COLIMA=0`** means “do not require Colima”: keep current kube context (e.g. k3d), do not switch to Colima, and use k3d-friendly verification (in-cluster Caddy check). Preflight and `run-all-test-suites.sh` respect this and allow k3d context.

3. **Caddy strict TLS verification** no longer depends on host reachability or port-forward when on k3d:
   - **In-cluster verify** (`verify-caddy-strict-tls-in-cluster.sh`): a one-off Pod curls `https://caddy-h3.ingress-nginx.svc.cluster.local:443/_caddy/healthz` with `dev-root-ca`; used when context is k3d or `REQUIRE_COLIMA=0`.
   - Host-based verify (with optional port-forward) remains for Colima when MetalLB is not used or when in-cluster is not chosen.

4. **Guardrails**:
   - Kind/h3 clusters remain unsupported (exit with clear message).
   - When `REQUIRE_COLIMA=1`, non-Colima context causes exit (e.g. “Use Colima or run with REQUIRE_COLIMA=0 for k3d”).
   - When `REQUIRE_COLIMA=0`, any context except kind/h3 is allowed (k3d, colima, etc.).

5. **Documentation and scripts**: Handoff doc, ENGINEERING.md, and script headers describe k3d path, in-cluster verify, and `REQUIRE_COLIMA=0`. MetalLB and custom traffic policy are verified by a dedicated script where applicable.

## Consequences

- Preflight and suites run on k3d without Colima and without Caddy port-forward.
- Colima is still supported; no removal of Colima-specific logic, only conditional use and clear guardrails.
- New contributors and CI can standardize on k3d (2-node + MetalLB) and run `REQUIRE_COLIMA=0 ./scripts/run-preflight-scale-and-all-suites.sh`.
- ADR 008 (multi-node, MetalLB valid) unchanged; this ADR adds the default local cluster choice and verification method.
