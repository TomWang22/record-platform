# Colima k3s: analyze every layer

**Purpose:** Single place for **every layer** to analyze when fixing or hardening Colima k3s. Use this when you need to “analyze every layer” or hand off a full picture. Each layer lists what to check, which script/doc to use, and how it feeds into the fix.

**Quick run:** `./scripts/colima-k3s-cross-layer-diagnostic.sh` covers layers 1–9 below; then use this doc for order of operations and deeper checks.

**Root issue:** When you see `ServiceUnavailable` or k3s stuck in **activating/start**, the root cause is **control-plane stability** (51820 crash-loop or startup race). Fix that first (full Colima restart, re-forward 6443); then MetalLB, observability, and the rest.

---

## Layer map (summary)

| # | Layer | What to check | Script / doc |
|---|--------|----------------|-------------|
| 1 | Colima VM | Status, profile, resources (CPU/RAM/disk) | `colima status`, storage diagnostic §1 |
| 2 | API reachability | Host vs in-VM (tunnel vs control plane) | Cross-layer diagnostic §1, `colima-forward-6443.sh` |
| 3 | k3s process | Restart time, service state, logs | `colima ssh -- systemctl status k3s`, forensic doc |
| 4 | API server / etcd | readyz, in-flight (mutating/readOnly), etcd metrics | `/metrics` grep, ETCD_WRITE_BUDGET_PLAN |
| 5 | Node / kubelet | Allocatable, capacity, pressure | `kubectl get nodes`, storage diagnostic §4 |
| 6 | Pods / workloads | record-platform, ingress, metallb, not-ready | Cross-layer §3 |
| 7 | Controllers / reconcilers | Deployments, StatefulSets, DaemonSets, MetalLB | Cross-layer §4–5, write amplification doc |
| 8 | Network / tunnel | 6443 forward, LoadBalancer IPs, DNS | `colima-forward-6443.sh`, MetalLB |
| 9 | Disk / storage | VM root, Colima disk, k3s/etcd size, Docker reclaimable | Storage diagnostic §2–3, reclaim plan |
| 10 | Tuning | apiserver/etcd drop-in applied, CONSERVATIVE=1 | `apply-k3s-etcd-tuning.sh`, COLIMA_K3S_TUNING |
| 11 | Our pipeline | Reissue, preflight, apply order, retries, SSH path | CONTROL_PLANE_RECONCILER_WRITE_AMPLIFICATION |
| 12 | External load / timing | pgbench, k6, telemetry during cert work | WHY_UNHAPPY §7, stabilization plan |
| 13 | Observability (to add) | Splunk, New Relic, Istio — not yet in diagnostic; add when stack is defined | Cross-layer §9 |

---

## 1. Colima VM layer

**What:** Is Colima running? What profile (CPU, memory)? Is the VM healthy?

**Check:**
```bash
colima status
colima status --extended   # or -e (shows cpu, mem, disk)
colima ssh -- uptime
```
**Scripts:** `scripts/colima-k3s-storage-diagnostic.sh` (section 1); **scripts/colima-k3s-resource-dissection.sh** (full CPU/RAM dissection; **12 CPU is the typical max**).

**Feeds into:** If Colima is not running, start with `colima start --with-kubernetes --cpu 12 --memory 12`. If VM is thrashing, increase RAM (CPU max is typically 12).

---

## 2. API reachability layer (host vs in-VM)

**What:** Can we talk to the API from the host (127.0.0.1:6443) and from inside the VM? This separates “tunnel broken” from “control plane down”.

**Check:**
```bash
kubectl get nodes --request-timeout=5s          # host
colima ssh -- kubectl get nodes --request-timeout=5s   # in-VM
colima ssh -- kubectl get --raw /readyz?verbose=1
```
**Script:** `scripts/colima-k3s-cross-layer-diagnostic.sh` (section 1).

**Feeds into:** If in-VM works but host fails → tunnel/6443; run `./scripts/colima-forward-6443.sh` or use in-VM for critical steps (`REISSUE_STEP2_VIA_SSH=1`). If both fail → control plane down; wait or restart k3s (layer 3).

**API flakiness / "which cluster":** See **docs/COLIMA_K3S_API_STABILITY_AND_IDENTITY.md**. Use `./scripts/ensure-k8s-api.sh` before any critical kubectl; it retries and re-establishes the tunnel so scripts don't fail with "API unreachable" after a brief hiccup. The diagnostic (section 1) prints **cluster identity** (context, server, node) so you always know you're talking to the single Colima node.

---

## 3. k3s process layer

**What:** Is k3s running? When did it last start? Any crash loops?

**Check:**
```bash
colima ssh -- systemctl status k3s
colima ssh -- systemctl show k3s --property=ActiveEnterTimestamp
colima ssh -- sudo journalctl -u k3s -n 30 --no-pager
```
**Doc:** `docs/COLIMA_K3S_FORENSIC_AND_TUNING.md` (ground truth checklist).

**Crash loop (51820):** If SubState=auto-restart and logs show `failed to create crd ... 127.0.0.1:51820 ... connection refused`, k3s is crash-looping because the internal API isn’t ready when CRD registration runs. **Fix:** Full Colima restart. See **docs/COLIMA_K3S_CRASH_LOOP_51820.md** and **scripts/colima-k3s-recover-from-crash-loop.sh**.

**Feeds into:** If k3s is failed or restarting, run **scripts/colima-k3s-recover-from-crash-loop.sh** (or `colima stop && colima start --with-kubernetes`), then re-forward 6443. If stable, run stabilize/tuning.

---

## 4. API server / etcd layer (wire-level pressure)

**What:** How many in-flight read vs mutating requests? Is etcd slow? readyz can be OK while mutating is at limit.

**Check:**
```bash
kubectl get --raw /metrics --request-timeout=10s 2>/dev/null | grep -E '^apiserver_current_inflight|^etcd_'
```
**Docs:** `docs/COLIMA_K3S_FORENSIC_AND_TUNING.md`, `docs/ETCD_WRITE_BUDGET_PLAN.md`.

**Feeds into:** If mutating is at or near limit (e.g. 100 with CONSERVATIVE=1), stop new writes; wait or restart k3s. Tuning (layer 10) sets max-mutating-inflight so the server queues instead of collapsing.

---

## 5. Node / kubelet layer

**What:** Node capacity and allocatable; memory/CPU pressure; scheduler can place pods.

**Check:**
```bash
kubectl get nodes -o wide
kubectl get nodes -o custom-columns=NAME:.metadata.name,ALLOCATABLE:.status.allocatable.memory,CAPACITY:.status.capacity.memory
kubectl describe node  # when API is up
```
**Script:** `scripts/colima-k3s-storage-diagnostic.sh` (section 4), cross-layer (section 2).

**Feeds into:** If allocatable is low or node NotReady, increase VM resources or fix kubelet; avoid heavy load during control-plane work.

---

## 6. Pods / workloads layer

**What:** record-platform pods, ingress, MetalLB pods; any not Ready; key namespaces.

**Check:**
```bash
kubectl get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded
kubectl get pods -n record-platform
kubectl get pods -n ingress-nginx
kubectl get pods -n metallb-system  # if installed
```
**Script:** `scripts/colima-k3s-cross-layer-diagnostic.sh` (section 3).

**Feeds into:** Not-ready pods may indicate image pull, resource limits, or control-plane slowness. Fix after API is stable.

---

## 7. Controllers / reconcilers layer (write amplification)

**What:** Deployments, StatefulSets, DaemonSets (desired vs ready); MetalLB pool/L2; who is writing to the API.

**Check:**
```bash
kubectl get deploy -A  # desired vs ready
kubectl get sts -A
kubectl get ds -A
kubectl get ipaddresspool,l2advertisement -n metallb-system  # if MetalLB
```
**Script:** `scripts/colima-k3s-cross-layer-diagnostic.sh` (sections 4–5).  
**Doc:** `docs/CONTROL_PLANE_RECONCILER_WRITE_AMPLIFICATION.md`.

**Feeds into:** Multiple reconcilers (k3s core, MetalLB, ingress, our applies) all write to etcd. Do not run cert reissue + MetalLB apply + big applies in one burst. Order: stabilize → MetalLB (separate run) → certs.

---

## 8. Network / tunnel layer

**What:** Is 6443 forwarded to host? LoadBalancer services have EXTERNAL-IP? DNS/service mesh OK?

**Check:**
```bash
# Re-establish tunnel
./scripts/colima-forward-6443.sh
kubectl get svc -A -o wide | grep -E 'LoadBalancer|NAME'
```
**Script:** `scripts/colima-forward-6443.sh`. MetalLB: cross-layer §5, `infra/k8s/metallb/`.

**Feeds into:** If host kubectl fails after in-VM works, re-forward or use in-VM for reissue/preflight. Install MetalLB only when API is stable (`./scripts/stabilize-then-metallb.sh --metallb`).

---

## 9. Disk / storage layer

**What:** VM root and Colima disk usage; k3s/etcd dir size; Docker reclaimable (build cache, containers, images).

**Check:**
```bash
./scripts/colima-k3s-storage-diagnostic.sh
docker system df
./scripts/colima-k3s-reclaim-safe.sh --dry-run
```
**Docs:** `docs/COLIMA_K3S_RECLAIM_AND_STABILIZE_PLAN.md`, `scripts/colima-k3s-reclaim-safe.sh`.

**Feeds into:** If root or Colima disk is near full, etcd can stall. Safe reclaim: builder prune, container prune, image prune -f. Do not remove k3s data or Postgres volumes.

---

## 10. Tuning layer

**What:** Is apiserver/etcd tuning applied? (max-mutating-inflight, quota-backend-bytes, etc.) CONSERVATIVE=1.

**Check:**
```bash
colima ssh -- cat /etc/rancher/k3s/config.yaml.d/50-control-plane-stabilization.yaml 2>/dev/null || true
```
**Script:** `CONSERVATIVE=1 ./scripts/apply-k3s-etcd-tuning.sh`.  
**Doc:** `docs/COLIMA_K3S_TUNING.md`.

**Feeds into:** Without tuning, default limits are low → 503 under burst. Stabilize script re-applies tuning in VM after k3s restart.

---

## 11. Our pipeline layer

**What:** Reissue health gate and abort; preflight apply order; retries (avoid 12× retry storm); use in-VM for cert step when tunnel is flaky.

**Check:** Script logic and env: `REISSUE_PHASE1_ABORT=1`, `REISSUE_STEP2_VIA_SSH=1`, phase order (sanity → certs → load).  
**Doc:** `docs/CONTROL_PLANE_RECONCILER_WRITE_AMPLIFICATION.md`.

**Feeds into:** Do not add our write burst on top of MetalLB or heavy applies. Use abort on first write failure; prefer in-VM for step 2 when 6443 is flaky.

---

## 12. External load / timing layer

**What:** pgbench, k6, or telemetry running during cert rotation or big applies? Too many watchers?

**Doc:** `docs/COLIMA_K3S_WHY_UNHAPPY_CHECKLIST.md` (section 7), `docs/COLIMA_K3S_CONTROL_PLANE_STABILIZATION_PLAN.md`.

**Feeds into:** Run data-plane load only after control-plane sanity and cert rotation (or abort). Phase: control-plane → certs → then load.

---

## 13. Observability (to add / verify)

**What:** Splunk, New Relic, Istio — called out as **missing or to verify**; not yet fully in the cross-layer diagnostic.

**Check:** When defined, add namespace/pod checks (e.g. `istio-system`, Splunk/New Relic namespaces). Cross-layer diagnostic section 9 lists these and does a light grep for istio/splunk/newrelic/observability namespaces.

**Feeds into:** Add to diagnostic and runbooks once the observability stack is decided. Root issue remains k3s/API stability; observability depends on a stable API.

---

## Order of operations (fix flow)

1. **Analyze:** Run `./scripts/colima-k3s-cross-layer-diagnostic.sh`; run `./scripts/colima-k3s-storage-diagnostic.sh`. Use this doc to interpret each layer.
2. **Reclaim (if disk pressure):** `./scripts/colima-k3s-reclaim-safe.sh --execute`. See `docs/COLIMA_K3S_RECLAIM_AND_STABILIZE_PLAN.md`.
3. **Stabilize:** `./scripts/stabilize-then-metallb.sh` (restart k3s, wait, re-apply tuning in VM, re-forward 6443).
4. **MetalLB (separate run):** When host kubectl is stable, `./scripts/stabilize-then-metallb.sh --metallb` or `./scripts/install-metallb.sh`.
5. **Preflight / certs:** Use `REISSUE_STEP2_VIA_SSH=1` if tunnel is flaky; do not run heavy load in same run as cert reissue.

---

## References (one line each)

| Doc / script | Purpose |
|--------------|---------|
| **docs/COLIMA_K3S_WHY_UNHAPPY_CHECKLIST.md** | “Why is it unhappy?” flow and quick reference. |
| **docs/CONTROL_PLANE_RECONCILER_WRITE_AMPLIFICATION.md** | Write amplification; order: stabilize → MetalLB → certs. |
| **docs/COLIMA_K3S_RECLAIM_AND_STABILIZE_PLAN.md** | What to reclaim, safe vs not, stabilize steps. |
| **docs/COLIMA_K3S_FORENSIC_AND_TUNING.md** | Wire-level read/write pressure, tuning checklist. |
| **docs/ETCD_WRITE_BUDGET_PLAN.md** | Health gate, abort, Phase 3 tuning. |
| **docs/COLIMA_K3S_TUNING.md** | Tuning values and how to apply. |
| **scripts/colima-k3s-cross-layer-diagnostic.sh** | Layers 1–6 (and 7–8 partial); run first. |
| **scripts/colima-k3s-storage-diagnostic.sh** | VM disk, k3s size, Docker reclaimable, node allocatable. |
| **scripts/colima-k3s-reclaim-safe.sh** | Safe reclaim (builder, containers, dangling images). |
| **scripts/stabilize-then-metallb.sh** | Stabilize API then optional MetalLB. |
| **scripts/colima-forward-6443.sh** | Re-forward API port to host. |
| **scripts/apply-k3s-etcd-tuning.sh** | Apply apiserver + etcd tuning (CONSERVATIVE=1). |
| **docs/COLIMA_K3S_CRASH_LOOP_51820.md** | k3s crash loop (51820 refused). |
| **scripts/colima-k3s-recover-from-crash-loop.sh** | Full Colima stop/start + wait + re-forward 6443. |

---

**Bottom line:** To fix Colima k3s, **analyze every layer** (this doc), **reclaim** if disk is tight, **stabilize** (restart k3s + tuning + 6443), then **MetalLB** and **certs** in separate runs with throttled pipeline and phased load.
