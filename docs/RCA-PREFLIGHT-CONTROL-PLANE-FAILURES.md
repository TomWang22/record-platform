# Root Cause Analysis: Preflight and Control-Plane Failures (Colima k3s)

**Status:** Accepted  
**Date:** 2026-02-08  
**Scope:** Preflight pipeline failures: connection reset by peer, apiserver not ready, apply/scale failures, reissue step 2 instability.

---

## Executive summary

Preflight and reissue fail or become flaky because **a burst of Kubernetes API writes (reissue step 2 secret creates/patches) overloads the single-node Colima k3s control plane**. The API server or etcd rate-limits or drops connections, leading to "connection reset by peer" and "apiserver not ready." Later steps (Kafka SSL apply, config/kafka-external/analytics apply, scale-to-baseline, Caddy patch) then fail in cascade because the API is still recovering. **Root cause:** single-node API/etcd throughput limit plus burst write pattern. **Mitigations:** k3s/etcd tuning, rate-limited reissue step 2, longer settle, recovery pass, MetalLB opt-in. **What still breaks:** see "Current situation and what still breaks" and "MetalLB" below.

---

## 1. Symptoms and timeline

| Symptom | When it appears | Typical message |
|--------|------------------|------------------|
| Connection reset by peer | During reissue step 2 (create secret) | `read tcp 127.0.0.1:xxxxx->127.0.0.1:6443: read: connection reset by peer` |
| Apiserver not ready | During or immediately after step 2 | `error: failed to create secret apiserver not ready` |
| API still not responding after 120s | After step 2, before step 5 (Caddy) | `API still not responding after 120s; step 5 may fail` |
| Reissue failed (step 5) | Caddy patch or rollout | `Reissue failed — suites may hit curl 60` |
| Kafka SSL apply failed | Right after reissue (3b) | `kubectl apply failed (host and colima ssh)` |
| Apply config / kafka-external / analytics failed | Step 3c | `Apply config failed`, `Apply kafka-external failed` |
| Apply caddy-h3-service-nodeport failed | Step 3c2 (METALLB_ENABLED=0) | `Apply caddy-h3-service-nodeport.yaml failed` |
| Scale auth-service / api-gateway / … failed | Step 4 | `scale auth-service failed`, etc. |
| Caddy strict TLS verification failed | Step 4d | `Caddy strict TLS verification failed after 3 attempts` (curl exit 35) |
| MetalLB pool apply fails | When MetalLB enabled | `InternalError (endpoints not found)` — webhook has no endpoints |

**Typical sequence:** Reissue step 2 runs several `kubectl create secret` / patch in quick succession → first one or two get connection reset → retries eventually succeed → step 2 completes. By then the API is overloaded; 4b (settle) may time out; step 5 (Caddy patch) fails; 3b (Kafka SSL) and 3c/4 fail with 503 or timeout.

---

## 2. Root cause

**Primary cause:** The Kubernetes API server (and etcd behind it) on **single-node Colima k3s** has limited throughput. When **many mutating requests** (create secret, patch secret, apply, scale) are sent in a **short burst**, the control plane:

- **Closes connections** (connection reset by peer) when it cannot keep up or when limits are hit.
- Returns **503 ServiceUnavailable** or **"apiserver not ready"** when the server is temporarily overloaded.
- Takes **30–120+ seconds** to become responsive again after the burst.

**Contributing factors:**

1. **Reissue step 2** performs multiple secret creates/patches in two namespaces (record-platform, ingress-nginx) plus service-tls, with minimal spacing. That burst is the main trigger.
2. **Host kubectl** (tunnel to 127.0.0.1:6443) sends the same burst over the tunnel; the tunnel or the API can drop connections.
3. **Default k3s/etcd limits** (e.g. max-requests-inflight=400, max-mutating-requests-inflight=200, etcd quota 2 GiB) are conservative; a burst of secret writes can hit them.
4. **No backoff between step 2 and step 5** — we proceed to Caddy patch and rollout while the API may still be recovering.
5. **Subsequent applies and scale** (3c, 4) run while the API is still under stress or recovering, so they fail with 503/timeout.

**Planned fix (reduce write amplification):** See **docs/ETCD_WRITE_BUDGET_PLAN.md** — Canonical plan: success criteria (complete or abort early; no retries onto degraded; never brick; reproducible). Three pillars: (A) apply-only, one namespace at a time, health gate 3× readyz, abort on failure; (B) rate limit, lower max-mutating (100–150), abort on reset/not ready; (C) MetalLB decoupled from cert work. Four phases; CA/leaf **rotation (generation) unchanged**. One sentence: *Preflight is not broken — it is finally honest about the control plane’s limits; our job is to teach it when to stop.* Also: **docs/CERT_LIFECYCLE_SINGLE_NODE_K3S_PLAN.md** (six-step detail).

**Evidence:**

- Logs show "Attempt 1/12 failed … connection reset by peer" then "Attempt 2/12 failed … apiserver not ready" then eventual success for step 2; then "API still not responding after 120s" and "Reissue failed" at step 5.
- `openssl s_client` and `curl -k` to 6443 succeed when the API is idle; failures occur under load.
- Applying **k3s/etcd tuning** (higher in-flight limits, larger etcd quota) and **rate-limiting step 2** (sleep between each secret op) reduces resets and allows step 2 and later steps to complete more reliably.

---

## 3. What we did (mitigations)

| Mitigation | What was done | Reference |
|------------|----------------|-----------|
| **etcd and kube-apiserver tuning** | Applied via `scripts/apply-k3s-etcd-tuning.sh`: max-requests-inflight=800, max-mutating-requests-inflight=400, default-watch-cache-size=200; etcd quota-backend-bytes=8 GiB, max-request-bytes=1572864, snapshot-count=50000. Drop-in at `/etc/rancher/k3s/config.yaml.d/50-control-plane-stabilization.yaml` in Colima VM; k3s restarted. | **docs/COLIMA_K3S_TUNING.md**, **ADR-006** |
| **Rate-limited reissue step 2** | Sleep between each secret create/delete (REISSUE_STEP2_SLEEP, default 4s when host kubectl, 2s when SSH). Longer settle after step 2 (REISSUE_SETTLE_CAP=240s). Caddy patch in step 5 retried once after 30s on failure. | **scripts/reissue-ca-and-leaf-load-all-services.sh** |
| **Recovery pass** | After first apply/scale pass, preflight waits 30s then retries config, kafka-external, analytics-service, caddy-h3-service-nodeport and scale-to-baseline once. | **scripts/run-preflight-scale-and-all-suites.sh**, PREFLIGHT_RECOVERY_PASS=1 |
| **MetalLB opt-in** | MetalLB disabled by default (METALLB_ENABLED=0). Core preflight uses NodePort Caddy (30443). MetalLB only in Phase D or when explicitly enabled. Reduces control-plane and webhook load during normal runs. | **ADR-005**, **docs/PREFLIGHT_PHASES_README.md** |
| **Phase-gated preflight** | Phases A–D; rate-limited applies; abort on slow apply when phase is set. | **docs/COLIMA_K3S_CONTROL_PLANE_STABILIZATION_PLAN.md** |
| **Failure report** | `scripts/generate-preflight-failure-report.sh` reads a preflight log and explains what failed and what to do. | **docs/PREFLIGHT_ROOT_CAUSE_AND_FIXES.md** |

---

## 4. Current situation and what still breaks

### 4.1 Current situation

- **Platform:** Colima (default profile), docker + k3s, single node. API at 127.0.0.1:6443 (tunnel) or native port.
- **Tuning:** etcd and kube-apiserver tuning **have been applied** via `apply-k3s-etcd-tuning.sh` (see **docs/COLIMA_K3S_TUNING.md** for values). Script writes drop-in in VM and restarts k3s; must be re-run after a new Colima profile or if the drop-in was removed.
- **Preflight defaults:** METALLB_ENABLED=0 (NodePort Caddy), REISSUE_STEP2_VIA_SSH=0 (host kubectl for step 2), PREFLIGHT_RECOVERY_PASS=1 (recovery pass enabled).
- **Caddy:** NodePort 443:30443 when MetalLB is off. For strict TLS verify from the host, preflight uses a short-lived port-forward to 30443 when needed.

### 4.2 What still breaks (in detail)

**Reissue step 2 (connection reset / apiserver not ready)**  
- **What:** First one or two secret creates (or patches) in step 2 can still get "connection reset by peer" or "apiserver not ready" before retries succeed.  
- **Why:** Even with tuning and inter-secret sleep, the very first writes after the tunnel is warm can trigger a reset under load.  
- **What to do:** Retries (up to 12) usually succeed. If not: increase REISSUE_STEP2_SLEEP (e.g. 6), increase REISSUE_SETTLE_CAP (e.g. 300), or run `./scripts/colima-teardown-and-start.sh` then re-apply tuning and re-run preflight.

**Kafka SSL apply (3b) immediately after reissue**  
- **What:** `kubectl apply` for kafka-ssl-secret sometimes fails with "kubectl apply failed (host and colima ssh)".  
- **Why:** API is still recovering from step 2; 30s settle helps but is not always enough.  
- **What to do:** Kafka SSL is non-fatal; preflight continues. If you need Kafka SSL for suites, wait 1–2 minutes after reissue and re-run the Kafka SSL step or re-run preflight.

**Applies: config, kafka-external, analytics-service (3c)**  
- **What:** `Apply config failed`, `Apply kafka-external failed`, `Apply analytics-service failed`.  
- **Why:** API 503 or timeout when many applies run in sequence; or namespace/resource not ready.  
- **What to do:** Recovery pass retries these once after 30s. If still failing, wait for API to settle then `kubectl apply -k infra/k8s/base/config`, `-k infra/k8s/base/kafka-external`, `-k infra/k8s/base/analytics-service` manually.

**Apply caddy-h3-service-nodeport (3c2)**  
- **What:** `Apply caddy-h3-service-nodeport.yaml failed` (sometimes twice).  
- **Why:** API timeout; or existing caddy-h3 Service is type LoadBalancer and cannot be changed to NodePort in place (conflict).  
- **What to do:** If the service already exists and is NodePort, no action. If it was LoadBalancer: `kubectl -n ingress-nginx delete svc caddy-h3` then re-apply the NodePort manifest. Recovery pass also retries this once.

**Scale to baseline (4)**  
- **What:** `scale auth-service failed`, `scale api-gateway failed`, etc.  
- **Why:** API overload or timeout after many scale commands.  
- **What to do:** Recovery pass retries scale once. Otherwise wait 1–2 min and re-run preflight or scale deployments manually to 1 (and caddy-h3 to 2).

**Caddy strict TLS verify (4d)**  
- **What:** `Caddy strict TLS verification failed after 3 attempts` (curl exit 35 = SSL connect error).  
- **Why:** 127.0.0.1:30443 not reachable from host (NodePort not forwarded from Colima VM), or Caddy not ready.  
- **What to do:** Preflight continues (non-fatal). To fix: ensure port-forward 30443→svc/caddy-h3:443 or curl from inside VM via `colima ssh`; or enable MetalLB and use LoadBalancer IP. See Runbook and **docs/PREFLIGHT_AND_DIAGNOSTICS.md**.

**Reissue step 5 (Caddy rollout)**  
- **What:** "Reissue failed" at step 5 when Caddy patch or rollout status fails.  
- **Why:** API still not accepting writes after 4b settle (e.g. settle timed out at 240s).  
- **What to do:** Step 5 now retries the Caddy patch once after 30s. If it still fails, wait 1–2 min and run `kubectl -n ingress-nginx rollout restart deploy/caddy-h3` and/or re-run reissue.

---

## 5. MetalLB

### 5.1 Why MetalLB is opt-in

- **ADR-005** and the stabilization plan state: MetalLB is **opt-in** for preflight. Core pipeline runs with **METALLB_ENABLED=0** (default) and uses **NodePort** for Caddy (port 30443). Reasons:
  - Reduces control-plane and admission webhook load during the critical reissue and apply phases.
  - Avoids dependency on MetalLB controller and webhook being ready; avoids "pool apply fails because webhook has no endpoints" (see below).
  - Single-node Colima does not require a LoadBalancer IP for preflight; NodePort + optional port-forward is sufficient for strict TLS verify and suites.

### 5.2 What breaks with MetalLB (webhook / endpoints)

When MetalLB **is** enabled (METALLB_ENABLED=1 or Phase D):

- **Symptom:** Applying the MetalLB pool (IPAddressPool / L2Advertisement) can fail with **InternalError** or "endpoints not found" for the **webhook-service**.
- **Cause:** The MetalLB controller runs a validating webhook. If the **controller pod is not Running** or the **webhook Service has no endpoints**, the API server cannot call the webhook and the pool apply fails.
- **Evidence:** Diagnostic report shows: `webhook-service has no endpoints → pool apply will fail with InternalError (endpoints not found)`.
- **What to do:**
  1. Ensure MetalLB controller is installed and the controller pod is **Running**: `kubectl -n metallb-system get pods`.
  2. Ensure the webhook Service has endpoints: `kubectl -n metallb-system get endpoints webhook-service`. If empty, the controller pod is not ready or the Service selector does not match the pod.
  3. Wait for the controller to be Ready, then apply the pool and Caddy LoadBalancer service. See **docs/adr/003-metallb-investigation-and-integration.md** and any METALLB_AND_API_503_REPORT or install script in the repo.

### 5.3 When to use MetalLB

- **Phase D** (MetalLB-only phase): validate MetalLB install and pool apply without running full preflight.
- **Full preflight with LoadBalancer Caddy:** set METALLB_ENABLED=1 when you need a stable LoadBalancer IP for Caddy (e.g. for external access or to avoid port-forward for verify). Ensure controller and webhook are healthy before running.

---

## 6. Forensic / deep-dive: why it looks “stuck” and where writes line up

### 6.1 Failure report script “hanging”

- **Symptom:** `./scripts/generate-preflight-failure-report.sh "$LOG"` in a **different terminal** produces no output and appears stuck.
- **Cause:** In that terminal `$LOG` is unset (it was set in the terminal where you ran preflight). The script is called with no argument, so it falls back to **reading stdin** (`LOG=$(cat)`). It then blocks waiting for input.
- **Fix:** Pass the **log file path explicitly**, e.g.  
  `./scripts/generate-preflight-failure-report.sh preflight-run-20260207-205811.log`  
  Or in the same terminal where you ran preflight, use `./scripts/generate-preflight-failure-report.sh "$LOG"`.  
  The script now exits with usage if run with no argument and stdin is a TTY (no more silent hang).

### 6.2 All writes line up at reissue step 2

- The **single burst** that triggers resets is **reissue step 2**: delete + create secrets in `record-platform` and `ingress-nginx`, then create/update `service-tls`. Those writes hit the API in quick succession (with only the configured sleep between retries). Step 4b (settle) and step 5 (Caddy patch) run **after** that burst; if the API is still overloaded, they fail. So from a forensic view: **all the problematic writes are in step 2**; everything after is read or lighter write on an already-stressed API.

### 6.3 Why “jitter” (e.g. Kind/Docker in another terminal) might have “helped”

- With **only** Colima + preflight, the host CPU and the tunnel are dedicated to one workload. The reissue script sends the burst at a **very regular** pace (same sleep, same order). The API sees a tight, repeated pattern and can hit in-flight limits quickly.
- With **Kind or Docker Desktop** (or other heavy processes) running in the background, the shell and the Colima VM get more context switches and variable latency. That can **spread** the same burst slightly in time (subsecond delays), so the API sees a slightly less sharp spike and may stay under the limit. So a “good run” in the past might have coincided with more system jitter (slower shell, other containers), not a different script. **Forensic takeaway:** reproducibility depends on load and timing; to get stable good runs we rely on rate limiting, settle, and lock (flock/mkdir), not on ambient jitter.

### 6.4 How to go forensic

- **Layer 1 (symptom):** After a failure, run `kubectl get nodes` and `kubectl create ns test` — if get nodes works but create fails, the API is still recovering from writes.
- **Layer 2 (transport):** While reproducing: `sudo tcpdump -nn -i lo0 tcp port 6443` and look for RST; or use `scripts/diagnose-reset-by-peer.sh` (see CONNECTION-RESET-PLAYBOOK.md).
- **Layer 3 (TLS):** `openssl s_client -connect 127.0.0.1:6443 -servername kubernetes` and `curl -k https://127.0.0.1:6443/version` — if these succeed while kubectl fails, the issue is API load/limits, not TLS or reachability.
- **Diagnostic log:** After reissue failure the pipeline runs a connection-reset diagnostic and writes `scripts/diag-reset-*.log` (DEEP + GATHER). Use that file to see Colima/ports/tunnel state at failure time.

---

## 7. ADR and doc references

| Document | Purpose |
|----------|---------|
| **ADR-005** | Control plane is rate-limited; MetalLB opt-in; phase-gated preflight; abort on slow apply. |
| **ADR-006** | Colima k3s/etcd tuning applied via script (values and rationale). |
| **ADR-003** | MetalLB investigation and integration (L2/BGP, flow, when to use). |
| **docs/COLIMA_K3S_TUNING.md** | Exact tuning values and how to apply (script vs Colima config). |
| **docs/COLIMA_K3S_CONTROL_PLANE_STABILIZATION_PLAN.md** | Full stabilization plan (phases, ground rules, MetalLB opt-in). |
| **docs/PREFLIGHT_ROOT_CAUSE_AND_FIXES.md** | Short "what's going on" and what to do when it breaks. |
| **docs/PREFLIGHT_AND_DIAGNOSTICS.md** | Flow: start Colima → tuning → preflight → failure report. |
| **Runbook.md** item 32 | Connection reset / apiserver not ready playbook; link to root cause and RCA. |
| **docs/PREFLIGHT_REPORT_FOR_AI.md** | **Single report to send to an AI or teammate:** self-contained RCA, situation, what breaks, MetalLB, ADRs, tuning, commands. Copy/send that file as-is. |

---

## 8. Summary for handoff

- **We tuned etcd and kube-apiserver** via `scripts/apply-k3s-etcd-tuning.sh` (see COLIMA_K3S_TUNING.md and ADR-006). Current situation: tuning applied; preflight uses rate-limited reissue, longer settle, recovery pass; MetalLB off by default.
- **What still breaks:** Reissue step 2 can still show resets (retries usually succeed); Kafka SSL, applies, scale, Caddy verify can fail under load or timing; MetalLB pool apply fails if webhook has no endpoints.
- **RCA:** Single-node API/etcd burst write overload → connection resets and cascade failures; mitigations are tuning, rate limit, recovery pass, MetalLB opt-in.
- **MetalLB:** Opt-in; when enabled, ensure controller and webhook are Running before pool apply; see ADR-003 and section 5 above.
