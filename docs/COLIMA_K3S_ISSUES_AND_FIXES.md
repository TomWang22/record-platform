# Colima k3s: Root Issues, Fixes Applied, and Hardening

**Purpose:** One place that states **what was broken**, **what we did to fix it**, and **how we hardened** so the system does not struggle as badly. Use this after addressing issues to confirm everything is covered and to decide when to move to multi-node.

---

## 1. Root issues (what was broken)

| Issue | Cause | Symptom |
|-------|--------|---------|
| **API 503 / ServiceUnavailable** | Single-node API/etcd overloaded by burst of requests (e.g. `kubectl apply` of large manifest does many GETs at once). | MetalLB install fails; preflight fails; connection refused or 503 from API. |
| **51820 crash loop** | k3s internal API (127.0.0.1:51820) not ready at startup → k3s exits → systemd restarts → repeat. | Cluster never becomes ready; API never stabilizes after Colima start. |
| **Tunnel flaky (host kubectl fails, in-VM works)** | SSH tunnel to 6443 or API behind it drops or is slow. | `kubectl get nodes` fails on host; `colima ssh -- kubectl get nodes` works. |
| **MetalLB apply fails repeatedly** | Large single apply triggers many concurrent API calls → 503. | install-metallb.sh or one-shot apply fails even with retries. |
| **Single node can’t keep up** | One etcd, one API server; limited write QPS and in-flight limits. | Even with retries, applies or controllers overwhelm the API. |

**Root cause in one line:** Single-node k3s has limited API/etcd capacity and a startup race (51820); we must tune internals, respect QPS, and optionally move to 2–3 nodes when that is not enough.

---

## 2. Fixes applied (what we did)

### 2.1 Control plane stability

- **Full teardown + locked profile:** Delete VM, start with **12 CPU, 16 GiB RAM, 256 GiB disk** so the node has headroom. Script: `./scripts/colima-fix-control-plane-for-good.sh` (uses `colima-teardown-and-start.sh`).
- **180s undisturbed boot:** Do not touch the API for 180s after Colima start (`POST_START_SLEEP=180`) so 51820 can come up and k3s can finish bootstrap.
- **etcd/k3s tuning:** Apply in-flight limits and etcd quota via drop-in under `/etc/rancher/k3s/config.yaml.d/`. Script: `./scripts/apply-k3s-etcd-tuning.sh`.
  - **CONSERVATIVE=1:** `max-mutating-requests-inflight=100`, `max-requests-inflight=800` — queues writes, reduces 503 under burst.
  - **AGGRESSIVE=1 (default in fix-for-good):** `max-mutating-requests-inflight=300`, `max-requests-inflight=1200` — more throughput so single node doesn’t struggle as badly; still use chunked apply for large manifests.
- **Fix-for-good default:** Uses **AGGRESSIVE** tuning by default (`K3S_TUNE=aggressive`). If 503 persists, re-apply with `K3S_TUNE=conservative` or `CONSERVATIVE=1 ./scripts/apply-k3s-etcd-tuning.sh`.

### 2.2 MetalLB install (respect QPS)

- **Chunked install (doc-by-doc):** Split MetalLB manifest by `---`, apply one document at a time with delay (`APPLY_DELAY=3–5`) and retries per doc. Script: `./scripts/install-metallb-chunked.sh`. Copies manifest into VM when `USE_IN_VM=1` so in-VM kubectl can read files.
- **When-stable install:** Wait for several consecutive successful API checks, then run install. Script: `./scripts/install-metallb-when-stable.sh`.
- **Direct install:** When API is already calm: `./scripts/install-metallb.sh` (has retries).

### 2.3 MetalLB traffic policy and scale

- **Pool and L2 in repo:** `infra/k8s/metallb/ipaddresspool.yaml` and `l2advertisement.yaml` for versioned, reviewable config.
- **Priority evaluation:** Documented in **`docs/METALLB_TRAFFIC_POLICY_AND_SCALE.md`** — nodeSelector for L2 when multi-node; priority = which nodes announce.
- **Byte-level encoding and hashcode at scale:** **`docs/WIRE_FORMAT_AND_SCALING.md`** (encoding, comments) and **`docs/METALLB_TRAFFIC_POLICY_AND_SCALE.md`** (traffic policy + hash-based routing/sharding for performance).

### 2.4 Multi-node path (when single node is not enough)

- **When to consider 2–3 nodes:** After aggressive tuning and QPS-friendly apply, if API still 503s or you need HA. See **`docs/K3S_MULTI_NODE_AND_SCALING.md`**.
- **Path:** k3s multi-server (2–3 VMs/machines), same MetalLB pool/L2, optional nodeSelector for priority; keep one wire format and one hash strategy (see wire-format doc).

---

## 3. Hardening checklist (so it doesn’t struggle as badly)

Use this to confirm everything is in place after addressing issues.

### 3.1 Control plane

- [ ] Colima profile is **12 CPU, 16 GiB RAM, 256 GiB disk** (teardown script and fix-for-good enforce this).
- [ ] **180s** undisturbed boot after start (`POST_START_SLEEP=180` in teardown/start).
- [ ] **etcd/k3s tuning** applied: `AGGRESSIVE=1 ./scripts/apply-k3s-etcd-tuning.sh` (or CONSERVATIVE=1 if 503 persists).
- [ ] Tunnel re-established after tuning: `./scripts/colima-forward-6443.sh`; use `USE_IN_VM=1` for kubectl if host tunnel is flaky.
- [ ] Diagnose when API is down: `./scripts/colima-diagnose-when-api-down.sh`; full fix: `./scripts/colima-fix-control-plane-for-good.sh`.

### 3.2 MetalLB

- [ ] Install **only when API is stable** (or use chunked with delay).
- [ ] Use **chunked install** when API is flaky: `./scripts/install-metallb-chunked.sh` with `APPLY_DELAY=4` or `5`; `USE_IN_VM=1` if host API fails.
- [ ] Pool and L2 from repo when possible: `kubectl apply -f infra/k8s/metallb/` (after MetalLB controller is installed).
- [ ] Traffic policy and priority (multi-node): see **`docs/METALLB_TRAFFIC_POLICY_AND_SCALE.md`**.

### 3.3 Applies and workloads

- [ ] **Rate-limit large applies:** Prefer chunked or phased apply with delay; avoid one huge `kubectl apply -f big.yaml` on a single node.
- [ ] **Preflight after API is ready:** `./scripts/run-preflight-k6-only-when-api-ready.sh` or ensure-k8s-api before heavy steps.
- [ ] **Byte-level encoding and hashcode** documented and commented in code when you add new protocols or scale; see **`docs/WIRE_FORMAT_AND_SCALING.md`** and **`docs/METALLB_TRAFFIC_POLICY_AND_SCALE.md`**.

### 3.4 When single node is still not enough

- [ ] Re-applied **CONSERVATIVE** tuning and still 503 under load → consider **2–3 node** cluster per **`docs/K3S_MULTI_NODE_AND_SCALING.md`**.
- [ ] Document multi-node topology and any L2 nodeSelector in runbook or ops doc.

---

## 4. Quick reference

| Goal | Action |
|------|--------|
| Understand what was broken | §1 Root issues |
| See what we did to fix it | §2 Fixes applied |
| Harden so it doesn’t struggle as badly | §3 Hardening checklist |
| Tune etcd more aggressively (single node) | `AGGRESSIVE=1 ./scripts/apply-k3s-etcd-tuning.sh` |
| Stricter queueing (fewer 503, slower throughput) | `CONSERVATIVE=1 ./scripts/apply-k3s-etcd-tuning.sh` |
| Fix control plane from scratch | `./scripts/colima-fix-control-plane-for-good.sh` (uses AGGRESSIVE by default) |
| MetalLB with QPS respect | `./scripts/install-metallb-chunked.sh` with `APPLY_DELAY=4` or `5` |
| MetalLB traffic policy / priority / scale | **`docs/METALLB_TRAFFIC_POLICY_AND_SCALE.md`** |
| Wire format and hashcode at scale | **`docs/WIRE_FORMAT_AND_SCALING.md`** |
| Move to 2–3 nodes | **`docs/K3S_MULTI_NODE_AND_SCALING.md`** |

**Single doc for AI handoff (decisions, non-negotiable order, k3d default, MetalLB valid):** **`docs/PLATFORM_CLUSTER_AND_METALLB_AI_HANDOFF.md`**. ADR: `docs/adr/008-multi-node-required-metallb-valid.md`.

**Related:** `docs/COLIMA_K3S_STABILITY_AND_METALLB.md`, Runbook.md §52, `docs/COLIMA_K3S_CRASH_LOOP_51820.md`, `docs/K3S_MULTI_NODE_AND_SCALING.md`.
