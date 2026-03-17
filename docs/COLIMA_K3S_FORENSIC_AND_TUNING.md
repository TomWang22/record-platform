# Colima k3s: forensic breakdown and tuning plan

**Goal:** Understand *why* Colima k3s is unhappy at the wire level, see exactly how much **read** and **write** pressure we put on it, tune thoroughly, and plan single-node vs 2-node vs prod-tier throughput.

**Status:** Living doc. Use with **docs/ETCD_WRITE_BUDGET_PLAN.md** (canonical fix) and **docs/CONTROL_PLANE_TELEMETRY.md** (how to capture pressure).

---

## 1. Why Colima k3s is “unhappy” (wire-level)

What we see in logs (ServiceUnavailable, “failed to download openapi”, connection reset, readyz OK then apply fails) all come from the same place: **the control plane has a limited write burst budget**. It is not “broken” — it is **honest** about that limit.

### 1.1 What actually happens on the wire

| Step | Who | What | Effect |
|------|-----|------|--------|
| 1 | Client (kubectl) | TLS to 127.0.0.1:6443 | TCP + TLS OK |
| 2 | kubectl apply | **GET** secret (to retrieve current config for 3-way merge) | One **read** request to apiserver → etcd read |
| 3 | Apiserver | If busy or etcd slow → **queue or reject** | 503 ServiceUnavailable or timeout |
| 4 | kubectl apply | On apply: **PUT/PATCH** secret | One **write** → etcd write + admission + watchers |
| 5 | etcd | Persist + compact; watchers notified | More CPU/disk; if overloaded → slow or RST |

So a single `kubectl apply -f -` is **at least one read (GET) + one write**. Under load, the **GET** can already return 503 (“error when retrieving current configuration”) — we never get to the write. Retrying 12 times means 12 GETs + 12 attempted writes **while the API is already overloaded**, so we make it worse.

### 1.2 Why “up 18 days” and “we rebuilt” both matter

- **Node “up 18 days”** = Linux kernel / kubelet uptime. It does **not** mean:
  - k3s apiserver hasn’t been restarted
  - etcd is “fresh” or empty
  - No previous failed runs left the control plane degraded
- **“We rebuilt”** = New Colima VM or `colima start` from scratch. That gives a **clean** etcd and apiserver; “up 18 days” on the same node after many failed preflights can mean the control plane is still recovering from earlier write bursts.

**Storage and disk:** Run **scripts/colima-k3s-storage-diagnostic.sh** to see VM disk usage (root, Colima data disk, k3s/etcd size), Docker reclaimable space, and node allocatable. If root or the Colima data mount is near full, etcd can stall; free space or increase the Colima disk (see Colima docs; disk size can only be increased, not reduced). For a concrete reclaim plan (what is safe to remove, order of operations, stabilize steps), see **docs/COLIMA_K3S_RECLAIM_AND_STABILIZE_PLAN.md** and **scripts/colima-k3s-reclaim-safe.sh**.

**Ground truth checklist** (run when debugging “why is it unhappy”):

```bash
# Colima and VM
colima status
colima ssh -- uptime

# k3s process (restart time)
colima ssh -- systemctl show k3s --property=ActiveEnterTimestamp

# Node and API
kubectl get nodes -o wide
kubectl get --raw /readyz?verbose=1
kubectl get --raw /metrics --request-timeout=10s 2>/dev/null | grep -E '^apiserver_current_inflight|^etcd_'
```

If **readyz** is OK but **apiserver_current_inflight** is at or near `max-mutating-requests-inflight`, the next **write** can be rejected or delayed → 503 or RST. So “happy” readiness ≠ “has capacity for another write”.

### 1.3 Summary: one sentence

**Colima k3s is “unhappy” when we exceed its etcd write burst budget and then keep retrying.** Fix: gate writes on health, do not retry writes when the API is already failing, and tune so the queue is small (so we back-pressure instead of thrashing).

---

## 2. Read vs write pressure: what we put on it

### 2.1 What we measure

| Metric | Meaning | Where |
|--------|--------|--------|
| **apiserver_current_inflight_requests{request_kind="readOnly"}** | In-flight **read** requests (GET, LIST, watch) | /metrics |
| **apiserver_current_inflight_requests{request_kind="mutating"}** | In-flight **write** requests (CREATE, PATCH, DELETE) | /metrics |
| **etcd_request_duration_seconds** | etcd latency by operation | /metrics |
| **readyz / healthz** | Liveness/readiness (aggregate) | /readyz, /healthz |

When **mutating** is at the limit (e.g. 400 or 100), **new writes are queued or rejected**. When etcd is slow, apiserver holds connections → more inflight → more risk of RST or 503.

### 2.2 What our pipeline does (read vs write)

| Phase | Primarily read | Primarily write |
|-------|----------------|-----------------|
| Preflight: trim pods, kubeconfig, Phase 1A | ✅ get nodes, list pods, get ns | delete completed pods |
| Reissue step 1 | — | — (local openssl; no API) |
| Reissue step 2 | GET secret (before each apply) | **apply secret** (per namespace) |
| Telemetry loop | **GET /metrics**, GET /readyz | — |
| Scale / apply manifests | LIST + GET | **apply** many resources |
| Test suites | HTTP GET to services | Some POST/PATCH |

So **reissue step 2** is the heaviest **write** burst: multiple GET+apply in sequence (or retries). Telemetry and readyz are **read** pressure; they can compete with the GET part of apply if the API is near capacity.

### 2.3 How to capture “pressure” in one shot

**Quick pressure snapshot** (run when cluster is reachable):

```bash
kubectl get --raw /metrics --request-timeout=10s 2>/dev/null | grep -E '^apiserver_current_inflight_requests|^etcd_request_duration_seconds_count'
```

Or use the full telemetry script:

```bash
./scripts/capture-control-plane-telemetry.sh --once
```

**During preflight** (see pressure over time):

```bash
./scripts/run-preflight-with-telemetry.sh
# Then inspect: telemetry-during-<timestamp>.log
grep -E '^=== |^apiserver_current_inflight' telemetry-during-*.log
```

Interpretation:

- **mutating** stays low (1–2) and **readOnly** moderate (10–30) → API has headroom.
- **mutating** at or near limit, or many **(metrics unavailable)** → API overloaded or recovering; avoid more writes.

---

## 3. Tuning thoroughly: what to do and in what order

### 3.1 Already in place

- **Apply path** for secrets (no delete+create): `scripts/reissue-ca-and-leaf-load-all-services.sh` — apply with `--validate=false`, type Opaque.
- **Telemetry**: `scripts/capture-control-plane-telemetry.sh`, `scripts/run-preflight-with-telemetry.sh`, `docs/CONTROL_PLANE_TELEMETRY.md`.
- **k3s/etcd tuning script**: `scripts/apply-k3s-etcd-tuning.sh` — drop-in for apiserver + etcd (see below).

### 3.2 Tuning checklist (do in order)

1. **Establish ground truth** (once per “why is it unhappy” session):
   - `colima status`; `colima ssh -- systemctl show k3s --property=ActiveEnterTimestamp`; `kubectl get nodes`; `kubectl get --raw /readyz`.
   - Optional: take a pressure snapshot (in-flight + etcd) when API is “idle”.

2. **Apply k3s/etcd tuning** (once per Colima profile):
   - **Standard (more headroom):**  
     `./scripts/apply-k3s-etcd-tuning.sh`  
     Uses: max-requests-inflight=800, max-mutating-requests-inflight=400.
   - **Conservative (Phase 3, single-node write budget):**  
     `CONSERVATIVE=1 ./scripts/apply-k3s-etcd-tuning.sh`  
     Uses: max-mutating-requests-inflight=100 (or 150). Fewer concurrent writes → queue instead of thrash. See **docs/ETCD_WRITE_BUDGET_PLAN.md** Phase 3.

3. **Health gate + abort (Phase 1)** in reissue script (when implemented):
   - Before first apply: 3× readyz, 2s apart; if any fail → abort (no apply).
   - One namespace at a time; gate after each; **abort on first write failure** (no 12 retries).
   - Minimum 5s between mutating calls (e.g. REISSUE_STEP2_SLEEP=5).

4. **Re-run preflight with telemetry** to prove behavior:
   - After tuning and (when done) Phase 1: `./scripts/run-preflight-with-telemetry.sh`.
   - Inspect `telemetry-during-*.log`: mutating should stay low; if we abort, we should see clear “Cert rotation aborted” and no retry storm.

### 3.3 Current vs conservative tuning (single-node)

| Setting | Current (script default) | Conservative (Phase 3) | Rationale |
|---------|--------------------------|------------------------|-----------|
| max-requests-inflight | 800 | 800 | Read headroom |
| max-mutating-requests-inflight | 400 | **100** (or 150) | Single-node: queue writes, avoid burst thrash |
| etcd quota / snapshot | 8 GiB / 50k | same | No change |

**When to use conservative:** When you want to stay strictly within the etcd write budget and prefer “slow and complete or abort” over “burst and risk collapse”. Use **CONSERVATIVE=1** when applying tuning.

---

## 4. Plan: single-node vs 2-node vs prod-tier throughput

### 4.1 Single-node (current)

- **Reality:** One apiserver, one etcd, shared CPU/memory/disk. Write burst budget is limited.
- **Goal:** Preflight either **completes** (cert rotation, then suites) or **aborts early** with a clear message; cluster stays usable.
- **Measures:** Health gate, no retry storm, conservative mutating limit (100–150), telemetry to see read/write pressure.

### 4.2 Two-node (proposed)

- **Idea:** Add a second node for workload only; control plane still single (k3s server on one node). Or move to a 2-node HA control plane (different topology).
- **Benefit:** Isolate workload from control plane a bit; no change to etcd write budget unless we actually run two apiserver/etcd instances (HA).
- **When:** After single-node is stable (preflight proves pipeline, cert rotation completes or aborts cleanly). Plan in a separate doc (e.g. MULTI_NODE or INFRA_PLAN).

### 4.3 Prod-tier throughput

- **Meaning:** Run at production-like request volume (e.g. k6, pgbench, many services). This stresses **both** control plane (more watches, more churn) and data plane.
- **Rule:** Do **not** run prod-tier load in the same run as cert reissue. Phase order: control-plane sanity → cert rotation (or abort) → then data-plane load (Phase C in stabilization plan). See **docs/COLIMA_K3S_CONTROL_PLANE_STABILIZATION_PLAN.md**.

### 4.4 Summary table

| Mode | Control plane | Write budget | When to use |
|------|----------------|-------------|-------------|
| Single-node (current) | One apiserver/etcd | Limited; tune + gate + abort | Daily preflight, dev, prove pipeline |
| Single-node conservative | Same; mutating=100 | Stricter queue | When 400 still leads to collapse |
| 2-node (proposed) | Same or HA | Same or larger | After single-node is boring; separate plan |
| Prod-tier load | Same single-node | No cert work during load | Phase C only; certs stable first |

---

## 5. References

- **docs/COLIMA_K3S_WHY_UNHAPPY_CHECKLIST.md** — Single checklist: everything that can make Colima k3s unhappy (write burst, disk, memory, network, tuning, load).
- **docs/ETCD_WRITE_BUDGET_PLAN.md** — One-sentence truth, Phase 1–4, health gate, abort, Phase 3 tuning.
- **docs/CONTROL_PLANE_TELEMETRY.md** — What we capture, /metrics, scripts.
- **docs/COLIMA_K3S_TUNING.md** — Applied values, Option A (script) / Option B (Colima config).
- **docs/COLIMA_K3S_CONTROL_PLANE_STABILIZATION_PLAN.md** — Phases A–E, rate limiting, MetalLB policy.
- **docs/RCA-PREFLIGHT-CONTROL-PLANE-FAILURES.md** — Symptoms, evidence, mitigations.
- **scripts/apply-k3s-etcd-tuning.sh** — Apply tuning (standard or CONSERVATIVE=1).
- **scripts/reissue-ca-and-leaf-load-all-services.sh** — Where health gate and abort-on-failure will go (Phase 1).
- **scripts/run-preflight-with-telemetry.sh** — Preflight + pressure log.
- **Runbook.md** item 32 — API 503 / reset-by-peer; CONNECTION-RESET-PLAYBOOK.
