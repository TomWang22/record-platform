# Preflight run package — 2026-02-07 21:20:34

**Single document:** Run summary, control-plane pressure (telemetry), raw metrics excerpt, strict TLS/mTLS (what is verified and status), analysis, and explanation.

---

## 1. Run summary

| Item | Value |
|------|--------|
| **Log** | `preflight-run-20260207-212034.log` (180 lines) |
| **Telemetry during run** | `telemetry-during-20260207-212034.log` (1,399 lines; 8s interval) |
| **Failure report** | `preflight-failure-report-20260207-212034.md` |
| **Outcome** | Reissue step 2 failed after first apply succeeded; pipeline did not reach step 4 (Caddy verify) or step 5 (strict TLS/mTLS preflight). |

### What happened

1. **Phase 1A/1B:** Read-only checks OK; write lock acquired (flock).
2. **Reissue step 1:** CA and leaf generated; certificate chain created.
3. **Reissue step 2 (apply path):**
   - **First apply:** `secret/record-local-tls configured` in record-platform (success).
   - **Second apply:** dev-root-ca (record-platform) failed with:
     ```text
     error: error validating "STDIN": error validating data: failed to download openapi: the server is currently unable to handle the request; if you choose to ignore these errors, turn validation off with --validate=false
     ```
   - **Retries 1–11:** Same error every 18s. API was overloaded or rate-limiting; it could not serve the OpenAPI spec needed for server-side apply validation.
4. **Result:** Reissue step 2 exited after 12 attempts; diagnostic (connection-reset playbook) ran; preflight stopped. Steps 3b (Kafka SSL), 3c (applies), 4 (scale), 4d (Caddy strict TLS verify), and **5 (strict TLS/mTLS preflight)** were never run.

---

## 2. Control-plane pressure (telemetry during run)

Telemetry was sampled every **8 seconds** during the run. When the API was reachable, we recorded `apiserver_current_inflight_requests` (mutating and readOnly).

### In-flight samples (excerpt)

| Time (UTC) | mutating | readOnly |
|------------|----------|----------|
| 02:20:50 | 1 | 15 |
| 02:21:30 | 1 | 1 |
| 02:22:03 | 0 | 2 |
| 02:22:11 | 1 | 1 |
| 02:22:43 | 1 | 22 |
| 02:23:24 | 1 | 1 |
| 02:23:56 | 0 | 2 |
| 02:24:04 | 1 | 1 |
| 02:24:37 | 1 | 19 |
| 02:25:18 | 1 | 18 |
| 02:32:31 | 1 | 1 |
| 02:35:25 | 0 | 1 |

Many samples show **(metrics unavailable)** — the API or the `/metrics` request was failing (timeout or connection reset) during reissue step 2 and the diagnostic phase.

**Interpretation:** When metrics were available, **mutating** stayed 0–1 and **readOnly** 1–22. So the *observed* in-flight count was not near the limit (e.g. 400 mutating). The failure was not “too many in-flight” but “server currently unable to handle the request” — the API refused or timed out when **downloading OpenAPI** for client-side validation of the apply. So pressure showed up as the API being temporarily unable to serve the OpenAPI spec, not as a high in-flight gauge. Mitigation: use **`kubectl apply --validate=false`** when applying secrets under load so the server does not need to serve the OpenAPI spec for validation.

---

## 3. Raw metrics (excerpt)

After the run (when the API was back), `kubectl get --raw /metrics` returns full Prometheus metrics. Excerpt of what matters for control-plane pressure:

```text
apiserver_current_inflight_requests{request_kind="mutating"} 1
apiserver_current_inflight_requests{request_kind="readOnly"} 10
etcd_bookmark_counts{resource="clusterrolebindings.rbac.authorization.k8s.io"} 1
etcd_bookmark_counts{resource="clusterroles.rbac.authorization.k8s.io"} 1
etcd_lease_object_counts_bucket{le="10"} 2
etcd_lease_object_counts_bucket{le="+Inf"} 2
etcd_lease_object_counts_sum 3
etcd_request_duration_seconds_bucket{operation="delete",type="apiServerIPInfo",le="0.005"} 1
...
```

Full dump: run `kubectl get --raw /metrics > raw-metrics-$(date +%Y%m%d-%H%M%S).txt` when the API is reachable. Key series for pressure:

- **apiserver_current_inflight_requests** — mutating vs readOnly; compare to `max-mutating-requests-inflight` (e.g. 400).
- **apiserver_request_duration_seconds** — by resource/verb; look at `secrets` and CREATE/PATCH.
- **etcd_*** — etcd latency and load.

---

## 4. Strict TLS and mTLS — what the pipeline does and this run

### What the pipeline verifies (when it runs)

- **Step 4d — Caddy strict TLS:** curl to Caddy (NodePort 30443 or port-forward) with `certs/dev-root.pem`; expect HTTP 200 and no curl exit 60 (certificate verify). Ensures Caddy’s cert is signed by dev-root-ca so clients using that CA get a valid chain.
- **Step 5 — Strict TLS/mTLS preflight:** `ensure-strict-tls-mtls-preflight.sh`:
  - Ensures cluster has **service-tls** (leaf + chain) and **dev-root-ca** in the app namespace.
  - Validates full chain (openssl verify -CAfile ca.crt tls.crt).
  - Writes a consistent set to `/tmp/grpc-certs` (ca.crt, tls.crt, tls.key) for gRPC and k6.
  - Ensures CA at repo root `certs/dev-root.pem` (single source for k6 strict TLS).
  - Optionally restarts gRPC workloads so they pick up the certs.
- **Suites:** Tests (e.g. baseline, tls-mtls) use `SSL_CERT_FILE=certs/dev-root.pem` and optionally client certs for mTLS; they assume step 5 has passed so the chain is valid.

### This run

- Reissue **step 2 failed** before all secrets (including **dev-root-ca** and **service-tls**) were updated. So:
  - **Step 4d (Caddy strict TLS)** was **not run** (pipeline had already exited).
  - **Step 5 (strict TLS/mTLS preflight)** was **not run**.
- Therefore **strict TLS and mTLS were not verified** this run. To have them respected and verified, reissue step 2 must complete so that step 4d and step 5 run; then Caddy verify and the full chain (service-tls + dev-root-ca) are checked and written to `/tmp/grpc-certs` and `certs/dev-root.pem`.

---

## 5. Analysis

1. **First apply worked:** Using **apply** with **type: Opaque** for `record-local-tls` succeeded and updated the secret in one write (no delete storm).
2. **Second apply failed on API load:** The next apply (dev-root-ca) triggered **server-side validation**, which requires the API to **download the OpenAPI spec**. Under load the API responded with “the server is currently unable to handle the request,” so validation failed and the apply never went through.
3. **Telemetry:** When we could sample, in-flight was low (mutating 0–1). The bottleneck was the API’s ability to serve the OpenAPI spec for validation, not the in-flight limit. Many samples were “metrics unavailable” while the API was stressed or the diagnostic was running.
4. **Strict TLS/mTLS:** Not exercised this run because the pipeline stopped at reissue step 2. Fixing step 2 (e.g. with `--validate=false` or more spacing/retries) is required for step 4d and step 5 to run and for strict TLS/mTLS to be verified.

---

## 6. Explanation and next steps

- **Why “unable to handle the request”:** Under the first successful apply and the following apply, the API (or the tunnel) was busy or rate-limiting. The OpenAPI download for apply validation is an extra read that can be refused or delayed when the server is under load. Using **`kubectl apply -f - --validate=false`** for these secret applies avoids that read and reduces pressure.
- **Next steps:**
  1. **Done:** Reissue step 2 now uses **`kubectl apply -f - --validate=false`** so validation does not require the OpenAPI spec when the API is under load.
  2. Re-run preflight (with telemetry if desired). Step 2 should complete; then step 4d and step 5 will run and **strict TLS and mTLS** will be verified and documented in the log.
  3. Keep capturing telemetry during runs to correlate future failures with in-flight and request duration.

---

## 7. Artifact paths

| Artifact | Path |
|----------|------|
| Preflight log | `preflight-run-20260207-212034.log` |
| Telemetry during run | `telemetry-during-20260207-212034.log` |
| Failure report (script-generated) | `preflight-failure-report-20260207-212034.md` |
| Diagnostic log (on reissue failure) | `scripts/diag-reset-20260207-213153.log` |
| This package | `docs/PREFLIGHT_RUN_PACKAGE_20260207-212034.md` |

To capture a full raw metrics file when the API is up:

```bash
kubectl get --raw /metrics > raw-metrics-$(date +%Y%m%d-%H%M%S).txt
```
