# Cert lifecycle on single-node k3s: plan and execution order

**Purpose:** Plan to fix control-plane overload during cert reissue and get MetalLB working. One-sentence diagnosis: **The system is correct, but cert reissue currently exceeds the write budget of a single-node k3s control plane; the fix is to reduce write amplification, not add retries or more tuning.**

**Authoritative plan (etcd write budget):** **docs/ETCD_WRITE_BUDGET_PLAN.md** — Success criteria, root cause (etcd write amplification), three pillars (cert handling / write budget / MetalLB decouple), four-phase game plan, and explicit “do not change CA/leaf rotation.” Use that doc for execution order and Cursor-ready steps.

**Status:** Planning  
**Date:** 2026-02-08

---

## 1. The six steps (what to do)

### Step 1 — Stop delete + create (biggest win)

**Current behaviour:** Reissue step 2 does:
```text
kubectl delete secret X
kubectl create secret X …
```
That is **two writes + watch churn** per secret.

**Change:** Use a **single write** per secret:
```text
kubectl apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: record-local-tls
  namespace: record-platform
type: kubernetes.io/tls
data:
  tls.crt: <base64>
  tls.key: <base64>
EOF
```

**Why it matters:** One write, no delete storm, fewer watches, much easier on etcd. This alone often fixes most of this class of failure.

**Where:** `scripts/reissue-ca-and-leaf-load-all-services.sh` — replace the loop that does `delete` + `create` (+ optional `patch` for type) with building secret YAML (base64 data) and `kubectl apply -f -`. Same for `record-local-tls`, `dev-root-ca`, and `service-tls` in each namespace.

---

### Step 2 — Collapse cert updates into one namespace at a time

**Current behaviour:** Update record-platform, then ingress-nginx, then envoy-test, then service-tls, with sleeps but no “fully settle” between namespaces.

**Change:**
- Update **only record-platform** (all secrets there).
- **Wait for API to fully settle** (see Step 3).
- Then **ingress-nginx** (record-local-tls, dev-root-ca).
- Settle again.
- Then **envoy-test** (sync script) and **service-tls** if needed.
- Never do multi-namespace cert churn back-to-back.

**Where:** Same script; reorder and add settle-between-namespace steps.

---

### Step 3 — Hard API idle wait (state-based, not sleep)

**Current behaviour:** Time-based waits (e.g. REISSUE_SETTLE_CAP=240, poll get ns every 10s).

**Change:** After each secret apply (or after each namespace in Step 2):
- `kubectl get --raw='/readyz?verbose'`
- `kubectl get --raw='/healthz'`
- Require **3 consecutive successes** spaced 2–3s apart.
- If not healthy → **abort**, don’t pile more writes onto a sick apiserver.

**Where:** New helper in reissue script (or shared lib); call after each apply or after each namespace batch. Option: `REISSUE_ABORT_ON_UNHEALTHY=1` (default) to enforce.

---

### Step 4 — Lower apiserver write concurrency (single-node)

**Current behaviour:** Tuning uses `max-mutating-requests-inflight=400` (and higher read in-flight).

**Change:** For single-node Colima k3s, set **explicitly lower** write concurrency, e.g.:
- `max-mutating-requests-inflight=100` or `200` (not 400).
- Goal: **queue, don’t thrash**. High values help big clusters; they hurt single-node.

**Where:** `scripts/apply-k3s-etcd-tuning.sh` and drop-in `50-control-plane-stabilization.yaml` in VM. Document in `docs/COLIMA_K3S_TUNING.md` that single-node may use 100–200; make value configurable (e.g. env or separate drop-in for “single-node conservative”).

---

### Step 5 — Make cert reissue mutually exclusive with everything else

**Rule (enforced in code):** During reissue (step 2 + settle + step 5 Caddy), **only**:
- secret apply
- readiness/health checks

**No:** scaling, pod restarts, MetalLB apply, pgbench, k6, or other heavy writes.

**Where:**
- **Preflight:** Already uses Phase 1B lock (flock/mkdir) so only one writer at a time. Tighten so that when reissue is running, preflight does not run scaling, restarts, or MetalLB in parallel (they’re already serialized by the same lock; we just need to ensure reissue is the only write phase during its window, or that we never start scale/restart/MetalLB until reissue has finished and passed health checks).
- **Explicit guard:** At start of reissue step 2, optionally check that no other “write” jobs are in progress (e.g. no concurrent preflight scale phase). If we detect contention, refuse to reissue and tell user to run reissue alone or run preflight with lock.
- **Documentation:** Runbook / this doc: “Run full reissue on demand in strict mode; do not run scaling, MetalLB, or load tests during reissue.”

---

### Step 6 — Accept one truth: full reissue every preflight is not realistic

**Reality:** Full cert reissue on every preflight run is not realistic on single-node k3s without exceeding the write budget.

**Change:**
- **Full reissue:** On demand, or in a dedicated “strict reissue” mode (no other writes).
- **Normal preflight:** Prefer **verify validity** of existing certs (and that CA/leaf match) instead of regenerating every time. If valid, skip reissue.
- **Cache certs** for normal runs; regenerate only when expired or when explicitly requested (e.g. `REISSUE_FORCE=1` or a dedicated `pnpm run reissue`).

**Where:** Preflight script: before calling reissue, check cert validity (and optionally CA/leaf consistency); if valid and not forced, skip reissue and log “Certs valid, skipping reissue.” Reissue script remains the single place that does full CA+leaf generation and load.

---

## 2. Order of work (realistic sequence)

| Phase | What | Blocks | Outcome |
|-------|------|--------|---------|
| **A** | **Step 1** — Reissue: apply instead of delete+create | — | Single write per secret; largest reduction in write amplification. |
| **B** | **Step 3** — Add health-gated wait (readyz/healthz, 3× success) after apply/namespace | Step 1 (so we have fewer writes to gate) | No piling writes onto a sick API. |
| **C** | **Step 2** — One namespace at a time + settle between | Step 1, 3 | Further reduces burst; clear sequencing. |
| **D** | **Step 4** — Lower max-mutating-requests-inflight to 100–200 for single-node | — | Can do in parallel with A–C; document and apply. |
| **E** | **Step 5** — Enforce reissue-only window (no scale/restart/MetalLB during reissue) | Current lock already serializes; clarify and document | Cert reissue is “boring” and isolated. |
| **F** | **Step 6** — Verify-before-reissue; skip reissue when certs valid | Step 1–3 in place | Normal preflight rarely does full reissue. |
| **G** | **MetalLB** — Install and validate as isolated phase, after cert churn is fixed | A–F | MetalLB works once API is stable; never combine MetalLB install with cert work. |

**Recommended implementation order:** A → B → C (then D in parallel if desired), then E (docs + guards), then F, then G.

---

## 3. What this means for MetalLB (ADR and traffic policy)

- **ADR-003** (MetalLB investigation and integration) remains valid.
- **Order of operations:**
  1. **Stabilize secret churn** (Steps 1–3).
  2. **Stabilize API server** under write-only stress (Steps 4–5, plus existing tuning).
  3. **Then** introduce MetalLB as an **isolated phase** (Phase D or dedicated run).
- **Never** combine MetalLB install / pool apply with cert reissue. Run MetalLB when API is idle (e.g. after a good preflight without MetalLB, or in a separate “MetalLB only” run).
- **Traffic policy:** Caddy `type: LoadBalancer` with **sessionAffinity: ClientIP** (1h) is our policy. Prove MetalLB works by: controller + webhook ready, pool + L2 applied, Caddy gets EXTERNAL-IP, and curl to that IP with TLS works. See **preflight-failure-report-*.md** “MetalLB and traffic policy” section and **METALLB_AND_API_503_REPORT.md**.

---

## 4. Where in the codebase

| Step | Script / file | Change |
|------|----------------|--------|
| 1 | `scripts/reissue-ca-and-leaf-load-all-services.sh` | Replace delete+create with kubectl apply -f - (YAML with base64 data). |
| 2 | Same | Loop per namespace; after each namespace call settle (Step 3). |
| 3 | Same + optional `scripts/lib/api-health.sh` | Function: poll readyz/healthz 3× at 2–3s; abort if any fail. |
| 4 | `scripts/apply-k3s-etcd-tuning.sh`, `docs/COLIMA_K3S_TUNING.md` | Set max-mutating-requests-inflight=100 or 200; document single-node. |
| 5 | `scripts/run-preflight-scale-and-all-suites.sh`, Runbook, this doc | Ensure reissue runs alone under lock; document “no scale/restart/MetalLB during reissue”. |
| 6 | `scripts/run-preflight-scale-and-all-suites.sh` | Before 3a: if certs valid (and not REISSUE_FORCE=1), skip reissue. |
| MetalLB | `scripts/install-metallb.sh`, `apply-metallb-pool-and-caddy-service.sh`, preflight 3c1/3c2 | Keep MetalLB opt-in; run only when API is stable; document in ADR and METALLB_AND_API_503_REPORT. |

---

## 5. One-sentence diagnosis (for you + Cursor)

**The system is correct, but cert reissue currently exceeds the write budget of a single-node k3s control plane; the fix is to reduce write amplification, not add retries or more tuning.**

---

## 6. References

- **docs/RCA-PREFLIGHT-CONTROL-PLANE-FAILURES.md** — RCA, symptoms, what still breaks, forensic.
- **docs/PREFLIGHT_PHASED_PLAN_20260207.md** — Phases 0–5, lock, rate limit.
- **docs/adr/003-metallb-investigation-and-integration.md** — MetalLB L2, Caddy LoadBalancer, traffic flow.
- **METALLB_AND_API_503_REPORT.md** — Why 503, webhook, scripts, fix options.
- **docs/COLIMA_K3S_TUNING.md** — Current tuning values; will add single-node conservative option.
- **preflight-failure-report-*.md** — Generated report with forensic, dig-further, MetalLB verification (for AI).
