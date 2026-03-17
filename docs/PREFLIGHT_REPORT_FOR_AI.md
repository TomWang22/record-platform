# Preflight & Colima k3s — Full Report for AI / Handoff

**Use this document:** Copy or send this entire file to an AI assistant or another engineer. It is self-contained and includes RCA, current situation, what still breaks, MetalLB, ADRs, tuning, and commands.

**Repo context:** record-platform. Colima + k3s (single node). Preflight pipeline: trim → preflight → API ready → reissue CA+leaf → Kafka SSL → applies → scale → Caddy verify → suites.

---

## 1. Executive summary

Preflight and reissue fail or become flaky because **a burst of Kubernetes API writes (reissue step 2: many secret creates/patches) overloads the single-node Colima k3s control plane**. The API or etcd rate-limits or drops connections → "connection reset by peer" and "apiserver not ready". Later steps (Kafka SSL, config/kafka-external/analytics apply, scale, Caddy patch) then fail in cascade because the API is still recovering.

**Root cause:** Single-node API/etcd throughput limit + burst write pattern.  
**What we did:** (1) **Tuned etcd and kube-apiserver** via script (see below). (2) Rate-limited reissue step 2 (sleep between each secret op, longer settle). (3) **Reissue step 2 now uses `kubectl apply`** (single write per secret; set REISSUE_STEP2_USE_APPLY=0 for legacy delete+create). (4) Recovery pass (retry applies and scale once after 30s). (5) **MetalLB opt-in** (off by default; NodePort Caddy). (6) Failure report script to explain log output.  
**What still breaks:** Step 2 can still show resets under load; Kafka SSL, applies, scale, Caddy verify can fail; MetalLB pool apply fails if webhook has no endpoints.  
**Plan (etcd write budget):** **docs/ETCD_WRITE_BUDGET_PLAN.md** — Root cause: etcd write burst budget, not CPU/TLS. Success criteria: cert completes or aborts early; no retries onto degraded apiserver; preflight never bricks cluster; reproducible. Pillars: (A) apply-only, one namespace at a time, health gate 3× readyz, abort on failure; (B) rate limit, max-mutating 100–150, abort on reset; (C) MetalLB decoupled. **CA/leaf rotation (generation) is not changed.** Four-phase game plan (Cursor-ready). *Preflight is not broken — it is finally honest about the control plane’s limits; teach it when to stop.* See also **docs/CERT_LIFECYCLE_SINGLE_NODE_K3S_PLAN.md** for six-step detail.

---

## 2. What we tuned (etcd and kube-apiserver)

We **did** apply k3s/etcd tuning to reduce API stalls:

- **Script:** `./scripts/apply-k3s-etcd-tuning.sh` (run from repo root). Requires Colima running. Writes a drop-in in the Colima VM and restarts k3s; API unavailable ~30–60s.
- **Values applied:**

| Component         | Option                          | Value        |
|------------------|----------------------------------|--------------|
| kube-apiserver   | max-requests-inflight            | 800          |
| kube-apiserver   | max-mutating-requests-inflight   | 400          |
| kube-apiserver   | default-watch-cache-size        | 200          |
| etcd             | quota-backend-bytes              | 8589934592 (8 GiB) |
| etcd             | max-request-bytes               | 1572864      |
| etcd             | snapshot-count                  | 50000        |

- **Where:** Drop-in at `/etc/rancher/k3s/config.yaml.d/50-control-plane-stabilization.yaml` inside the Colima VM. Re-run the script after a new Colima profile or teardown+start.
- **ADR:** docs/adr/006-colima-k3s-etcd-tuning.md.

---

## 3. Current situation

- **Platform:** Colima (default profile), docker + k3s, single node. API at 127.0.0.1:6443 (tunnel) or native port.
- **Tuning:** Applied via the script above. Preflight defaults: METALLB_ENABLED=0 (NodePort Caddy), REISSUE_STEP2_VIA_SSH=0 (host kubectl for step 2), PREFLIGHT_RECOVERY_PASS=1 (recovery pass on).
- **Caddy:** NodePort 443:30443 when MetalLB is off. Preflight may use a short-lived port-forward for strict TLS verify.

---

## 4. Symptoms (what you see in logs)

| Symptom | When | Typical message |
|--------|------|------------------|
| Connection reset by peer | Reissue step 2 | `read tcp 127.0.0.1:xxxxx->127.0.0.1:6443: read: connection reset by peer` |
| Apiserver not ready | During/after step 2 | `error: failed to create secret apiserver not ready` |
| API still not responding | After step 2, before step 5 | `API still not responding after 120s` (or 240s) |
| Reissue failed | Step 5 (Caddy) | `Reissue failed — suites may hit curl 60` |
| Kafka SSL apply failed | Step 3b | `kubectl apply failed (host and colima ssh)` |
| Apply config / kafka-external / analytics failed | Step 3c | `Apply config failed`, etc. |
| Apply caddy-h3-service-nodeport failed | Step 3c2 | `Apply caddy-h3-service-nodeport.yaml failed` |
| Scale failed | Step 4 | `scale auth-service failed`, etc. |
| Caddy strict TLS verify failed | Step 4d | `Caddy strict TLS verification failed after 3 attempts` (curl exit 35) |
| MetalLB pool apply fails | When MetalLB enabled | InternalError / "endpoints not found" for webhook-service |

---

## 5. What still breaks (in detail) and what to do

- **Reissue step 2 (resets / apiserver not ready):** Retries (up to 12) usually succeed. If not: REISSUE_STEP2_SLEEP=6, REISSUE_SETTLE_CAP=300, or teardown+start then re-apply tuning and re-run preflight.
- **Kafka SSL (3b):** Non-fatal. If needed, wait 1–2 min after reissue and re-run or re-run preflight.
- **Applies (3c):** Recovery pass retries once. Else: wait, then `kubectl apply -k infra/k8s/base/config`, same for kafka-external, analytics-service.
- **Caddy NodePort (3c2):** If service was LoadBalancer, delete svc caddy-h3 then re-apply NodePort manifest. Recovery pass also retries once.
- **Scale (4):** Recovery pass retries once. Else wait and re-run preflight or scale manually.
- **Caddy verify (4d):** Non-fatal. Fix: port-forward 30443 or curl from VM; or MetalLB + LoadBalancer IP.
- **Reissue step 5:** Step 5 retries Caddy patch once. If still failing: wait 1–2 min, then `kubectl -n ingress-nginx rollout restart deploy/caddy-h3` or re-run reissue.
- **MetalLB:** When enabled, pool apply can fail if webhook has no endpoints. Fix: ensure controller pod is Running and `kubectl -n metallb-system get endpoints webhook-service` has endpoints; then retry pool apply.

---

## 6. MetalLB (opt-in, webhook, when to use)

- **Why opt-in:** Reduces control-plane and webhook load during reissue/applies. Avoids "pool apply fails because webhook has no endpoints". Single-node preflight does not require LoadBalancer; NodePort is enough.
- **What breaks when MetalLB is on:** Applying IPAddressPool / L2Advertisement can fail with InternalError if **webhook-service** has no endpoints (controller not Ready or Service selector wrong). Fix: get controller Running and webhook endpoints present, then apply pool.
- **When to use:** Phase D (MetalLB-only); or full preflight with METALLB_ENABLED=1 when you need a stable LoadBalancer IP for Caddy. See docs/adr/003-metallb-investigation-and-integration.md.

---

## 7. ADRs and key docs

| Doc | Purpose |
|-----|---------|
| **ADR-005** | Control plane is rate-limited; MetalLB opt-in; phase-gated preflight. |
| **ADR-006** | Colima k3s/etcd tuning via script (values and rationale). |
| **ADR-003** | MetalLB investigation and integration. |
| **docs/COLIMA_K3S_TUNING.md** | Tuning values and how to apply (script vs Colima config). |
| **docs/RCA-PREFLIGHT-CONTROL-PLANE-FAILURES.md** | Full RCA: symptoms, cause, evidence, mitigations, what still breaks, MetalLB. |
| **docs/PREFLIGHT_ROOT_CAUSE_AND_FIXES.md** | Short "what's going on" and what to do when it breaks. |
| **docs/PREFLIGHT_AND_DIAGNOSTICS.md** | Flow: start Colima → tuning → preflight → failure report. |
| **Runbook.md** item 32 | Connection reset / apiserver not ready playbook. |

---

## 8. Commands to run (from repo root)

**Start Colima and apply tuning:**
```bash
colima start --with-kubernetes
./scripts/apply-k3s-etcd-tuning.sh
```

**Run preflight and capture log:**
```bash
LOG="preflight-full-$(date +%Y%m%d-%H%M%S).log"
METALLB_ENABLED=0 REISSUE_STEP2_VIA_SSH=0 ./scripts/run-preflight-scale-and-all-suites.sh 2>&1 | tee "$LOG"
```

**If something failed — get an explanation:**
```bash
./scripts/generate-preflight-failure-report.sh "$LOG"
```

**If step 2 still unstable (slower, more settle):**
```bash
REISSUE_STEP2_SLEEP=6 REISSUE_SETTLE_CAP=300 METALLB_ENABLED=0 REISSUE_STEP2_VIA_SSH=0 ./scripts/run-preflight-scale-and-all-suites.sh 2>&1 | tee "$LOG"
```

**Full teardown and fresh start (nuclear):**
```bash
./scripts/colima-teardown-and-start.sh
./scripts/apply-k3s-etcd-tuning.sh
# then preflight as above
```

**Generate full diagnostic (for handoff):**
```bash
./scripts/generate-preflight-diagnostic-report.sh > preflight-diagnostic-$(date +%Y%m%d-%H%M%S).txt
```

---

## 9. One-paragraph summary for AI

Preflight runs on Colima + k3s (single node). A burst of API writes in reissue step 2 (many secret creates/patches) overloads the control plane and causes connection resets and "apiserver not ready"; later steps then fail in cascade. We mitigated by (1) tuning etcd and kube-apiserver via `apply-k3s-etcd-tuning.sh` (higher in-flight limits, 8 GiB etcd quota), (2) rate-limiting step 2 (sleep between secret ops, 240s settle), (3) a recovery pass that retries applies and scale once, (4) making MetalLB opt-in (NodePort Caddy by default). What still breaks: step 2 can still show resets (retries usually succeed); Kafka SSL, applies, scale, and Caddy verify can fail under load; MetalLB pool apply fails if the webhook has no endpoints. Use the commands in section 8 to run preflight and generate the failure report; see docs/RCA-PREFLIGHT-CONTROL-PLANE-FAILURES.md for full RCA and docs/adr/005 and 006 for decisions.
