# Colima k3s Control Plane Stabilization Plan

**Goal**: Eliminate flakiness caused by control-plane overload, cert reissue deadlocks, and burst write amplification. Produce a deterministic, rate-limited, and phase-gated preflight pipeline that never bricks the cluster and always fails loudly with cause.

---

## 0. Ground Rules (Non-Negotiable)

1. **Control plane is rate-limited infrastructure**
   * Treat API server like a DB with strict write QPS
   * No overlapping phases that write to the API

2. **One kubeconfig decision per run**
   * Endpoint (6443 vs native port) selected once
   * Never mutated mid-pipeline

3. **Cert work is serialized**
   * CA rotation, leaf issuance, secret patching never concurrent with load or Service churn

4. **MetalLB is opt-in, not default**
   * Disabled for core preflight and data-plane testing

---

## 1. Hardware Budget

* **Host**: 12 CPU / 16 GiB RAM / 256 GiB disk
* **Colima VM target**:
  * CPUs: 8
  * Memory: 10–12 GiB
  * Disk: ≥80 GiB

Rationale: leave host headroom, avoid VM memory pressure → etcd stalls.

---

## 2. Colima / k3s Baseline Configuration

### 2.1 Colima

* CPU: 8
* Memory: 10–12 GiB
* Disk: ≥80 GiB
* Runtime: docker

No auto-start hooks. No shell aliases that start Docker/Kind/Colima implicitly.

### 2.2 k3s API & etcd tuning

Apply via k3s config or args:

* `--kube-apiserver-arg=max-requests-inflight=800`
* `--kube-apiserver-arg=max-mutating-requests-inflight=400`
* `--kube-apiserver-arg=default-watch-cache-size=200`
* etcd:
  * `--quota-backend-bytes=8589934592` (8 GiB)
  * `--max-request-bytes=1572864`
  * `--snapshot-count=50000`

**Do not tune beyond this** — Colima is still single-node.

---

## 3. Preflight Pipeline (Phase-Gated)

### Phase A — Control Plane Sanity (Default)

**Purpose**: validate API stability, cert validity, basic rollout

* Disable MetalLB
* Disable HPA
* No pgbench

Steps:

1. Select API endpoint (6443 if reachable, else native)
2. Freeze kubeconfig
3. Apply namespaces + CRDs (serialized)
4. Apply base manifests
5. Wait for rollouts

**Hard abort conditions**: Any `kubectl apply` >10s; any 503 / connection reset.

---

### Phase B — Cert Issuance & Rotation

**Purpose**: guarantee cert path correctness

Rules: Single-threaded; no Services created; no load.

Steps:

1. Rotate CA (if enabled)
2. Issue leaf certs
3. Patch secrets
4. Restart workloads
5. Verify mTLS handshakes

Abort on first failure. Never retry blindly.

---

### Phase C — Data Plane Load (Isolated)

**Purpose**: test DB + app, zero control-plane churn

Rules: No `kubectl apply`; no scaling; no Service changes.

Steps:

1. Start pgbench (controlled ramp)
2. Run k6 phases
3. Collect metrics

If API errors appear here → infrastructure regression.

---

### Phase D — Network / LB (Explicit)

**Purpose**: validate MetalLB without load

Rules: pgbench stopped; no cert work.

Steps:

1. Enable MetalLB
2. Create Services
3. Verify allocations
4. Observe API latency

Any instability here is MetalLB-amplified control-plane load.

---

### Phase E — Chaos / Full Stack (Optional)

Allowed to fail. Never default.

---

## 4. Rate Limiting & Serialization Rules

* All `kubectl apply` → serialized
* Sleep 2–3s between namespace / CRD / Service creation
* Never overlap: pgbench ramp, cert issuance, Service creation, HPA scaling
* Add explicit mutex in shell (lockfile) when running phases that write to API

---

## 5. API Overload Detection (Fail Fast)

* If `kubectl apply` >10s → abort phase
* If 2× 503 / RST → abort run
* If etcd latency >100ms sustained → abort

Print **why**, not just exit code.

---

## 6. Cert-Specific Guardrails

* Never regenerate certs implicitly
* Cert scripts must be idempotent
* Secrets patched once per run
* Cert verification before any load

---

## 7. MetalLB Policy

* Disabled by default
* Enabled only in Phase D/E
* No Service churn during load

MetalLB is treated as a stressor, not baseline infra.

---

## 8. Documentation Artifacts

1. **ADR**: Control Plane Is Rate-Limited — `docs/adr/005-control-plane-is-rate-limited.md`
2. **Runbook**: API 503 / reset-by-peer — Runbook.md item 32 + CONNECTION-RESET-PLAYBOOK
3. **Preflight README**: Phase model — `docs/PREFLIGHT_PHASES_README.md`
4. **Cert Lifecycle Doc**: CA → leaf → secret — `docs/CERT_LIFECYCLE.md`
5. **k3s/etcd Tuning**: Apply safe API/etcd limits — `scripts/apply-k3s-etcd-tuning.sh` and `docs/COLIMA_K3S_TUNING.md`
6. **Preflight Failure Report**: Explain what failed and why — `scripts/generate-preflight-failure-report.sh` (pipe a preflight log to get a structured report)

---

## 9. Success Criteria

* Phase A–D deterministic
* No kubeconfig mutation mid-run
* Cert path never blocks pipeline
* MetalLB instability isolated
* Full run fails loudly, never bricks cluster

---

**If these constraints are respected, Colima will be boring again — which is the goal.**
