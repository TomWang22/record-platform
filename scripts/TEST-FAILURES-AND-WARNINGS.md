# Test suite: failures and warnings reference

This doc catalogs **known** failures and warnings from the full suite (auth, baseline, enhanced, adversarial, rotation, tls-mtls, social) and what to do about them.

---

## Auth suite (1/8)

| Item | Severity | Cause | Action |
|------|----------|--------|--------|
| MFA verify failed (HTTP 500) | ⚠️ | TOTP verification logic or DB state | Check auth-service logs; ensure `mfa_enabled` is set after verify. |
| MFA not visible after 10s | ⚠️ | Pool/visibility delay | Optional: increase wait or treat as env-dependent. |
| Email verification send failed (ECONNREFUSED 192.168.5.2:1025) | ⚠️ | No mailhog/nodemailer in cluster | Expected without email service; configure SMTP or skip in CI. |
| OAuth Google endpoint error (HTTP 500) | ⚠️ | Missing/invalid Google Client ID/Secret in K8s | Set secrets for OAuth or skip in CI. |
| Passkey auth start – no passkeys registered | ⚠️ | Test 12 rejects mock data (production validation) | Expected; use browser/WebAuthn or `ALLOW_MOCK_PASSKEY_DATA=true` for full flow. |
| MFA disable failed (HTTP 401) | ⚠️ | MFA was never enabled (verify failed above) | Cascades from MFA verify; fix verify first. |

**Summary:** Auth still reports **PASSED**; failures are for optional/external features (email, OAuth, full MFA/passkey). Basic auth (register, login, logout) is what the suite requires.

---

## Baseline suite (2/8)

| Item | Severity | Cause | Action |
|------|----------|--------|--------|
| Test 4c Envoy gRPC routing failed | ⚠️ | Envoy not reachable on host ports 30000/30001 (e.g. Colima/k3d), or **with mTLS:** "remote connection failure" (Envoy not presenting client cert to backends). **Suite uses MetalLB (Caddy LB IP:443)** for gRPC; the failure is on Envoy → backend, not client → Caddy. | Without mTLS: expected when NodePort not exposed. **With mTLS:** Run `./scripts/strict-tls-bootstrap.sh` from repo root (creates `record-local-tls` in envoy-test and restarts Envoy). Ensure base applied: `kubectl apply -k infra/k8s/base`. See Runbook "Auth and gateway 500" (Envoy remote connection failure) and docs/ENVOY_REAL_MTLS.md. |
| Forum post vote / Update listings settings / Rate seller — HTTP 502 | ⚠️ | (1) **Missing tables** in correct DB (social on 5434, listings on 5435), or (2) **Pods cannot reach Postgres**: host has SSH (or other) on *:5433/5434/5435 instead of Postgres, so pods (host.docker.internal → 192.168.5.2) get connection refused/timeout → backend 500 → gateway 502. | **When schema preflight passes but 502 persists:** Run `./scripts/diagnose-502-and-analytics.sh`. Step 5 checks if a pod can reach host.docker.internal:5434. If it fails: ensure **Postgres** (not SSH) listens on 0.0.0.0:5433,5434,5435 on the host (`lsof -i -P | grep '5434.*LISTEN'` should show postgres/com.docker, not ssh). Use Docker Compose or native Postgres bound to 0.0.0.0; do not use SSH port forwards for the ports pods use. |
| Checkout failed – duplicate key `orders_order_number_key` | ⚠️ | Shopping order_number sequence not applied on DB | Preflight (step 3b4) now runs `ensure-shopping-order-number-sequence.sh`. If you run suites without preflight, run that script once, or `RUN_SHOPPING_SEQUENCE=1`. |
| Skipping get order details / resell – Order ID not available | ⚠️ | Cascades from checkout failure | Fix checkout (sequence) then re-run. |
| Request return HTTP 404 (Test 13g) | ⚠️ | **Root cause:** PURCHASE_ID must match ORDER_ID (same order). 404 = "Purchase not found or not yours". | Preflight 6f runs `ensure-shopping-returns-migration.sh` (returns table). Test now gets PURCHASE_ID from order details (13e) so it matches ORDER_ID. |
| Python AI selling-advice HTTP 503 — db_pool_unavailable | ⚠️ | python_ai DB (port 5440) not reachable from pod or pool creation failed | **Same connectivity as 502:** pods use host.docker.internal:5440. Ensure Postgres (or the service for 5440) listens on 0.0.0.0:5440 on the host so pods can connect. Run schema for python_ai DB; ensure POSTGRES_URL_PYTHON_AI is set in app-config. |
| Python AI logs: KafkaConnectionError / Unclosed AIOKafkaConsumer | ℹ️ | Kafka (kafka-external:9093) unreachable from pod; consumer fails and used to leak | Fixed: consumer now closes on failure and logs WARNING once. Service stays healthy; selling-advice depends on DB (5440), not Kafka. Set ENABLE_KAFKA=false to skip consumer when Kafka is external and unreachable. |
| Analytics log-search logged: false; no row in listings.search_history (Test 13k / 13k2) | ⚠️ | (1) records DB (5433) missing table or analytics can’t connect; (2) **Same as 502:** pod can’t reach 5433 (e.g. SSH on host port). (3) user_id FK: test user exists in auth DB (5437) but not in records.auth.users; analytics now retries with user_id=null. | **Diagnostics:** Test now prints backend `error_code` and `message` (e.g. ECONNREFUSED) and a live **Pod→records (5433)** check. Run `./scripts/diagnose-502-and-analytics.sh`. On Colima/k3d run `./scripts/colima-apply-host-aliases.sh` or `./scripts/apply-k3d-host-aliases.sh`; ensure Postgres on 0.0.0.0:5433. Rebuild/redeploy analytics-service so FK-retry (user_id=null) is deployed. |
| Analytics fuzzy-search HTTP 500 | ⚠️ | One of records/analytics queries failed (e.g. missing analytics.price_snapshots, pg_trgm). | **Fixed:** fuzzy-search now uses Promise.allSettled and returns partial results (200) when one source fails. If you still see 500, check analytics-service logs; ensure listings.search_history exists on records DB and pg_trgm extension is enabled; analytics.price_snapshots is optional. |
| Resell purchase via HTTP/3 failed – HTTP 404 | ⚠️ | **Root cause:** 13i (H2 resell) consumes PURCHASE_ID; 13j8 had no separate resellable purchase. | Fixed: second checkout (13c2) creates PURCHASE_ID_2. 13i consumes PURCHASE_ID; 13j8 uses PURCHASE_ID_2 (or from 13j7/DB). |
| Cleanup: User1 delete HTTP 401 | ℹ️ | **Expected.** Test 14 (Logout) invalidates User1's token, so cleanup DELETE with that token returns 401. User2 is still deleted (204). | No action. Message now says "token invalid (logged out in Test 14)". Next run uses new emails so no 409. |
| Search listings HTTP 504 / Shopping H3 404 / gRPC Test 4 curl 28 / analytics DB timeout (intermittent) | ⚠️ | **Readiness window:** Tests start before deployments (or DB pools) are ready after rotation/restart. | run-all runs `./scripts/ensure-readiness-before-suites.sh` before suites (rollout status + 8s grace). If running a single suite after rotation, run that script first or set READINESS_GRACE_SECONDS=8 and wait for api-gateway, listings, shopping, analytics, auth. TLS Test 4 warms up with _caddy/healthz + sleep 3. Analytics has DB_POOL_MAX=30, connect_timeout=10. |

**Follow-ups (product / infra):** (1) **Checkout → records DB:** Checked-out item should write to records DB (collection) immediately; implement in checkout flow. (2) **Resell always resellable:** If items should stay resellable after one resell, adjust resell route so `mark_as_resold` does not set `resellable = FALSE`, or add a separate "resell again" path.

---

## Enhanced + adversarial

| Item | Severity | Cause | Action |
|------|----------|--------|--------|
| Social health check via HTTP/3 returned 503 | ⚠️ | messaging-plane `/healthz` returns 503 when DB disconnected or health timeout (2–3s) | Check social DB (port 5434); see **docs/SERVICE_BY_SERVICE_TEST_DEBUG.md** "Social HTTP/3 Health Check — 503". Script now retries once after 3s. |
| Auction Monitor health via HTTP/3 returned 401 | ✅ | Endpoint requires authentication | Expected; 401 = correct auth enforcement. Suite treats 401 as OK. |
| gRPC Envoy (plaintext): not OK | ⚠️ | NodePort 30000/30001 not exposed to host (Colima/k3d) | Expected; primary path is strict TLS/mTLS via port-forward. |
| gRPC Envoy (strict TLS/mTLS): not OK | ⚠️ | Same: Envoy not on host 127.0.0.1:30000/30001 | On Colima, use port-forward to Envoy pod + grpcurl to local port (see grpc-http3-health.sh). |
| gRPC port-forward (mTLS): OK | ✅ | Host port-forward to auth pod works | This is the intended gRPC path when NodePort isn’t exposed. |
| Service may have issues with malformed requests | ⚠️ | Old test sent raw TCP to HTTPS port (no TLS) | Fixed: test now uses TLS + invalid JSON; expect 400/422. Re-run to confirm. |
| Adversarial Test 5 (malformed) | ✅ | Now uses invalid JSON over TLS | Should pass after fix. |
| tcpdump Killed: 9 | ℹ️ | Capture stopped (SIGKILL) when script exits | Normal; pcaps are copied before exit. |
| UDP 443: 0 in packet analysis | ℹ️ | QUIC traffic not seen in capture (different interface or capture stopped early) | On Colima, QUIC may use a different path; set CAPTURE_WARMUP_SECONDS=4; ensure caddy-h3 exposes UDP 443. |
| Auth schema check failed (enhanced suite) | ✅ | Enhanced script was checking 5437 with database "records"; auth DB name is "auth" | Fixed: enhanced script now checks -d auth first, then -d records. |
| Connection flood / malformed | ✅ | Adversarial Test 5: malformed (oversized header, invalid method, garbage body). Test 6: connection flood via k6 (k6-reads.js 15s). xk6 HTTP/3 phases: run `run-k6-http3-phases.sh` or K6_HTTP3=1 K6_HTTP3_PHASES=1. |

---

## Reissue / CA + leaf rotation (preflight 3a)

| Item | Severity | Cause | Action |
|------|----------|--------|--------|
| Reissue exits 107 or other non-zero | ⚠️ | API overload, tunnel drop, or child killed | Retry; use REISSUE_STEP2_VIA_SSH=1 (Colima). If persistent: colima-forward-6443.sh then re-run. |
| REISSUE_CAP exceeded | ⚠️ | Reissue took longer than cap | Increase REISSUE_CAP or reduce load. |

---

## Rotation suite (5/8)

| Item | Severity | Cause | Action |
|------|----------|--------|--------|
| Admin API reload not available (Caddy 400) | ⚠️ | Script used wrong endpoint (`/config/reload`) | **Fixed:** use Caddy 2 API: GET `/config/` then POST `/load` with `Cache-Control: must-revalidate`. |
| Caddy reload via rolling restart (fallback) | ℹ️ | Admin reload failed or not tried | After fix, hot reload should work; else rollout is ~180s. |
| Rotation “took a long time” | ℹ️ | Caddy rollout + 9 deployment rollouts + k6 chaos (e.g. 180s × up to 30 iterations) | Reduce `K6_DURATION` or max iterations for faster feedback; CA+leaf gen is already parallel. |
| k6 chaos job timeout 660s | ℹ️ | Job duration 180s + buffer | Normal; iteration can be reduced via env. |
| http_req_failed: rate=0.00 passes=0 fails=N; h3_latency threshold crossed; "Timeout errors detected" | ⚠️ | **Stale QUIC session** during rotation (cert reload invalidates connection, client keeps using dead session → 15s timeout). Not packet loss or MetalLB. | **rotation-suite.sh** now: `K6_HTTP3_NO_REUSE=1`, `ROTATION_GRACE_SECONDS=8`, then **ROTATION_H3_WARMUP=5** (5× HTTP/3 health to clear stale QUIC) before chaos. Caddyfile `grace_period 15s` / `shutdown_delay 10s` drain QUIC on reload. Set `ROTATION_H3_WARMUP=0` to skip. Standalone: `export K6_HTTP3_NO_REUSE=1 ROTATION_H2_KEYLOG=0; ./scripts/rotation-suite.sh`. |
| H2: 100% failures but http_req_failed=0, checks pass | ℹ️ | **Harness logic:** k6 custom metric `h2_fail` was counting client timeouts (status=0) as failures; HTTP layer can still be healthy. | **Fixed:** `h2_fail` now only counts real HTTP errors (4xx/5xx). Timeouts still recorded in `h2_timeout`. Rotation threshold is on `h2_fail` rate so timeouts no longer fail the suite. |
| Caddy in-cluster did not return 200 (got empty) | ⚠️ | DNS/kube-proxy churn: ephemeral curl pod hit Service before endpoints updated after restart. | **Fixed:** test-lb-coordinated.sh waits for `condition=ready` on caddy-h3 pods, then curls **ClusterIP** directly (no DNS). |
| Packet capture empty / no QUIC in pcap | ℹ️ | Capture started after k6 traffic or buffer too small. | Rotation uses `-B 8192 -s 256` and **CAPTURE_WARMUP_SECONDS=4** (sleep after starting tcpdump, before k6). |

### What went wrong compared to last run (rotation)

When rotation **regresses** (worked before, fails now), check these first:

1. **Caddy HTTP/3 health: curl (60) SSL certificate problem: self signed certificate in certificate chain**
   - **Cause:** The **host** health check (strict_http3_curl) did not use the **correct** CA that signed the leaf. Common causes: (a) harness used mkcert CA instead of dev-root-ca after rotation; (b) harness ran from a different cwd and relative path `certs/dev-root.pem` was wrong; (c) tests run inside Colima VM/pod where `certs/dev-root.pem` does not exist.
   - **Fix (harness):** Scripts now use **absolute path** `$REPO_ROOT/certs/dev-root.pem` and prefer it over mkcert (since mkcert CA does not match after rotation). Priority: K8s secret → `certs/dev-root.pem` → mkcert → `/tmp/grpc-certs/ca.crt`.
   - **Debug:** Set `CA_DEBUG=1` before running the suite to see `pwd`, `REPO_ROOT`, and `ls -l certs/dev-root.pem` when CA resolution fails.
   - **If it still fails:** Ensure `certs/dev-root.pem` exists and has the same fingerprint as K8s `dev-root-ca`. Run `kubectl -n ingress-nginx get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' | base64 -d | openssl x509 -noout -fingerprint -sha256` and compare with `openssl x509 -in certs/dev-root.pem -noout -fingerprint -sha256`.

2. **k6 result file is missing or empty / Total Requests: 0 / exit 99**
   - **Cause:** Not TLS broken—crypto is correct (ALPN h2, QUIC verified). The failure is **orchestration-level**: k6 exits **before** the execution loop. Root causes: (a) **CA ConfigMap mismatch**—after rotation, `k6-ca-cert` still has OLD CA, so k6 fails TLS handshake immediately (x509 unknown authority) and never sends requests; (b) CA mount path/subPath wrong; (c) ConfigMap not created/updated before Job starts.
   - **Check:** `kubectl -n k6-load logs job/k6-chaos-<id>` — look for `FATAL: CA file...`, `x509: certificate signed by unknown authority`, or `Total Requests: 0`. `kubectl -n k6-load get configmap k6-ca-cert -o yaml` — verify `ca.crt` exists and matches the **new** CA (after rotation). `kubectl describe pod -l job-name=k6-chaos-<id>` — verify volumeMounts and `SSL_CERT_FILE=/etc/ssl/certs/ca.crt`.
   - **Fixes applied:** (1) `run-k6-chaos.sh` **pre-flights** ConfigMap: exits 1 with clear message if `k6-ca-cert` missing or `ca.crt` not valid PEM; (2) entrypoint validates CA file (ls, test -s, grep BEGIN CERTIFICATE) before k6; exit 98 = CA/mount, 99 = k6/script. (3) **Caller must** update `k6-ca-cert` from **certs/dev-root.pem** (the rotated CA) before starting the Job.
   - **NodePort vs LB for QUIC health:** Do NOT switch to `127.0.0.1:32695` for HTTP/3 health; UDP NodePort on Colima is unreliable. Keep using MetalLB LB IP (e.g. `https://record.local:443` or `192.168.64.240:443`) for QUIC/HTTP/3.

3. **Foreign key integrity: N violations**
   - **Cause:** Rotation/chaos creates records referencing users; `auth.users` may be empty or reset mid-test (e.g. rotation restarts services, baseline cleanup wipes users). FK violations = records.records referencing non-existent auth.users. **Not TLS**—DB lifecycle ordering.
   - **Fix:** (a) Ensure test users are (re)created before record writes in rotation flow; (b) add cleanup step: delete records before users, or run `ensure-*` migrations before chaos; (c) optionally disable FK verify for rotation-only runs. See `docs/IDEAS_FOR_TABLES.md` and schema migrations.

---

## Caddy admin API (rotation)

- **Caddy 2** does not have `POST /config/reload`.
- **Correct:** `GET http://localhost:2019/config/` then `POST http://localhost:2019/load` with that JSON and header `Cache-Control: must-revalidate` to force a reload (e.g. re-read certs).
- Admin is bound to `localhost:2019` in the Caddyfile; rotation script uses port-forward so curl hits 127.0.0.1:2019.

---

## gRPC Envoy (plaintext vs strict TLS)

- **Plaintext:** Envoy listens on TLS (e.g. 30000/30001 with strict TLS to backends). Plaintext grpcurl to 127.0.0.1:30000 fails by design when NodePort is not exposed or when Envoy requires TLS.
- **Strict TLS/mTLS:** Same ports; if the host cannot reach NodePort (e.g. Colima), grpcurl to 127.0.0.1:30000 will fail. **Primary path:** port-forward to a gRPC pod (e.g. auth) and grpcurl with CA/certs to 127.0.0.1:50051.
- To **pass “gRPC Envoy (strict TLS)” on Colima:** add a port-forward to the Envoy pod and run grpcurl inside the VM (or to the forwarded host port) with `-cacert` / mTLS; see `scripts/lib/grpc-http3-health.sh`.

---

## Preflight / HTTP/3 / strict TLS

- **Port-forward vs Envoy:** Envoy works but “the other” strict TLS setup fails — ensure both (1) **Caddy strict TLS** (verify-caddy-strict-tls.sh or in-cluster) and (2) **port-forward + grpcurl** for gRPC strict TLS when NodePort isn’t exposed. Preflight step 5 runs `ensure-strict-tls-mtls-preflight.sh`; if missing, see **docs/PREFLIGHT_TROUBLESHOOTING.md**.
- **HTTP/3 curl 55:** Send failure (UDP path). Set `NGTCP2_ENABLE_GSO=0`; run `setup-lb-ip-host-access.sh` / `fix-http3-lb-ip-reset.sh`; ensure UDP NodePort 30443 is published. See **docs/HTTP3-CURL-EXIT-CODES.md**.
- **HTTP/3 curl 28 (especially Records):** Timeout. Records service (Test 16b) may be cold; baseline uses longer timeout + retry. See **docs/PREFLIGHT_TROUBLESHOOTING.md** and **docs/RCA-HTTP3-CURL-EXIT-28.md**.

---

## Shopping

- **Duplicate key `orders_order_number_key` (Test 13c):** The shopping service uses database **shopping** on port 5436. Migration **09** was updated: regex now uses POSIX `[0-9]` (not `\d`) so all `ORD-YYYY-NNNN+` order numbers are counted, and a re-sync step sets the sequence above the current max. **Preflight** runs `ensure-shopping-order-number-sequence.sh` (step 3b4); the ensure script also runs an explicit `setval` to the current max after applying 09. If 13c still fails after preflight, run **once**: `scripts/ensure-shopping-order-number-sequence.sh` (with Postgres on 5436 up). Then re-run the baseline suite. 13e and 13h skip when 13c fails (no ORDER_ID/PURCHASE_ID); fixing 13c fixes the cascade.

---

## Speed and timeouts

- **k3d:** `run-all-test-suites.sh` uses shorter API server wait on k3d (ENSURE_CAP=90, API_SERVER_SLEEP=2, fewer attempts). Override with `ENSURE_CAP`, `API_SERVER_SLEEP`, `API_SERVER_MAX_ATTEMPTS` if needed.
- **Per-suite timeout:** Set `SUITE_TIMEOUT` (seconds) to cap auth, baseline, adversarial, rotation, etc. Set `ENHANCED_SUITE_TIMEOUT` to cap the enhanced suite only. Default 0 = no cap. If enhanced runs too long, set `ENHANCED_SUITE_TIMEOUT=600` (10 min) or use `CAPTURE_SKIP_PER_TEST=1` (see next).
- **Enhanced suite (bottleneck):** Enhanced runs 14 per-test packet captures; each installs tcpdump in 2 Caddy + 1 Envoy (up to 25s per pod). Set `CAPTURE_SKIP_PER_TEST=1` to use only global capture—much faster. Optional: `CAPTURE_PER_TEST_INSTALL_WAIT=15`.
- **Packet capture drain:** Baseline/enhanced use `CAPTURE_DRAIN_SECONDS=5` before stopping tcpdump (to capture in-flight HTTP/3). Set `CAPTURE_DRAIN_SECONDS=0` for faster runs if you don’t need wire verification.
- **Rotation wire capture:** Chaos k6 hits `/_caddy/healthz` only (no gRPC). HTTP/2 frames are TLS-encrypted; tshark `http2` filter = 0 without SSLKEYLOGFILE. **ALPN h2** in Client Hello = definitive HTTP/2 intent. Set `ROTATION_WIRE_VERBOSE=1` for per-pcap counts. Envoy pcap ~24B is expected (no gRPC in chaos load).
- **Capture timing and ALPN proof:** Global capture starts at the beginning of the enhanced suite (all Caddy + Envoy pods). With `CAPTURE_SKIP_PER_TEST=1`, per-test capture is skipped so tests don’t wait on tcpdump install. **ALPN h2 proof:** tshark checks `tls.handshake.extensions_alpn_str` (and fallbacks) for "h2" in the Client Hello—this is **on-the-wire proof** and does **not** require TLS decryption. For **HTTP/2 frame-level proof** (decrypted frames), set `SSLKEYLOGFILE` when running curl/k6 and pass that keylog to tshark (`-o tls.keylog_file:...`); the enhanced script does this where `H2_KEYLOG` is set (e.g. test1-register-http2).
- **Stale processes:** At start, run-all kills stale pipeline/suite/capture processes (run-all, rotation, k6, kubectl wait, kubectl exec tcpdump, tcpdump -i any) via `find-and-kill-idle-then-run-pipeline.sh` with KILL_ONLY=1 so previous runs don’t slow or confuse the current run.
- **Preflight / full run:** `run-preflight-scale-and-all-suites.sh`: set `RUN_FULL_LOAD=0` to skip pgbench and k6 and run only test suites (faster feedback). Shopping order_number sequence is **applied in preflight** (step 3b4) so Test 13c passes; no need for `RUN_SHOPPING_SEQUENCE=1` when running full preflight.
- **Rotation suite k6 job:** If “Waiting for job k6-chaos-… to complete (timeout 660s)” times out, the job may need more than 11 min (e.g. high rate + many iterations). Defaults: **K6_DURATION=90s**, **K6_MAX_ITERATIONS=12**. Total time is printed at end. For full run use `K6_DURATION=180s K6_MAX_ITERATIONS=30`. Set `K6_JOB_MAX_TIMEOUT_SEC=780` (or 900) if the k6 job wait times out.

---

## Pod health (preflight step 6)

| Item | Severity | Cause | Action |
|------|----------|--------|--------|
| nginx-exporter 0/1 | ⚠️ | Exporter pod not ready (image pull, probe, or dependency) | **Fixed:** nginx-exporter deploy now has an init container that waits for `nginx:8080/nginx_status` (up to 60s) and readiness/liveness on `/metrics`, so it should be consistently ready after nginx is up. If still 0/1, ensure nginx pod is Running and exposes `/nginx_status`. |

---

## k6 and TLS (x509: certificate signed by unknown authority)

- **Cause:** k6 (Go) must trust the dev-root CA to verify `record.local`. On **Linux** it uses `SSL_CERT_FILE`; on **macOS** Go ignores that and uses the Keychain instead.
- **One canonical cert:** The CA for `record.local` is **`certs/dev-root.pem`** (repo root). Scripts prefer this file first so k6 always uses the same cert (avoids x509 errors). Rotation and adversarial sync or write the CA there when they have it.
- **Linux:** `run-k6-chaos.sh local` sets `SSL_CERT_FILE` to `certs/dev-root.pem`; k6 trusts it.
- **macOS (local k6):** Go ignores `SSL_CERT_FILE` on Darwin. `run-k6-chaos.sh local` runs `trust-dev-root-ca-macos.sh` to add the CA to the Keychain before k6. If that fails (e.g. no TTY), run once manually: `./scripts/lib/trust-dev-root-ca-macos.sh`. Or use `ROTATION_H2_KEYLOG=0` for in-cluster k6 (no wire decryption).
- **Keychain (manual):** To trust the dev-root for all clients (browser, curl without `--cacert`, etc.): open **Keychain Access**, drag `certs/dev-root.pem` into "System" (or "login"), double-click the cert, expand **Trust**, set **"When using this certificate"** to **Always Trust**.

---

## TLS/mTLS suite (7/9)

| Item | Severity | Cause | Action |
|------|----------|--------|--------|
| Test 4: gRPC Authenticate test skipped (user registration failed) | ⚠️ | **Registration** (POST /api/auth/register) failed: curl exit non-zero (e.g. 7=connect refused, 28=timeout, 60/77=TLS) or HTTP 4xx/5xx. **HTTP 409** "email already exists" = leftover user. | **TLS:** Test 4 uses `test-tls-<ts>-<pid>@example.com`, treats 409 as success (login + gRPC), deletes user at end. **Baseline:** deletes User1/User2 at end. Run once to let cleanup run. Script now prints **Register curl exit** and **Register HTTP code** when this happens. Check: (1) TARGET_IP/LB IP reachable (Tests 1–2 passed → TLS and gRPC health OK). (2) Gateway → auth-service: 502 = gateway can’t reach auth; run `./scripts/diagnose-502-and-analytics.sh`. (3) Auth DB (5437): ensure Postgres on host and pods can reach it (host aliases). (4) One retry after 3s is done automatically; if both fail, inspect api-gateway and auth-service logs. |

---

## Coordinated LB suite (9/9): Caddy + HAProxy + MetalLB

| Item | Severity | Cause | Action |
|------|----------|--------|--------|
| HAProxy health returned 503 | ⚠️ | HAProxy backend (api-gateway:4000) has no healthy server; often **DNS resolution** (FQDN not resolved at health-check time); or transient during rotation. | **test-lb-coordinated.sh** uses a tolerant check (6+ consecutive 503 over ~30s = fail). Fix: HAProxy config must use **resolvers** so the api-gateway FQDN is resolved at runtime: in `infra/k8s/base/haproxy/configmap.yaml` add a `resolvers k8s` block (nameserver 10.43.0.10:53 for k3s CoreDNS) and set `server api ... resolvers k8s`. Then `kubectl apply -k infra/k8s/base/haproxy` and `kubectl -n record-platform rollout restart deploy/haproxy`. **Diagnose:** run a one-off curl pod (HAProxy image has no curl): `kubectl run curl-diagnose --rm -i --restart=Never -n record-platform --image=curlimages/curl:latest -- curl -s -o /dev/null -w '%{http_code}' http://api-gateway.record-platform.svc.cluster.local:4000/healthz` — 200 = backend OK (HAProxy needs resolvers); 404 = wrong path; 000 = unreachable. |
| Caddy in-cluster returned "curl: executable file not found" | ⚠️ | (Fixed) `test-lb-coordinated.sh` now uses a one-off `curlimages/curl` pod (same as HAProxy check), not `kubectl exec` into api-gateway. | If you still see this from another script, that script should use `kubectl run ... --image=curlimages/curl:latest -- curl ...` instead of exec'ing into a pod that lacks curl. |
| MetalLB verification had issues | ℹ️ | L2/speaker or LB IP not ready | Run `./scripts/verify-metallb-and-traffic-policy.sh` standalone; see **scripts/SUITES_AND_METALLB.md**. |

---

## Social suite: GET /messages/groups failed

| Item | Severity | Cause | Action |
|------|----------|--------|--------|
| List groups failed (non-200) | ⚠️ | (1) Request went to wrong host (e.g. 127.0.0.1 when using LB IP), or (2) messaging-service DB/query error (500) | When running after run-all with LB IP, the script now uses `TARGET_IP`/`REACHABLE_LB_IP` for `--resolve` and PORT=443. If still failing: check response body (script prints first 300 chars on first failure); if 500, check messaging-service logs and messages.groups / group_members tables. |

---

## Quick checklist

1. **Preflight / run-all:** Preflight applies shopping order_number sequence (step 3b4). If you run suites without preflight and 13c fails, run `scripts/ensure-shopping-order-number-sequence.sh` once or set `RUN_SHOPPING_SEQUENCE=1`.
2. **Auth:** Optional features (email, OAuth, full MFA/passkey) can warn; basic auth must pass.
3. **Baseline:** Envoy gRPC on host is optional; port-forward gRPC is the main path.
4. **Rotation:** Caddy hot reload uses POST `/load`; fallback is rolling restart.
5. **Malformed (adversarial 5):** Now uses TLS + invalid JSON; expect 400/422.

---

## Adding tests

- **Malformed:** More cases (e.g. huge body, invalid UTF-8, wrong Content-Type).
- **Adversarial:** More extreme (e.g. higher connection flood, longer stress, timeout handling).
- **gRPC:** On Colima, add Envoy port-forward + grpcurl so “gRPC Envoy (strict TLS)” can pass when NodePort isn’t exposed.
