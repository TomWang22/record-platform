# Preflight and Diagnostics: What We Did and How to Use It

This doc explains the preflight pipeline, the control-plane stabilization work, and how to run preflight, capture results, and interpret failures so you can get to the bottom of issues.

**Root cause and “what’s really going on”:** See **docs/PREFLIGHT_ROOT_CAUSE_AND_FIXES.md** for why connection resets and apply/scale failures happen and what we did to fix them (tuning, rate-limited reissue, recovery pass, failure report).

---

## Get ready to run preflight (API, pods, DBs)

Before running **run-preflight-scale-and-all-suites.sh**, get to a known-good state so the API server and pods can become ready:

1. **See what's really going on** — Run the cross-layer diagnostic (Colima, API, k3s, pods, MetalLB, storage):
   ```bash
   ./scripts/colima-k3s-cross-layer-diagnostic.sh
   ```
   See **docs/COLIMA_K3S_ANALYZE_EVERY_LAYER.md** for every layer.

2. **Ensure API + DBs + Kafka, then run preflight** — One script that diagnoses, ensures API (tunnel 6443), all 8 Postgres (5433–5440), and Kafka (:29093), then prints the preflight command or runs it:
   ```bash
   ./scripts/ensure-ready-for-preflight.sh           # diagnose + ensure, then "run preflight"
   ./scripts/ensure-ready-for-preflight.sh --run     # same then run preflight
   SKIP_DIAGNOSTIC=1 ./scripts/ensure-ready-for-preflight.sh   # skip diagnostic (faster)
   ```

3. **Layers the preflight depends on** — API (127.0.0.1:6443) → kubeconfig (preflight-fix) → reissue CA/leaf → scale → pods → wait-for-all-services-ready → test suites. The preflight script now calls **ensure-k8s-api.sh** after step 1 so the tunnel is re-verified before kubeconfig and ensure-api-server-ready.

---

## What we did (summary)

1. **Phase-gated preflight** — Phases A (control-plane sanity), B (cert only), C (load only), D (MetalLB). Rate-limited applies and optional abort on slow apply. See **docs/COLIMA_K3S_CONTROL_PLANE_STABILIZATION_PLAN.md** and **docs/PREFLIGHT_PHASES_README.md**.

2. **MetalLB opt-in** — MetalLB is off by default (`METALLB_ENABLED=0`). Core preflight uses NodePort Caddy; MetalLB only in Phase D or when explicitly enabled.

3. **One kubeconfig per run** — API endpoint (6443 or native) is chosen once and not changed mid-pipeline.

4. **Reissue step 2** — When in-VM API is unreachable, the reissue script falls back to host kubectl (tunnel 6443). You can force host path with `REISSUE_STEP2_VIA_SSH=0` for more stable step 2.

5. **k3s/etcd tuning** — Script **scripts/apply-k3s-etcd-tuning.sh** applies safe API and etcd limits (max-requests-inflight, quota-backend-bytes, etc.) to reduce stalls under burst writes. See **docs/COLIMA_K3S_TUNING.md**.

6. **Settle and retries** — 30s settle after reissue before Kafka SSL; Caddy verify retried 3× with port-forward when Colima + NodePort; Kafka SSL and Caddy verify are non-fatal so the pipeline can continue to suites.

7. **Preflight failure report** — Script **scripts/generate-preflight-failure-report.sh** reads a preflight log and produces a structured report: what failed, why, and what to do. Use it after any failed (or partial) run to get a clear explanation.

8. **Rate-limited reissue step 2 and longer settle** — Reissue script uses **REISSUE_STEP2_SLEEP** (default 4s when host kubectl) between each secret create/delete, and **REISSUE_SETTLE_CAP** (default 240s) for API settle after step 2. Caddy patch in step 5 is retried once after 30s if it fails.

9. **Recovery pass** — After the first apply/scale pass, preflight does a recovery pass (wait 30s, retry config/kafka-external/analytics-service/caddy-nodeport and scale-to-baseline once). Set **PREFLIGHT_RECOVERY_PASS=0** to disable.

10. **Diagnostic report** — **scripts/generate-preflight-diagnostic-report.sh** dumps environment, namespaces, pods, Docker, MetalLB, and “how to run” so you can pipe to a file and hand to an AI or use for debugging.

---

## Full flow: from zero to explained failure

Use this when you want to run preflight, capture everything, and then understand what failed.

### 1. Start Colima (if not running)

```bash
colima start --with-kubernetes
# Or after API resets / flakiness:
./scripts/colima-teardown-and-start.sh
```

### 2. Apply k3s/etcd tuning (recommended)

Reduces API stalls during reissue and applies. Colima must be running.

```bash
./scripts/apply-k3s-etcd-tuning.sh
# If Colima wasn't running: COLIMA_START=1 ./scripts/apply-k3s-etcd-tuning.sh
```

Wait until the script reports "API server ready" (~30–60s after k3s restart).

### 3. Run preflight and pipe to a log

Strict TLS/mTLS path; host kubectl for reissue step 2.

```bash
cd /path/to/record-platform
LOG="preflight-full-$(date +%Y%m%d-%H%M%S).log"
METALLB_ENABLED=0 REISSUE_STEP2_VIA_SSH=0 ./scripts/run-preflight-scale-and-all-suites.sh 2>&1 | tee "$LOG"
```

If it fails or exits early, you still have the full output in `$LOG`.

### 4. Generate the failure report

Tells you what failed and why, and what to do next.

```bash
./scripts/generate-preflight-failure-report.sh "$LOG"
```

Pipe to a file if you want to keep it:

```bash
./scripts/generate-preflight-failure-report.sh "$LOG" > "preflight-failure-report-$(date +%Y%m%d-%H%M%S).md"
```

### 5. (Optional) Full diagnostic report

For handoff or deep debugging: environment, API, namespaces, pods, Docker, MetalLB, and commands.

```bash
./scripts/generate-preflight-diagnostic-report.sh > "preflight-diagnostic-$(date +%Y%m%d-%H%M%S).txt"
# With connection-reset diagnostic (slower):
RUN_DIAGNOSE=1 ./scripts/generate-preflight-diagnostic-report.sh > "preflight-diagnostic-$(date +%Y%m%d-%H%M%S).txt"
```

### 6. When API check fails (step 3): TLS/SNI and RCA in telemetry

When **ensure-api-server-ready.sh** fails (e.g. "port open but kubectl failed"), it prints **TLS/SNI first** then kubectl, then a **root-cause (RCA) summary** so you address the cause, not the symptom:

- **TLS handshake OK** but kubectl fails → API layer (not ready, slow, or HTTP). Retry or restart cluster; not a cert issue.
- **TLS handshake FAIL** → cert/SAN/SNI or nothing listening. If 127.0.0.1 not in cert, recreate cluster with `tls-san=127.0.0.1`; if connection refused, wait for API to start.
- **kubectl with --insecure-skip-tls-verify=OK** → root cause is TLS/certificate (SAN or hostname). Recreate cluster; restart does not fix cert.

A **structured RCA block** is appended to the during-run telemetry file so you can inspect it after the run:

- **File:** `telemetry-during-<ts>.log` in the repo root (path is printed at failure).
- **Find RCA:** `grep -A2 'api_check_failed_rca' telemetry-during-<ts>.log`
- **Fields:** `context=`, `port=`, `tcp_127=`, `tls_handshake=`, `sans=`, `kubectl_exit=`, `insecure_ok=`, `rca=` (e.g. `TLS_handshake_failed`, `API_layer_not_ready_or_slow`, `TLS_cert_SAN_or_hostname_mismatch`).

Use this to decide: fix cert (recreate cluster) vs wait/retry (API not ready).

---

## What the failure report explains

The failure report script scans the log for:

| Detection | Meaning |
|-----------|--------|
| Reissue completed | Step 2 and reissue steps 5–7 finished (maybe with retries). |
| Step 2 retries | Connection reset or "apiserver not ready" during secret creates → API/tunnel overload. |
| Kafka SSL failed | kubectl apply for kafka-ssl-secret failed (often right after reissue). Pipeline continues. |
| Applies failed | config, kafka-external, analytics-service, or caddy-h3-service-nodeport apply failed (503/timeout or conflict). |
| Scaling failed | One or more `kubectl scale` failed → API overload after many writes. |
| Caddy verify failed | curl to Caddy (e.g. 127.0.0.1:30443) failed (exit 35 = connect error). Pipeline continues. |
| API not responding | "API still not responding after 120s" or diagnostic showed get nodes failed. |

For each detected failure it prints:

- **Symptom** — What you see in the log.
- **Cause** — Short explanation (e.g. burst writes, tunnel, NodePort not forwarded).
- **What to do** — Concrete steps (tuning, REISSUE_STEP2_VIA_SSH=0, tunnel, teardown+start, or manual apply).

At the end it reminds you about tuning, strict TLS, phase gating, and the full diagnostic report.

---

## Key docs and scripts

| Doc / script | Purpose |
|--------------|--------|
| **docs/COLIMA_K3S_CONTROL_PLANE_STABILIZATION_PLAN.md** | Ground rules, phases A–E, rate limiting, MetalLB policy, success criteria. |
| **docs/COLIMA_K3S_TUNING.md** | k3s/etcd tuning values and how to apply (script or Colima config). |
| **docs/PREFLIGHT_PHASES_README.md** | Phase model, env vars (PREFLIGHT_PHASE, METALLB_ENABLED, etc.). |
| **docs/CERT_LIFECYCLE.md** | CA → leaf → secret flow, idempotent scripts, verify before load. |
| **docs/adr/005-control-plane-is-rate-limited.md** | ADR: control plane is rate-limited. |
| **Runbook.md** (item 32) | API 503 / connection reset playbook. |
| **scripts/apply-k3s-etcd-tuning.sh** | Apply API/etcd tuning in Colima VM; restart k3s. |
| **scripts/generate-preflight-failure-report.sh** | Turn a preflight log into “what failed and why” + next steps. |
| **scripts/generate-preflight-diagnostic-report.sh** | Full environment and “how to run” for debugging or handoff. |

---

## Getting to the bottom of it

1. **Run the full flow** (steps 1–4 above) so you have a log and a failure report.
2. **Read the failure report** — It names the phase (reissue, Kafka SSL, apply, scale, Caddy verify, API) and gives causes and actions.
3. **Apply the suggested actions** — Usually: ensure tuning is applied, use `REISSUE_STEP2_VIA_SSH=0`, re-establish tunnel or teardown+start, then re-run preflight.
4. **If it’s still unclear** — Generate the full diagnostic report (step 5) and use it with the Runbook (item 32) and **scripts/CONNECTION-RESET-PLAYBOOK.md** for connection resets and 503s.
