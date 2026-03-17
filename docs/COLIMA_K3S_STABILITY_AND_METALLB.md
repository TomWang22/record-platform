# Colima k3s Stability and MetalLB — Clear Path to Stable Control Plane and LoadBalancer

**Goal:** Get Colima/k3s stable, install and configure MetalLB correctly, and know when to consider multi-node or scaling. Single source of truth for "how do I fix this?" and "how do I get MetalLB working?"

---

## 1. Why the control plane is unstable (single-node limits)

### 1.1 What happens

- **k3s** runs one API server and one etcd on a single node (the Colima VM).
- During startup, k3s registers CRDs by calling an **internal** API on `127.0.0.1:51820`. If that listener is not ready yet (startup race), k3s exits with "connection refused" → systemd restarts it → **51820 crash loop**.
- Even after a successful boot, a **burst of API writes** (e.g. many `kubectl apply`, reissue secrets, MetalLB CRDs) can overload the API → 503 ServiceUnavailable or connection refused.
- So: **single node = single point of failure** and **limited write throughput**. Stability depends on: (1) giving k3s time to boot, (2) rate-limiting applies, (3) optional etcd/k3s tuning.

### 1.2 What we do to get stable (single-node)

| Step | What | Script / Env |
|------|------|--------------|
| 1 | Full teardown (delete VM) so no bad etcd/51820 state | `colima delete -f` |
| 2 | Start with **12 CPU / 16 GiB RAM / 256 GiB** disk | `colima start --with-kubernetes --vm-type vz --cpu 12 --memory 16 --disk 256` |
| 3 | **Do not touch the API for 180s** after start (undisturbed boot) | `POST_START_SLEEP=180` in `colima-teardown-and-start.sh` |
| 4 | Establish tunnel 127.0.0.1:6443 and wait for API (e.g. 240s) | `colima-forward-6443.sh` + wait loop |
| 5 | Apply etcd/k3s tuning (AGGRESSIVE by default in fix-for-good) to reduce 503 and improve throughput | `apply-k3s-etcd-tuning.sh` (AGGRESSIVE=1 or CONSERVATIVE=1); see `docs/COLIMA_K3S_ISSUES_AND_FIXES.md` |
| 6 | Re-deploy workloads only when API is stable | `kubectl apply -k infra/k8s/base --validate=ignore --request-timeout=180s` |

**One-shot script that does 1–5:**  
`./scripts/colima-fix-control-plane-for-good.sh`

**Diagnose when API is down (no host kubectl):**  
`./scripts/colima-diagnose-when-api-down.sh`

**Cross-layer check (when API is up):**  
`./scripts/colima-k3s-cross-layer-diagnostic.sh`

### 1.3 Respecting API QPS: etcd limits and making it work

The API server and etcd have **in-flight request limits** (see `apply-k3s-etcd-tuning.sh`). We **must respect these** or we get 503; we also **have to make applies succeed**. Options:

| Approach | What | When |
|----------|------|------|
| **Tune etcd/k3s** | **AGGRESSIVE=1** (default in fix-for-good): `max-mutating-requests-inflight=300`, `max-requests-inflight=1200` so single node doesn’t struggle as badly. **CONSERVATIVE=1**: 100/800 for stricter queueing. See `docs/COLIMA_K3S_ISSUES_AND_FIXES.md`. | After teardown+start; before heavy applies. |
| **Rate-limit applies** | MetalLB chunked script applies **one YAML document at a time** with `APPLY_DELAY=3` (or 4–5)s between docs so we don’t burst the API. | Use `./scripts/install-metallb-chunked.sh` with `APPLY_DELAY=4` if 503 persists. |
| **In-VM kubectl** | When the host tunnel is flaky, use `USE_IN_VM=1` so `kubectl` runs inside the Colima VM (script copies manifest into VM first). | Host gets connection refused but VM API works. |
| **Multi-node / HA** | If single-node API still can’t keep up (e.g. many controllers, frequent applies), add more control-plane nodes or move to a multi-master setup so etcd/API have more capacity. | When tuning + QPS-friendly apply still aren’t enough. |

So: **tune etcd, respect QPS with doc-by-doc delay, use in-VM if tunnel is bad; if it’s still not enough, plan for multi-node.**

---

## 2. How to get MetalLB installed and configured correctly

### 2.1 When to install

Install MetalLB **only when the API is stable**: `kubectl get nodes` (and e.g. `kubectl get ns default`) succeed for at least 1–2 minutes. If you install during 503 or connection refused, the apply will fail or leave partial state.

### 2.2 Options (in order of preference)

1. **Wait for stable window, then install (recommended)**  
   - Run: `./scripts/install-metallb-when-stable.sh`  
   - It waits for a "stable API" (several consecutive successful checks), then runs the MetalLB installer with retries.

2. **Chunked install (flaky API)**  
   - Run: `./scripts/install-metallb-chunked.sh`  
   - Applies MetalLB in phases (namespace → CRDs → controller/speaker/webhook → pool + L2) with retries per phase. Makes progress even if the API drops between phases.

3. **Direct install (when you know API is calm)**  
   - Run: `./scripts/install-metallb.sh`  
   - Uses 8×15s retries for the main manifest. Set `METALLB_POOL` to override the L2 pool (e.g. `192.168.106.240-192.168.106.250` or your subnet).

4. **As part of stabilize + diagnostic**  
   - Run: `SKIP_TUNE=1 ./scripts/colima-stabilize-metallb-and-diagnose.sh`  
   - Re-establishes tunnel, installs MetalLB, runs cross-layer diagnostic. Use `SKIP_TUNE=1` if you already applied tuning.

### 2.3 Configuration (pool and L2)

- **Pool:** IP range MetalLB can assign to LoadBalancer services. Default in scripts: `192.168.106.240-192.168.106.250`. Override with `METALLB_POOL=192.168.5.240-192.168.5.250` (must be in your Colima/VM network).
- **L2:** We use L2 advertisement (no BGP). One `IPAddressPool` and one `L2Advertisement` pointing at that pool. See `install-metallb.sh` or `infra/k8s/metallb/` if you add custom YAML.

### 2.4 Verify MetalLB is working

```bash
kubectl -n metallb-system get pods          # controller 1/1, speaker (DaemonSet) running
kubectl get ipaddresspool -n metallb-system
kubectl get l2advertisement -n metallb-system
kubectl get svc -A | grep LoadBalancer      # EXTERNAL-IP should get an IP from the pool
```

---

## 3. When to consider multiple nodes or scaling

### 3.1 Single-node limits (Colima k3s today)

- **One control plane:** One API server, one etcd. No HA; if k3s crashes or the VM restarts, the cluster is down until it recovers.
- **Write throughput:** etcd and API have limited write QPS. Burst applies (e.g. many secrets, CRDs, deployments) cause 503 or refusal.
- **51820 race:** Internal k3s bootstrap can fail on first start; we mitigate with 180s undisturbed boot and full teardown when needed, but the race is inherent to single-node k3s startup.

### 3.2 When multi-node or scaling is needed

- **High availability:** Need API/etcd to stay up when one node fails → multi-control-plane (e.g. 3 master nodes).
- **More write capacity:** Many concurrent applies or many controllers → more API/etcd capacity or rate-limiting and batching.
- **Horizontal scaling of workloads:** More app replicas or nodes to run them → add worker nodes; MetalLB and L2 work across nodes.

### 3.3 Byte-level encoding and future scaling (for implementation)

For **multi-server or scaling**, you will need clear **byte-level encoding** and **protocol contracts** so that:

- **Services** (API gateway, auth, listings, etc.) agree on request/response formats (e.g. protobuf, JSON with a fixed schema).
- **Wire format** is documented (field order, lengths, delimiters) so that different languages or versions can interoperate without ambiguity.
- **Comments in code/specs** should describe: (1) which bytes represent what (e.g. "bytes 0–3: length in big-endian"), (2) versioning (e.g. "v1 payload"), (3) backward compatibility rules.

We already use **gRPC/protobuf** for several services; the `.proto` files are the schema. For any new binary or custom encoding:

- Prefer **existing standards** (protobuf, MessagePack, or JSON with a single schema) and document the chosen encoding in `ENGINEERING.md` or **`docs/WIRE_FORMAT_AND_SCALING.md`** (byte layout, versioning, where to add comments).
- Add **extensive comments** in the encoding/decoding paths (e.g. "// Byte 0: version; bytes 1–4: payload length BE; bytes 5..: payload").
- When you add multi-node or a second cluster, the same encoding and comments make it clear how traffic and data are split or replicated.

A short **scaling checklist** for the future:

1. **Control plane:** Move to a multi-master k3s (or another distro) if you need HA.
2. **Data plane:** Add worker nodes; keep MetalLB L2 or add BGP if you have a router that supports it.
3. **Encoding:** Document byte-level or schema-level format for any custom protocol; add comments at encode/decode sites.
4. **Observability:** Metrics and tracing (e.g. Prometheus, Otel) so you can see which node or pod is slow or failing when you scale.

---

## 4. Quick reference

| I want to… | Do this |
|------------|--------|
| See what’s wrong when API is down | `./scripts/colima-diagnose-when-api-down.sh` |
| Fix control plane from scratch (teardown + 180s boot + tune) | `./scripts/colima-fix-control-plane-for-good.sh` |
| Wait for stable API then install MetalLB | `./scripts/install-metallb-when-stable.sh` |
| Install MetalLB in phases (flaky API) | `./scripts/install-metallb-chunked.sh` |
| Install MetalLB when API is already calm | `./scripts/install-metallb.sh` |
| Stabilize + MetalLB + cross-layer diagnostic | `SKIP_TUNE=1 ./scripts/colima-stabilize-metallb-and-diagnose.sh` |
| Run full cross-layer diagnostic | `./scripts/colima-k3s-cross-layer-diagnostic.sh` |

**Root issues, fixes, and hardening:** See **`docs/COLIMA_K3S_ISSUES_AND_FIXES.md`** — what was broken, what we did, hardening checklist, when to go multi-node.

**Runbook:** See Runbook.md item **52** (Control plane derailing) and **Colima API** section for tunnel vs native port.

**51820 crash loop:** See `docs/COLIMA_K3S_CRASH_LOOP_51820.md`.

**Multi-node (2–3 nodes):** See `docs/K3S_MULTI_NODE_AND_SCALING.md`.

**MetalLB traffic policy and scale:** See `docs/METALLB_TRAFFIC_POLICY_AND_SCALE.md`.

**Stabilization plan (rate-limiting, phases):** See `docs/COLIMA_K3S_CONTROL_PLANE_STABILIZATION_PLAN.md`.
