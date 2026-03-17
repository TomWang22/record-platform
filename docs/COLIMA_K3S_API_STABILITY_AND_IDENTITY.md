# Colima k3s: API stability and cluster identity

## One cluster, one node

There is **one** Colima VM and **one** Kubernetes cluster. The single node is always named **`colima`** (the VM hostname). If you see:

- `kubectl get nodes` → `colima   Ready   control-plane,master   ...`

that is the only node. There is no "old" vs "new" node to confuse: after a full Colima restart or `colima delete` + start, you still have one node named `colima`. The only thing that changes is the **API server port inside the VM** (e.g. 53075, 59560); the tunnel script keeps host `127.0.0.1:6443` → guest `127.0.0.1:<port>`.

**Which one am I talking to?**

- **Context:** `kubectl config current-context` → should be `colima`.
- **Server:** `kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}'` → should be `https://127.0.0.1:6443` when using the host tunnel.
- **Node:** `kubectl get nodes -o wide` → one row, name `colima`.

The cross-layer diagnostic (`./scripts/colima-k3s-cross-layer-diagnostic.sh`) prints this "cluster identity" in section 1 so you always know which cluster you're hitting.

## API flakiness: causes and fix

**Symptoms:** `kubectl get nodes` works once, then immediately after the same shell (or another script) gets "API unreachable" or "ServiceUnavailable". Or the apply script says "API unreachable" right after a manual `kubectl get nodes` succeeded.

**Causes:**

1. **Stale tunnel** – k3s restarts and gets a new random port (e.g. 53075 → 59560). The host still has an SSH tunnel to the old port, so `nc -z 127.0.0.1 6443` succeeds but the API behind it is wrong or closed.
2. **Brief 503** – Control plane is still starting or under load; one request succeeds, the next times out or returns ServiceUnavailable.
3. **Single quick check** – Scripts that do one `kubectl get nodes --request-timeout=10s` and exit on failure can fail during a brief hiccup.

**Fix once and for all: automated recovery**

- **`./scripts/ensure-k8s-api.sh`**  
  - Retries `kubectl get nodes` (default: 12 attempts, 15s timeout, 8s sleep).  
  - On first failure, kills any existing tunnel and re-runs `./scripts/colima-forward-6443.sh` so the tunnel targets the **current** k3s port from the VM’s `k3s.yaml`.  
  - When it succeeds, prints cluster identity (context, server, node).  
  - Use it before any critical kubectl (apply, install-metallb, etc.).

- **Scripts that use it**  
  - `apply-caddy-h3-ingress.sh`  
  - `install-metallb.sh`  
  - `install-prometheus-operator-crds.sh`  
  - `bring-up-stack-when-api-ready.sh`  
  All call `ensure-k8s-api.sh` so API/tunnel issues are handled automatically instead of failing once and exiting.

**Optional env for ensure-k8s-api.sh**

- `REQUEST_TIMEOUT=20` – seconds per kubectl try  
- `MAX_RETRIES=15` – number of attempts  
- `SLEEP_BETWEEN=10` – seconds between attempts  

## Strict TLS / mTLS and cert chain

We do **not** comment out or relax TLS/mTLS or cert-chain behaviour. Cert chain and strict TLS matter for production and mTLS. The only things that were ever commented out were **observability** ServiceMonitor/PodMonitor manifests because they require Prometheus Operator CRDs; those are now re-enabled and CRDs are installed by `./scripts/install-prometheus-operator-crds.sh` (and by `bring-up-stack-when-api-ready.sh`). No TLS or cert-related config is commented out for "convenience".

## Order of operations for a clean bring-up

1. Start Colima (with Kubernetes, VZ, 12 CPU, 16 GiB RAM, 256 GiB disk as desired).  
2. Run **`./scripts/ensure-k8s-api.sh`** (or let the scripts below run it).  
3. Run **`./scripts/bring-up-stack-when-api-ready.sh`** – it installs CRDs, MetalLB, applies base (including observability with ServiceMonitor/PodMonitor), applies Caddy-h3, and verifies.  
4. For deeper checks: **`./scripts/colima-k3s-cross-layer-diagnostic.sh`** – section 1 shows cluster identity and host vs in-VM API.

If the API is still unstable after tunnel fixes, the root cause is usually k3s control-plane stability (e.g. 51820 crash-loop). See `docs/COLIMA_K3S_CRASH_LOOP_51820.md` and consider a full Colima restart or a new profile.
