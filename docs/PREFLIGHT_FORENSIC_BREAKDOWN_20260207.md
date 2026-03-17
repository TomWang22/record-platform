# Preflight forensic breakdown — 2026-02-07 run

**Run log:** `preflight-run-20260207-211607.log`  
**Failure report:** `preflight-failure-report-20260207-211607.md`  
**Telemetry:** Control-plane snapshot captured after run (see below).

---

## 1. What happened this run

- **Preflight started:** Context colima, API reachable, Phase 1A/1B OK, reissue step 1 (CA + leaf generation) succeeded.
- **Failure point:** Reissue **step 2 (updating secrets)** using the **apply path** (REISSUE_STEP2_USE_APPLY=1).
- **Error:** Every attempt to apply `record-local-tls` failed with:
  ```text
  The Secret "record-local-tls" is invalid: type: Invalid value: "kubernetes.io/tls": field is immutable
  ```
- **Cause:** Kubernetes Secret **type** is immutable. The existing `record-local-tls` secrets (in record-platform and ingress-nginx) were created earlier as **Opaque** (or another type). Our apply YAML used **type: kubernetes.io/tls**. The API correctly rejected changing the type.
- **Result:** Reissue step 2 failed after 12 retries; preflight stopped at 3a.

---

## 2. Fix applied

- **Script:** `scripts/reissue-ca-and-leaf-load-all-services.sh`
- **Change:** In the apply path, **record-local-tls** is now applied with **type: Opaque** instead of `kubernetes.io/tls`. Data keys remain `tls.crt` and `tls.key`; Caddy/ingress use the key names, not the Secret type.
- **Next run:** Re-run preflight; step 2 should succeed (single write per secret, no delete storm). If you ever need `kubernetes.io/tls` for a new cluster, the first apply would create it; subsequent applies must keep the same type.

---

## 3. Control-plane telemetry (all telemetry)

### 3.1 What we have

- **Script:** `scripts/capture-control-plane-telemetry.sh` — captures readyz, healthz, kubectl top, and **kubectl get --raw /metrics** (when API is up).
- **Doc:** `docs/CONTROL_PLANE_TELEMETRY.md` — how to run it, what each source shows, how to enable full k3s metrics if needed.

### 3.2 Snapshot after this run (API idle)

- **readyz / healthz:** OK (ping, log, etcd, informer-sync, poststarthooks all ok).
- **kubectl top nodes/pods:** Not available (metrics-server not available or not installed in this cluster).
- **/metrics:** **Available.** k3s on Colima is exposing the API server metrics. Sample:
  - **apiserver_current_inflight_requests:** `mutating=1`, `readOnly=21` (idle moment).
  - **apiserver_request_duration_seconds:** healthz, readyz, api GET latencies present.

So we **do** have full API server (and component) metrics from the same endpoint; no extra supervisor-metrics flag was required in this setup.

### 3.3 How to see pressure “across the board”

1. **Single snapshot (before/after):**
   ```bash
   ./scripts/capture-control-plane-telemetry.sh --once > telemetry-$(date +%Y%m%d-%H%M%S).txt
   ```

2. **During reissue (pressure at step 2):** In a **second terminal**, run a loop while preflight runs in the first:
   ```bash
   # Terminal 1
   LOG="preflight-run-$(date +%Y%m%d-%H%M%S).log"
   METALLB_ENABLED=0 REISSUE_STEP2_VIA_SSH=0 RUN_FULL_LOAD=0 ./scripts/run-preflight-scale-and-all-suites.sh 2>&1 | tee "$LOG"

   # Terminal 2 (start shortly after 3a begins)
   OUT="telemetry-during-preflight-$(date +%Y%m%d-%H%M%S).txt"
   while true; do
     echo "=== $(date -u '+%Y-%m-%dT%H:%M:%SZ') ===" >> "$OUT"
     kubectl get --raw /metrics 2>/dev/null | grep -E '^apiserver_current_inflight|^apiserver_request_duration_seconds_(count|sum)' >> "$OUT" || true
     sleep 5
   done
   ```
   Stop the loop when preflight finishes. Then inspect **apiserver_current_inflight_requests** (mutating/readOnly) and **apiserver_request_duration_seconds** (count/sum by resource/verb) to see spikes during step 2.

3. **Key metrics for “how much pressure”:**
   - **apiserver_current_inflight_requests{request_kind="mutating"}** — Should stay well below your max-mutating-requests-inflight (e.g. 400 or 200). Near the limit → resets likely.
   - **apiserver_request_duration_seconds** (by resource, verb) — Spikes on `secrets` and verb `CREATE`/`PATCH` during reissue.
   - **etcd_*** — etcd latency/disk; k3s exposes these on the same /metrics when available.

4. **Full dump for later analysis:**
   ```bash
   kubectl get --raw /metrics > apiserver-metrics-$(date +%Y%m%d-%H%M%S).txt
   ```

---

## 4. Files and next steps

| File | Purpose |
|------|--------|
| **preflight-run-20260207-211607.log** | This run’s log (77 lines; failed at reissue step 2). |
| **preflight-failure-report-20260207-211607.md** | Generated failure report (summary, what failed, forensic, dig-further, MetalLB). |
| **scripts/capture-control-plane-telemetry.sh** | Capture readyz, healthz, top, /metrics. |
| **docs/CONTROL_PLANE_TELEMETRY.md** | How to capture and interpret control-plane telemetry. |
| **docs/CERT_LIFECYCLE_SINGLE_NODE_K3S_PLAN.md** | Six-step plan (apply, namespace-at-a-time, health gate, etc.). |

**Next steps:**

1. Re-run preflight with the fixed reissue script (Opaque for record-local-tls):
   ```bash
   LOG="preflight-run-$(date +%Y%m%d-%H%M%S).log"
   METALLB_ENABLED=0 REISSUE_STEP2_VIA_SSH=0 RUN_FULL_LOAD=0 ./scripts/run-preflight-scale-and-all-suites.sh 2>&1 | tee "$LOG"
   ```
2. Optionally run telemetry in a second terminal during 3a to capture in-flight and duration during step 2.
3. After the run: `./scripts/generate-preflight-failure-report.sh "$LOG" > preflight-failure-report-<timestamp>.md`
4. Compare with this run: no more “type is immutable” errors; step 2 should complete with fewer API operations (apply vs delete+create).
