# k3d API server HA and TLS (one-time tuning, restart behavior)

**Scope:** This doc and the TLS SAN fix apply to the **Kubernetes API server** (kubectl ↔ k3d). They do **not** apply to Caddy, record.local, or MetalLB. For ingress you still use **record.local** and the MetalLB LoadBalancer IP; those use different certificates and paths.

## One-time tuning at cluster create

- **Create** the 2-node k3d cluster with **`./scripts/k3d-create-2-node-cluster.sh`** so the following are baked in:
  - **TLS SANs:** `--tls-san=127.0.0.1` and `--tls-san=localhost` so the API server certificate is valid for host access with strict TLS (no x509 errors after restart or when using 127.0.0.1).
  - **etcd:** `--etcd-arg=quota-backend-bytes=8589934592` and `--etcd-arg=max-request-bytes=1572864` for stability under load.

## “API server not ready” after restart

- **Worst case:** Preflight uses `K3D_AUTO_RESTART=1` when `REQUIRE_COLIMA=0`. If the API check fails, the ensure script restarts the k3d cluster once, waits **60s** (`K3D_POST_RESTART_WAIT`), then retries. After that, “API server not ready” from TLS/SNI should not recur for clusters created with the script.
- **3c0b (k3d API stabilize):** During the wait, preflight refreshes kubeconfig every 60s (`k3d kubeconfig merge`) and prints the last `kubectl get nodes` error on failure so you see connection refused, x509, timeout, etc.

## Existing clusters (TCP OK but kubectl fails with x509/TLS)

- Recreate the cluster with **`./scripts/k3d-create-2-node-cluster.sh`** so the API server cert includes 127.0.0.1 and localhost. There is no way to add SANs to an existing k3d API server cert without recreating.

## See also

- **`scripts/ensure-api-server-ready.sh`** – initial block timeout, post-restart wait, diagnostics.
- **`docs/PLATFORM_CLUSTER_AND_METALLB_AI_HANDOFF.md`** – handoff and script reference.
