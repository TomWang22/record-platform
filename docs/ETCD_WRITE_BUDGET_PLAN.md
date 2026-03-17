# Single-node k3s: etcd write budget plan

**One sentence:** Single-node k3s collapses when you exceed its **etcd write burst budget**, not its CPU, memory, or TLS budget. Everything we see (resets, apiserver not ready, partial success) follows from that. **This is not:** RP logic, cert crypto, MetalLB per se, or Docker vs Colima. **It is write amplification into etcd.** That amplification is driven by **multiple independent reconcilers** (our pipeline, k3s controllers, MetalLB, ingress) all writing; removing accidental throttles makes it worse. See **docs/CONTROL_PLANE_RECONCILER_WRITE_AMPLIFICATION.md**. Once we accept that, the plan is mechanical.

**We do not change:** How CA and leaf are **rotated** (generated). Openssl, SANs, chain, and the reissue script’s step 1 (generate CA + leaf) stay as they are. We only change **how** we write secrets to the cluster and **when** we stop.

**Status:** Plan (execution order fixed)  
**Date:** 2026-02-08

---

## 1. Success criteria (“fixed” means this)

We are **not** trying to make it “never fail”. We are trying to guarantee:

1. **Cert reissue either completes or aborts early** — no long retry storms.
2. **No retries pile onto a degraded apiserver** — if we see failure, we stop.
3. **Preflight failure never bricks the cluster** — cluster stays usable; apps can still start.
4. **The same failure is reproducible, not random** — deterministic behavior under load.

If those four are true, the system is under control.

---

## 2. Root cause (compressed)

From logs and telemetry:

- **Secret churn** = delete + create + multiple namespaces.
- Each secret write: hits etcd → triggers admission → fans out to watchers.
- **Retries land before etcd recovers** → k3s responds by RST’ing connections.
- The script treats this as “retryable” → collapse accelerates.

This is **textbook overload collapse**, not misconfiguration. We cannot tune it away with flags alone.

---

## 3. Strategy: reduce write amplification + gate writes

Three pillars. **Do not reorder.**

### Pillar A — Cert handling (mandatory; do not touch CA/leaf generation)

**A1. Eliminate delete + create**

- **Permanent rule:**  
  ❌ `kubectl delete secret` + `kubectl create secret`  
  ✅ `kubectl apply -f -` (one etcd write, no delete watch storm, no resurrection race).  
- **Status:** Done in reissue script (apply path with `--validate=false`; type Opaque for existing secrets). Legacy delete+create remains behind `REISSUE_STEP2_USE_APPLY=0` only for fallback.

**A2. One namespace at a time, with health gates**

- **Invariant:** No cert write until apiserver reports healthy **3× in a row**.
- **Concrete gate (before each namespace or after each apply):**
  ```bash
  for i in 1 2 3; do
    kubectl get --raw='/readyz' || exit 1
    sleep 2
  done
  ```
- If this fails → **abort cert rotation entirely**. No retries.

**A3. Cert rotation is transactional**

- Treat it like a DB migration:
  1. Stage cert files (local) — **unchanged** (step 1 generates CA/leaf as today).
  2. Apply secret to **one** namespace.
  3. Wait for apiserver health (3× readyz).
  4. Only then continue to next namespace.
- If step 2 fails → **stop**; do not continue to other namespaces. Print: “Cert rotation aborted to protect control plane.”

---

### Pillar B — Explicit apiserver write budget

**B1. Serialization + rate limiting**

- We already have flock (Phase 1B). Add **minimum delay between mutating kubectl calls** (e.g. 5s). No background kubectl; no parallel namespace operations. Slow is correct.

**B2. Lower inflight limits (single-node)**

- For single-node k3s: **max-mutating-requests-inflight: 100–150** (not 400+). Goal: queue writes instead of thrashing.  
- **Where:** `scripts/apply-k3s-etcd-tuning.sh` and drop-in; document as single-node conservative.

**B3. Detect overload and abort immediately**

- **Hard rule:** If we see **any** of: `apiserver not ready`, `connection reset by peer` on a **write** → stop cert rotation, print explanation, exit. **Retries make collapse worse.**  
- In reissue step 2: **remove** retry loops on write (or cap at 1 retry only after a health gate). Prefer: one attempt per secret; if it fails, run health gate once; if unhealthy or write fails again → abort.

---

### Pillar C — Decouple MetalLB (for now)

- MetalLB ADR is correct, but MetalLB must be a **stress test**, not baseline infra.

**C1. MetalLB never coexists with cert rotation**

- Hard rule: No MetalLB install, no Service type changes, no endpoint churn **during** cert work. Preflight already runs MetalLB only when `METALLB_ENABLED=1` and after reissue; we keep that and document: “Do not set METALLB_ENABLED=1 in the same run as cert reissue.”

**C2. MetalLB phase is read-only at first**

- First MetalLB validation run must be: certs already stable, no scaling, no pgbench — just Service creation + curl. If that fails, MetalLB is postponed, not debugged inline.

---

## 4. Game plan (step-by-step, Cursor-ready)

Execution order. **Do not reorder.**

| Phase | What | Done? | Where |
|-------|------|--------|--------|
| **Phase 1** | Make cert rotation “boring”: apply-only, health gating, **no retries on write** (abort on first write failure after optional single health check), one namespace at a time. | Partial (apply done; health gate and abort-on-failure not yet) | `scripts/reissue-ca-and-leaf-load-all-services.sh` |
| **Phase 2** | Encode failure as first-class: if cert rotation fails, preflight prints “Cert rotation aborted to protect control plane”; cluster stays usable; app can still start. | Partial (preflight exits; message can be clearer) | `scripts/run-preflight-scale-and-all-suites.sh`, reissue script |
| **Phase 3** | Lock apiserver tuning: set conservative inflight (100–150 mutating); verify etcd latency doesn’t spike during cert apply. Do not touch again unless we move off single-node. | No | `scripts/apply-k3s-etcd-tuning.sh`, `docs/COLIMA_K3S_TUNING.md` |
| **Phase 4** | Reintroduce MetalLB as a **separate** experiment: separate script, separate run, separate success criteria. | Doc only | **docs/METALLB_LATER_PLAN.md** (plan to get it out of the way); `METALLB_AND_API_503_REPORT.md`, preflight 3c1/3c2 |

**Phase 1 detail (what’s left):**

1. **Health gate function** in reissue script: `_readyz_3x()` — run `kubectl get --raw=/readyz` 3 times, 2s apart; if any fails, exit 1 with “Apiserver unhealthy; cert rotation aborted.”
2. **Before first secret apply:** run `_readyz_3x`. If it fails, abort (no apply).
3. **One namespace at a time:** apply record-platform secrets (record-local-tls, dev-root-ca); then `_readyz_3x`; if fail, abort. Then ingress-nginx (same); then `_readyz_3x`. Then service-tls (record-platform); then `_readyz_3x`. Envoy sync last, after gate.
4. **Remove or cap retries:** For apply path, **no** 12-attempt retry. One attempt per secret; on failure, run `_readyz_3x` once; if healthy, **one** retry; if that fails or readyz fails → abort and exit 1 with clear message.
5. **Minimum 5s between mutating calls** (configurable; e.g. REISSUE_STEP2_SLEEP=5) between each apply.

**Phase 2 detail:** Preflight already exits when reissue fails. Add explicit message: “Cert rotation aborted to protect control plane. Cluster is still usable. Re-run preflight without reissue (e.g. skip 3a) or fix cluster and retry.”

**Phase 3 detail:** In `apply-k3s-etcd-tuning.sh`, set `max-mutating-requests-inflight=100` (or 150). Document in COLIMA_K3S_TUNING.md that this is the single-node conservative value and should not be raised without moving off single-node.

---

## 5. What we do not change

- **CA/leaf rotation logic:** Step 1 of reissue (openssl, SANs, chain, key generation) is **unchanged**. We do not “mess with” rotation of CA and leaf — only how and when we write the resulting secrets to the cluster.
- **Cert crypto or TLS library choices:** Unchanged.
- **MetalLB design (ADR):** Unchanged; we only decouple its **execution** from cert work.
- **Docker vs Colima:** Unchanged.

---

## 6. One sentence to keep repeating

**Preflight is not broken — it is finally honest about the control plane’s limits.** Our job is not to “make it pass at all costs”, but to **teach it when to stop**. That’s what real infra looks like.

---

## 7. References

- **docs/COLIMA_K3S_FORENSIC_AND_TUNING.md** — Wire-level why k3s is unhappy, read/write pressure, tuning checklist, single-node vs 2-node vs prod plan.
- **docs/CERT_LIFECYCLE_SINGLE_NODE_K3S_PLAN.md** — Earlier six-step plan (apply, namespace order, health, tuning, MetalLB).
- **docs/RCA-PREFLIGHT-CONTROL-PLANE-FAILURES.md** — Symptoms, evidence, mitigations.
- **docs/PREFLIGHT_RUN_PACKAGE_20260207-212034.md** — Run package with pressure and analysis.
- **scripts/reissue-ca-and-leaf-load-all-services.sh** — Where apply, health gate, and abort-on-failure go.
- **scripts/apply-k3s-etcd-tuning.sh** — Where to set max-mutating-requests-inflight=100 (Phase 3).
