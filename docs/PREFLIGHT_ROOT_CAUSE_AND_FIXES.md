# Preflight: What’s Really Going On (Root Cause and Fixes)

When preflight fails with connection resets, “apiserver not ready”, apply/scale failures, or “Reissue failed”, it’s usually the same underlying issue. This doc states the root cause, what we changed to reduce it, and what to do when it still breaks.

---

## Root cause (short)

1. **Single-node Colima k3s** has a limited API server and etcd. Under a **burst of writes** (many `kubectl create secret` / `apply` / `scale` in a short window), the control plane can:
   - Return **connection reset by peer** (server or tunnel closes the connection)
   - Temporarily report **apiserver not ready** or **ServiceUnavailable**
   - Take a long time to recover (often 1–2 minutes)

2. **Reissue step 2** does several secret creates/patches in quick succession (record-platform + ingress-nginx namespaces, then service-tls). That burst is the main trigger. When you use **host kubectl** (tunnel to 127.0.0.1:6443), the same burst goes over the tunnel and can overload it or the API.

3. **Cascade**: After step 2, the API may be unresponsive for 30–120+ seconds. Then:
   - **Step 4b** (settle) may time out (“API still not responding after 120s”).
   - **Step 5** (Caddy patch/rollout) can fail with “apiserver not ready” or connection reset.
   - **3b** (Kafka SSL apply) runs right after reissue and often fails while the API is recovering.
   - **3c** (config, kafka-external, analytics, caddy-h3-service-nodeport) and **4** (scale) can fail with 503/timeout.

So: **one burst (reissue step 2) → API/tunnel overload → long recovery → later steps fail**. It’s not “random” flakiness; it’s load and rate limits.

---

## What we did to reduce it

1. **k3s/etcd tuning**  
   **scripts/apply-k3s-etcd-tuning.sh** raises API and etcd limits (e.g. `max-requests-inflight=800`, `quota-backend-bytes=8GiB`). Run it **once per Colima profile** after start. See **docs/COLIMA_K3S_TUNING.md**.

2. **Rate-limited reissue step 2**  
   In **scripts/reissue-ca-and-leaf-load-all-services.sh**:
   - **REISSUE_STEP2_SLEEP** (default 4 when using host kubectl, 2 when using SSH): sleep between each secret create/delete so we don’t blast the API.
   - **REISSUE_SETTLE_CAP** (default 240): max seconds to wait for the API to settle after step 2 (was 120). Poll every 10s.

3. **Caddy patch retry**  
   Step 5 (restart Caddy) retries the deployment patch once after 30s if it fails (e.g. apiserver not ready).

4. **Preflight recovery pass**  
   In **scripts/run-preflight-scale-and-all-suites.sh**, after the first apply/scale pass we do a **recovery pass** (default on for full preflight): wait 30s, then retry applies for config, kafka-external, analytics-service, caddy-h3-service-nodeport, and retry scale-to-baseline once. Set **PREFLIGHT_RECOVERY_PASS=0** to disable.

5. **Host kubectl for step 2**  
   Using **REISSUE_STEP2_VIA_SSH=0** (recommended with Colima + 6443) keeps step 2 on the host/tunnel with retries, and we added the inter-secret sleep so the tunnel sees fewer concurrent writes.

6. **Non-fatal Kafka SSL and Caddy verify**  
   Kafka SSL apply and Caddy strict TLS verify can fail and are retried; if they still fail, preflight continues so you still get to scale and suites. Caddy verify uses a short-lived port-forward when Colima + NodePort so 127.0.0.1:30443 is reachable.

7. **Failure report**  
   **scripts/generate-preflight-failure-report.sh** reads a preflight log and explains what failed and what to do (reissue, applies, scale, Caddy verify). Use it after every failed or partial run.

---

## When it’s still “back to square one”

If you still see connection resets, “Reissue failed”, or many apply/scale failures:

### 1. Confirm Colima and tuning

```bash
colima status   # must show "running"
./scripts/apply-k3s-etcd-tuning.sh   # run once; wait for "API server ready"
```

If **apply-k3s-etcd-tuning.sh** said “Colima is not running” but `colima status` shows running, the script was fixed to use `colima status 2>&1 | grep -qi running`. Re-run the script.

### 2. Run preflight with recommended env and capture log

```bash
cd /path/to/record-platform
LOG="preflight-full-$(date +%Y%m%d-%H%M%S).log"
METALLB_ENABLED=0 REISSUE_STEP2_VIA_SSH=0 ./scripts/run-preflight-scale-and-all-suites.sh 2>&1 | tee "$LOG"
```

### 3. Generate the failure report

```bash
./scripts/generate-preflight-failure-report.sh "$LOG"
```

The report summarizes: reissue retries, Kafka SSL, applies, scale, Caddy verify, and API resets, with **what to do** for each.

### 4. If reissue step 2 still fails repeatedly

- **Increase step 2 sleep**:  
  `REISSUE_STEP2_SLEEP=6 METALLB_ENABLED=0 REISSUE_STEP2_VIA_SSH=0 ./scripts/run-preflight-scale-and-all-suites.sh`
- **Longer settle**:  
  `REISSUE_SETTLE_CAP=300` (5 min) in the same command.
- **Full teardown and start** (clears bad API state):  
  `./scripts/colima-teardown-and-start.sh` then `./scripts/apply-k3s-etcd-tuning.sh` then preflight again.

### 5. If applies/scales keep failing but reissue completed

Recovery pass should retry them once. If not enough:

- Wait 1–2 minutes.
- Manually re-apply and scale:
  - `kubectl apply -k infra/k8s/base/config`
  - `kubectl apply -k infra/k8s/base/kafka-external`
  - `kubectl apply -k infra/k8s/base/analytics-service`
  - `kubectl apply -f infra/k8s/caddy-h3-service-nodeport.yaml` (when METALLB_ENABLED=0)
  - Scale deployments to 1 (or 2 for caddy-h3) as in the script.

### 6. Caddy verify (exit 35) failed

Preflight continues anyway. To fix for local curl:

- With NodePort: ensure port-forward or Colima forwards 30443, or run `curl` from inside the VM via `colima ssh`.
- See **Runbook.md** and **docs/PREFLIGHT_AND_DIAGNOSTICS.md**.

---

## One-page “what we did” for handoff

- **Problem:** Single-node k3s API/etcd is rate-limited; reissue step 2’s burst of secret creates causes connection resets and a long recovery, so later steps (Kafka SSL, applies, scale, Caddy) fail.
- **Fixes:** (1) k3s/etcd tuning script, (2) rate-limited reissue step 2 (REISSUE_STEP2_SLEEP, REISSUE_SETTLE_CAP), (3) Caddy patch retry, (4) preflight recovery pass for applies/scale, (5) REISSUE_STEP2_VIA_SSH=0 and METALLB_ENABLED=0, (6) failure report script.
- **When it breaks again:** Run tuning, run preflight with tee to a log, run `generate-preflight-failure-report.sh` on the log, follow the report’s “what to do” and this doc.

See also: **docs/PREFLIGHT_AND_DIAGNOSTICS.md**, **docs/COLIMA_K3S_CONTROL_PLANE_STABILIZATION_PLAN.md**, **Runbook.md** item 32.

**Full RCA and current situation:** **docs/RCA-PREFLIGHT-CONTROL-PLANE-FAILURES.md** — Root cause analysis, what we did (including etcd tuning), current situation, **what still breaks in detail**, and **MetalLB** (opt-in, webhook/endpoints issue, when to use). **ADR-005** (control plane rate-limited, MetalLB opt-in), **ADR-006** (Colima k3s/etcd tuning).
