# Control-plane overload: write amplification across reconcilers

**One sentence:** Control-plane overload is caused by **write amplification** from **multiple independent reconcilers** (controllers) all hitting the API/etcd at once. Removing accidental throttles (sleeps, rate limits, or backoff) allows those reconcilers to run full-tilt → combined write burst exceeds the single-node budget → 503, resets, cascade failure.

**Cross-layer view:** The same etcd/apiserver handles writes from (1) our scripts (reissue, apply), (2) k3s built-in controllers (deployment, endpoint, service, etc.), (3) MetalLB (pool/L2/Service allocation), (4) ingress/Caddy reconciliation, (5) any operator or CRD controller. They are **independent**: each reacts to watch events and writes back. No single “throttle” coordinates them. So when we **remove** throttles (e.g. shorten sleeps in reissue, or run MetalLB apply in the same run as cert rotation), we add our write burst on top of theirs → amplification.

---

## 1. What “reconcilers” mean here

| Layer | Who writes | What they write | When they fire |
|-------|------------|------------------|----------------|
| **Our pipeline** | reissue script, preflight apply | Secrets, ConfigMaps, Deployments, Services | On preflight run; retries if we don’t abort |
| **k3s core** | deployment, replicaset, endpoint, service controllers | Status, endpoints, conditions | On every resource change they watch |
| **MetalLB** | controller (pool/L2), speaker | IP allocation, L2 advertisements | On Service type=LoadBalancer, pool/L2 apply |
| **Ingress/nginx** | ingress controller | Ingress status, sometimes config | On Ingress/Service changes |
| **Others** | metrics-server, local-path-provisioner, etc. | Status, PVCs | On schedule or resource change |

Each of these does **GET (watch or list) + write**. Writes go to etcd. On a single node, **all share the same apiserver and same etcd**. So total write rate = sum of all controllers’ write rates.

---

## 2. How “removing accidental throttles” makes it worse

- **Accidental throttles** = anything that was unintentionally limiting write rate: long sleeps between applies, retry backoff, or even “API was slow so we did fewer operations per minute.”
- When we **remove** them (faster reissue, more parallel applies, or “run MetalLB in the same run as certs”), we:
  1. Increase **our** write rate.
  2. Trigger **more** watch events (e.g. new Service → MetalLB reconciles, endpoint controller updates, etc.).
  3. So **other** reconcilers also write more (status updates, allocations).
- **Net effect:** Write amplification. One “logical” action (e.g. apply Caddy LoadBalancer) becomes many etcd writes (admission, webhooks, status, endpoints, MetalLB allocation). Multiple such actions in one run multiply the effect.

---

## 3. Why this matches what we see

- **503 / “server is currently unable to handle the request”** — apiserver or etcd is at capacity; new requests (including GETs for 3-way merge) are rejected.
- **Connection reset by peer** — server closes the connection when it can’t keep up or when the queue is full.
- **readyz OK then apply fails** — readiness is an aggregate; it doesn’t mean “I have capacity for one more write.” In-flight mutating requests can be at the limit.
- **First GET (retrieve current config) fails** — we never get to the write; the read path is already overloaded or the server is rejecting new work.

So the **symptoms** are consistent with: too many concurrent or near-concurrent writes from multiple sources (reconcilers + our pipeline), with no single throttle coordinating them.

---

## 4. What to do (order of operations)

**Principle:** Reduce simultaneous write sources and re-introduce **explicit** throttling; never rely on “accidental” throttles.

| Step | What | Why |
|------|------|-----|
| 1 | **Stabilize API** | Restart k3s, wait 60–90s, re-forward 6443. Get to a state where `kubectl get nodes` (in-VM and host) works. |
| 2 | **MetalLB only (no cert churn)** | Install MetalLB, wait for webhook endpoints, apply pool + L2 + Caddy LoadBalancer in a **separate** run from cert reissue. So MetalLB reconcilers are not fighting our secret burst. |
| 3 | **Keep our pipeline throttled** | Health gate + abort on first write failure (Phase 1); min 5s between mutating applies; REISSUE_STEP2_VIA_SSH=1 when tunnel is flaky. |
| 4 | **Apiserver tuning** | CONSERVATIVE=1 (max-mutating=100) so the server **queues** writes instead of accepting until collapse. |
| 5 | **Phase load after control-plane work** | No pgbench/k6 in the same run as cert rotation or MetalLB apply. |

**Do not:** Run cert reissue + MetalLB pool apply + scale + Caddy patch in one burst. That is maximum write amplification.

---

## 5. How to reason across layers

When debugging “why is the API down”:

1. **Who could be writing?** — List controllers/reconcilers that might be active: k3s core, MetalLB, ingress, our scripts, cronjobs. Check `kubectl get pods -A` for controller pods; check recent applies (our logs).
2. **What throttles exist?** — Our script (sleep between applies, abort on failure); apiserver (max-mutating-inflight); no cross-controller throttle.
3. **What changed?** — If we removed sleeps or added MetalLB in the same run, we increased write amplification.
4. **Stabilize first** — Restart k3s to clear in-memory pressure; then do **one** thing (e.g. MetalLB only, or cert only) and verify before adding the next.

---

## 6. Script: stabilize then MetalLB

**scripts/stabilize-then-metallb.sh** — Restart k3s, wait for API (in-VM then host), re-apply CONSERVATIVE tuning, re-forward 6443. Optionally install MetalLB (pool + L2 from **infra/k8s/metallb/**) with `--metallb`. Use when you want to “get it all the way set up right”: stabilize first, then MetalLB, then do the rest (preflight, certs) in separate runs.

```bash
./scripts/stabilize-then-metallb.sh           # stabilize only
./scripts/stabilize-then-metallb.sh --metallb # stabilize then MetalLB
```

---

## 7. References

- **docs/ETCD_WRITE_BUDGET_PLAN.md** — Write budget, pillars, Phase 1–4.
- **docs/COLIMA_K3S_FORENSIC_AND_TUNING.md** — Wire-level read/write pressure.
- **docs/COLIMA_K3S_WHY_UNHAPPY_CHECKLIST.md** — Checklist and “current situation.”
- **docs/METALLB_LATER_PLAN.md** — MetalLB as separate run; not with cert reissue.
