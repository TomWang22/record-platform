# k3d vs Colima k3s — When to Use Which

**Context:** We use **Docker CLI** (Colima as the Docker backend), not Docker Desktop. k3d runs clusters *inside* that Docker. Colima can also run **k3s** inside the same VM (real networking, one node). This doc clarifies the two paths and the “worst case” Colima k3s fallback.

---

## 1. k3d with Colima Docker (current default for preflight)

- **k3d** creates a cluster as Docker containers on whatever Docker daemon your `docker` CLI talks to (e.g. Colima’s `unix://$HOME/.colima/default/docker.sock`).
- **Critical:** Use **one Docker daemon consistently**. If `docker` and `k3d` use different sockets or contexts, you can get errors like:
  - `Cannot connect to the Docker daemon at unix:///Users/<you>/.colima/default/docker.sock` (e.g. when a k3d internal step uses a different context).
- **What to do:**
  - Run `docker context show` — you should see `colima` (or whatever your primary is).
  - Run `docker ps` and confirm it works before running k3d.
  - Do **not** mix Docker Desktop and Colima for the same k3d cluster; pick one. We use Colima Docker only.
- **Known k3d v5 issue:** The k3d **serverlb** (load balancer) sometimes fails with missing `/etc/confd/values.yaml` (race at cluster create). If that happens, cluster create can hang or roll back. Workarounds: retry create, or use Colima k3s (below) for real networking.

---

## 2. Colima k3s — “Worst case” / real networking

When k3d is unreliable (e.g. serverlb bug, or you need **real** L2 networking for MetalLB), use **Colima with built-in k3s** instead of k3d. That gives:

- Real VM networking (no Docker port-proxy quirks).
- MetalLB L2/ARP works as intended.
- HTTP/3 and LoadBalancer IPs are reachable without socat on the host (optional socat still useful for `record.local:443` on the host).

### 2.1 Resources and profile (non‑negotiable for stability)

| Resource | Minimum (documented) | Notes |
|----------|----------------------|--------|
| **RAM**  | **16 GiB**           | 12 GiB can work but 16 GiB gives etcd/API headroom. |
| **Disk** | **256 GiB**          | Avoids etcd space alarms; more room for images and data. |
| **CPU**  | 12                   | Colima default; don’t exceed host. |

**One-shot start (teardown + start with correct size):**

```bash
colima delete -f
colima start --with-kubernetes --vm-type vz --cpu 12 --memory 16 --disk 256
```

See **docs/COLIMA_K3S_STABILITY_AND_METALLB.md** and **scripts/colima-fix-control-plane-for-good.sh**.

### 2.2 etcd and API tuning (required after start)

- Colima k3s is **single-node**; default etcd/API limits are low and burst applies can cause 503 or connection resets.
- Apply tuning **once per profile** (or after a fresh teardown+start):

```bash
./scripts/apply-k3s-etcd-tuning.sh
```

- Values and rationale: **docs/COLIMA_K3S_TUNING.md**, **docs/adr/006-colima-k3s-etcd-tuning.md**.

### 2.3 Single-node only — “two node” with Colima

- **Colima k3s = one VM = one node.** There is no built-in “two node” Colima cluster.
- For **multi-node** (2+ control-plane or 2+ workers) you would need either:
  - Multiple Colima profiles (separate VMs) and a multi-server k3s setup across them (not the standard Colima workflow), or
  - A different environment (e.g. bare metal, cloud VMs, or k3d when its serverlb is fixed).
- So: **Colima k3s = single-node, 16 GB RAM, 256 GB disk, plus etcd tuning.** That’s the stable fallback when k3d isn’t an option.

---

## 2.4 Full flow: NodePort first, then MetalLB (run from your terminal)

**NodePort first (HTTP/3 → nodeport → pod):** Use `METALLB_ENABLED=0` so Caddy stays NodePort 30443. Then run restore-http3-setup.sh; HTTP/2 and HTTP/3 (with QUIC-capable curl) work via `record.local:30443` → 127.0.0.1:30443 → Caddy pods. Once that works, add MetalLB and LB IP (step below).

**NodePort + MetalLB LB IP for HTTP/3 (and H2/H1):**

Run this from **your** terminal (so `docker` and `k3d` use Colima’s socket). The IDE may not have access to Colima’s Docker socket.

1. **Ensure Colima is running and Docker talks to it**
   ```bash
   colima status
   docker context show   # should be colima
   docker ps             # should work
   ```
   If `docker ps` still fails, restart Colima in the same terminal and try again:
   ```bash
   colima stop
   colima start
   docker ps
   ```
   If `colima status` is OK but `docker ps` fails (e.g. “Cannot connect to the Docker daemon at unix://…/docker.sock”), you’re in an environment that can’t reach Colima’s socket (e.g. IDE/Cursor terminal). Run all steps in a **local terminal on your machine** where `docker ps` works. The k3d create script will exit with this reminder if Docker is unreachable.

2. **Recreate the cluster (TLS SAN + UDP 30443 + registry)**
   ```bash
   cd /path/to/record-platform
   k3d cluster delete record-platform 2>/dev/null || true
   ./scripts/k3d-create-2-node-cluster.sh
   ```

3. **Wait for nodes, apply base, then restore HTTP/3**
   ```bash
   kubectl get nodes -w   # wait until Ready, then Ctrl+C
   kubectl apply -k infra/k8s/base --request-timeout=180s
   ./scripts/restore-http3-setup.sh
   ```
   Preflight will install MetalLB when you run it with `METALLB_ENABLED=1`. If you want MetalLB and Caddy LoadBalancer **before** preflight, run:
   ```bash
   ./scripts/install-metallb.sh
   kubectl apply -f infra/k8s/caddy-h3-deploy.yaml -f infra/k8s/caddy-h3-service.yaml --request-timeout=30s
   ./scripts/restore-http3-setup.sh
   ```
   `restore-http3-setup.sh` will run `setup-lb-ip-host-access.sh` (prompts for sudo once for LB IP).

4. **Run preflight (no sudo needed for LB IP if you already ran restore)**
   ```bash
   HTTP3_SKIP_DOCKER_BRIDGE=1 SUITE_TIMEOUT=0 METALLB_ENABLED=1 REQUIRE_COLIMA=0 RUN_PGBENCH=0 RUN_SHOPPING_SEQUENCE=1 METALLB_VERIFY_COLIMA_L2=1 ./scripts/run-preflight-scale-and-all-suites.sh
   ```

If cluster create fails with **serverlb** or **confd/values.yaml**, retry once; if it keeps failing, use Colima k3s (section 2).

---

## 3. Quick decision

| Goal                         | Use              | Notes                                      |
|-----------------------------|------------------|--------------------------------------------|
| Preflight + suites on k3d   | k3d (Colima Docker) | One Docker context; retry if serverlb fails. |
| Real L2 / MetalLB / HTTP/3  | Colima k3s       | 16 GB RAM, 256 GB disk, run tuning script. |
| Two-node cluster            | k3d (when stable) or multi-VM | Colima k3s is single-node only.           |

---

## 4. References

- **docs/COLIMA_K3S_STABILITY_AND_METALLB.md** — Colima k3s stability and MetalLB path.
- **docs/COLIMA_K3S_TUNING.md** — etcd/k3s tuning values and options.
- **docs/adr/006-colima-k3s-etcd-tuning.md** — Why we apply tuning.
- **scripts/apply-k3s-etcd-tuning.sh** — Applies tuning in the Colima VM.
- **scripts/colima-fix-control-plane-for-good.sh** — Teardown + start with 12 CPU / 16 GiB RAM / 256 GiB disk + optional tuning.
