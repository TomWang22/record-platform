# Rotation suite: dependencies and flow

What `scripts/rotation-suite.sh` needs and why the k6 wait can take up to **570 seconds**.

---

## What’s going on during “Waiting for job … (timeout 570s)”

1. The suite starts a **Kubernetes Job** in namespace `k6-load` that runs k6 for **90s** at 500 req/s (H2 + H3) against Caddy with strict TLS.
2. It then runs **`kubectl wait --for=condition=complete job/… --timeout=570s`**. The job can take **longer than 90s** to reach “Complete” because k6 must finish in-flight requests, aggregate metrics, and exit (observed 600s+ at high rate).
3. **Progress:** With `ROTATION_K6_WAIT_PROGRESS=1` (default), you get a status line at **0s** and then every **60s**: job Complete/Failed/succeeded/failed and pod phase. So you see what’s going on without waiting the full 570s blind.
4. **Compare to last commit:**  
   `git log -1 --oneline -- scripts/rotation-suite.sh`  
   `git diff HEAD -- scripts/rotation-suite.sh`

---

## Why in-cluster k6 (ROTATION_MODE=cluster, default)

On macOS + Colima, **host→VM UDP** is unstable under load: QUIC packets are dropped or stalled at the VM NAT, so host-based k6 HTTP/3 often shows 0% success and ~15s timeouts. **In-cluster** k6 (Pod → Caddy ClusterIP) removes the host from the path so rotation suite passes reliably. Keep **ROTATION_MODE=cluster** (default). Use **ROTATION_H2_KEYLOG=1** only when you need SSLKEYLOGFILE for wire decryption (it forces host mode).

---

## Script and lib dependencies

| Dependency | Role |
|------------|------|
| **scripts/run-k6-chaos.sh** | Start k6 Job, wait for completion, collect logs. Uses `kubectl` (or `colima ssh -- kubectl` on Colima). |
| **scripts/k6-chaos-test.js** | k6 script: H2 + H3 constant-arrival-rate load against Caddy; strict TLS via `SSL_CERT_FILE`. Packaged as ConfigMap `k6-chaos-script`. |
| **scripts/build-k6-image.sh** | Builds `k6-custom:latest` (used by run-k6-chaos.sh if image missing). |
| **scripts/ensure-api-server-ready.sh** | Pre-flight: wait for API server before any kubectl. |
| **scripts/verify-k6-database.sh** | Post-k6 DB connectivity and integrity checks. |
| **scripts/verify-k6-protocols.sh** | Wire-level protocol verification from pcaps. |
| **scripts/kafka-ssl-from-dev-root.sh** | Optional: regenerate Kafka TLS from dev-root CA when `ROTATION_UPDATE_KAFKA_SSL=1`. |
| **scripts/lib/ensure-kubectl-shim.sh** | Ensures kubectl shim in PATH (avoids API timeouts). |
| **scripts/lib/test-log.sh** | `say`, `ok`, `warn`, `log_info`, `fail`. |
| **scripts/lib/kubectl-helper.sh** | `kctl` wrapper (timeouts, Colima). |
| **scripts/lib/protocol-verification.sh** | Protocol checks (HTTP/2, QUIC) in pcaps. |
| **scripts/lib/http3.sh** | `http3_curl`, HTTP/3 detection. |
| **scripts/lib/grpc-http3-health.sh** | Post-rotation health: Caddy HTTP/3, gRPC Envoy, port-forward. |
| **scripts/shims/kubectl** | Optional shim so kubectl runs in cluster context (e.g. Colima). |

---

## External tools

- **kubectl** (or via Colima: `colima ssh -- kubectl`)
- **openssl** (CA/leaf generation when `ROTATE_CA` / `ROTATE_LEAF`)
- **mkcert** (when `ROTATE_LEAF` only)
- **curl** (Caddy admin API, health)
- **docker** (optional: build k6 image; HTTP/3 health when using container runner)
- **tshark** (optional: wire verification)
- **scripts/dump-postgres-tuning-context.sh** (optional): dumps Postgres version, key GUCs, and table sizes to `bench_logs/postgres-tuning-context-<timestamp>.log` for TPS/tuning analysis (e.g. for a Postgres GPT or runbook).

---

## Kubernetes resources the suite expects

- **Namespaces:** `ingress-nginx`, `record-platform`, `k6-load`
- **Secrets (ingress-nginx):** `record-local-tls`, `dev-root-ca`
- **Secrets (record-platform):** `record-local-tls`, `service-tls`, `dev-root-ca`
- **Service:** `caddy-h3` in `ingress-nginx` (NodePort 30443 for host health)
- **ConfigMaps (k6-load):** `k6-ca-cert` (CA for strict TLS), `k6-chaos-script` (test script)

The suite **creates/updates** `k6-ca-cert` and the k6 Job in `k6-load` before each chaos iteration.

---

## k3d and strict TLS / mTLS

The suite is used on **k3d** (e.g. 2-node cluster from `scripts/k3d-create-2-node-cluster.sh`); Colima k3s was phased out due to control-plane limits.

- **k6 image:** The job uses `image: k6-custom:latest` with `imagePullPolicy: Never`. The suite **imports** that image into the k3d cluster before starting the job (`k3d image import k6-custom:latest -c record-platform`) so the pod does not stay Pending. Build the image once with `scripts/build-k6-image.sh`.
- **Strict TLS:** k6 verifies Caddy’s certificate with the **new** CA (mounted from ConfigMap `k6-ca-cert`). If Caddy still served the **old** certificate (e.g. after hot reload that didn’t re-read the mounted secret), k6 fails with `x509: certificate signed by unknown authority`. The suite **always does a Caddy rolling restart when the leaf is rotated** so Caddy pods re-mount `record-local-tls` and serve the new cert; then k6 strict TLS succeeds.
- **Zero-downtime (CA and leaf):** Caddy is deployed with **2 replicas** and **RollingUpdate maxUnavailable=0** (`infra/k8s/caddy-h3-deploy.yaml`). So when the suite triggers a Caddy rollout after rotating the leaf, the new pod is created and becomes Ready before the old one is terminated — no downtime during CA/leaf rotation.
- **Rates and tuning:** Start at 320+180=500 req/s. Chaos test: 15s timeout, relaxed failure/latency thresholds. **Dropped iterations:** constant-arrival-rate drops when all VUs are busy (slow responses → backlog). To reduce drops: (1) pre-allocated VUs are 80 H2 + 50 H3 so workers ramp from start; (2) tune `K6_H2_PRE_VUS` / `K6_H3_PRE_VUS` if needed; (3) or lower rate. To pass rotation when drops are high but no errors: `K6_MAX_DROP_PCT=30` (default 1.5%).
- **Failure visibility:** If the k6 job fails, the suite prints the **container exit code**, last 50 lines of job logs, and writes a diagnostic dump to `/tmp/rotation-k6-debug-<job>-<timestamp>.txt` (describe job/pods + logs). For **exit 107** the suite prints actionable hints (rebuild image, check ConfigMap, see logs).
- **Total Requests: 0 / exit 99 — orchestration, not crypto:** When k6 exits with 0 requests and exit 99, TLS/crypto is usually correct. The failure is **orchestration**: k6 dies before the execution loop. Cause: `k6-ca-cert` has the **old** CA while Caddy serves the **new** leaf; k6 fails TLS handshake immediately. **Fix:** Update `k6-ca-cert` from `certs/dev-root.pem` after rotation, before starting the Job. `run-k6-chaos.sh` now pre-flights the ConfigMap.

---

## Exit 107 and jslib (script exception)

**Exit 107** means k6 hit a **script exception at load/init** (the script never ran). Common causes:

1. **Remote import failed:** The script used to import `textSummary` from `https://jslib.k6.io/k6-summary/0.0.2/index.js`. In-cluster pods often have **no egress** to the internet, so that fetch fails → exit 107.
2. **Fix in this repo:** The chaos script (**`scripts/k6-chaos-test.js`**) uses an **inline summary** only (no jslib import). So the script loads without any network; 107 from “jslib fetch failed” should not occur.
3. **If you still see 107:** (a) Rebuild the k6 image so it includes the **xk6-http3** extension: `./scripts/build-k6-image.sh`. (b) Ensure the **k6-ca-cert** ConfigMap exists in `k6-load` (suite creates it from `CA_ROOT`). (c) The job now fails fast at start if `ca.crt` is missing or empty (FATAL message in logs). (d) Memory limit is 1Gi to avoid OOM; if still OOM, raise in `run-k6-chaos.sh` (resources.limits.memory). (e) Check the printed logs for the exact GoError/hint (e.g. missing module, TLS, or file).
4. **Using jslib:** Set **`K6_USE_JSLIB=1`** when starting the chaos job so **`scripts/run-k6-chaos.sh`** uses **`k6-chaos-test-jslib.js`** (imports `textSummary` from jslib.k6.io). Requires **egress to jslib.k6.io** from the pod (or run k6 on host). Default remains inline summary (no egress). Example: `K6_USE_JSLIB=1 ./scripts/run-k6-chaos.sh start`

---

## Why the k6 job wait is up to 570 seconds

1. **k6 run length:** The chaos job runs with **duration = 90s** by default (`K6_DURATION=90s`). So the script asks for 90s of load (H2 + H3 at 320 + 180 req/s).

2. **Why wait longer than 90s?** After the 90s scenario, k6 still has to:
   - Finish in-flight requests and timeouts
   - Aggregate metrics and print summary
   - Exit the process

   At 500 req/s, with possible drops and connection churn, the **pod** can take well beyond 90s to reach "Complete". Observed runs have been ~600s+ when there are many dropped iterations.

3. **How the timeout is computed (in rotation-suite.sh):**
   - Base: `K6_TIMEOUT_SEC = DURATION_SEC + 60` (e.g. 90 + 60 = 150s).
   - For **TOTAL_RATE >= 400** (e.g. 320+180=500): add 480s → **90 + 480 = 570s**.
   - Cap: `K6_JOB_MAX_TIMEOUT_SEC` (default 660). So we **wait up to 570s** for the Job condition `complete`.

4. **What happens during those 570s:** The suite runs:
   ```bash
   scripts/run-k6-chaos.sh wait "$JOB" "570s"
   ```
   which does:
   ```bash
   kubectl -n k6-load wait --for=condition=complete "job/$JOB" --timeout=570s
   ```
   So the script is **blocked** on the Job completing (or 570s). There is no output until the job completes or the wait times out, unless you add progress (see below).

---

## Optional: see what’s going on during the wait

To see progress while waiting, you can in another terminal:

- **Job status:**  
  `kubectl -n k6-load get job -l job-name=k6-chaos-<id>`  
  or  
  `kubectl -n k6-load get job k6-chaos-<id> -o wide`
- **Pod status:**  
  `kubectl -n k6-load get pods -l job-name=k6-chaos-<id>`
- **Live k6 output:**  
  `kubectl -n k6-load logs -f job/k6-chaos-<id>`

The suite prints job/pod status every 60s during the wait by default. Set `ROTATION_K6_WAIT_PROGRESS=0` to disable.

---

## Dashboard (8 charts)

After the suite runs, open **`scripts/rotation-dashboard.html`** in a browser and load the **`rotation-summary.json`** file (e.g. under `/tmp/rotation-wire-*/rotation-summary.json`). The dashboard renders **8 charts**:

1. **Chart 1–3:** Phase 1 / 2 / 3 latency (avg, p50, p95, p99) — H2 vs H3 bar chart per phase.
2. **Chart 4:** Throughput by phase (req/s) — Phase 1 baseline, Phase 2 max no drop, Phase 3 max no error.
3. **Chart 5:** Little's Law (L = λ × W) — average in-flight requests by phase.
4. **Chart 6:** Limits — max combined req/s without error and max without drop (H2 + H3 stacked).
5. **Chart 7:** Max iteration before drop / before H2 error / before H3 error (iteration at which drop or error first occurred).
6. **Chart 8:** Latency percentiles (p95 through p99.99999, p100) — H2 vs H3; Little's Law; telemetry placeholders (queue_saturation, cpu_pinned; run strace/htop/perf/valgrind for live data).

The suite writes `phase1`, `phase2`, `phase3`, `limits` (including `iter_at_first_drop`, `iter_at_first_h2_error`, `iter_at_first_h3_error`), and `telemetry` into the combined JSON so all 8 charts are populated.

---

## Env vars that affect the suite

| Variable | Default | Effect |
|----------|--------|--------|
| `HOST` | record.local | Host for TLS SNI and health URLs. |
| `K6_DURATION` | 90s | Scenario duration for the k6 chaos job. |
| `K6_H2_START_RATE` / `K6_H3_START_RATE` | 320 / 180 | Starting req/s for adaptive limit finding. |
| `K6_H2_INCREMENT` / `K6_H3_INCREMENT` | 15 / 10 | Rate increment per successful iteration (bump to reach higher limits). |
| `K6_MAX_ITERATIONS` | 35 | Max chaos iterations (more = more steps to find ceiling). |
| `K6_JOB_MAX_TIMEOUT_SEC` | 660 | Cap for wait timeout (seconds). |
| `ROTATION_HIGH_THROUGHPUT` | 0 | Set to **1** to push for higher numbers: start 380/220 req/s, +20/+15 increment, 45 iterations, higher VUs, 780s job timeout. |
| `K6_H2_PRE_VUS` / `K6_H3_PRE_VUS` | 80 / 80 | Pre-allocated VUs (increase if you see drops at high rate). |
| `K6_H2_MAX_VUS` / `K6_H3_MAX_VUS` | 300 / 250 | Max VUs (higher in high-throughput mode). |
| `ROTATION_UPDATE_KAFKA_SSL` | 0 | Set to 1 to regenerate Kafka TLS from dev-root after CA rotation. |
| `ROTATION_SKIP_KEYCHAIN_TRUST` | 0 | Set to 1 to skip adding CA to macOS keychain during the sync phase (no security prompt). run-all-test-suites.sh sets this. When running **local** k6 (ROTATION_H2_KEYLOG=1), `run-k6-chaos.sh local` still runs `trust-dev-root-ca-macos.sh` on macOS before k6 (required: Go ignores SSL_CERT_FILE on Darwin). In-cluster k6 uses ConfigMap-mounted certs/dev-root.pem. |
| `ROTATION_K6_WAIT_PROGRESS` | 1 | Set to 0 to disable progress (job/pod status every 60s during wait). |
| `ROTATION_UDP_STATS` | 1 when Colima, else 0 | Set to 1 to capture UDP stats (netstat/ss/proc) from Caddy pods and Colima VM before/after k6 load. Preflight wires this when Colima. See docs/RCA-HTTP3-QUIC-AND-METALLB-NETWORKING.md §7b. |
| `ROTATION_USE_BBR` | 1 | Set to 1 (default) so preflight runs `colima ssh -- sysctl -w net.ipv4.tcp_congestion_control=bbr` before suites (Colima only). Better H2 throughput, lower p99. Set 0 to skip. |

---

## Recent changes (context for “what changed”)

- **Canonical CA:** After updating secrets, the suite syncs the new CA to **`certs/dev-root.pem`** and uses that path for the k6 ConfigMap and for post-rotation health checks (so host curl doesn’t get “self signed certificate in certificate chain”).
- **Post-rotation health:** Health checks now **prefer** `certs/dev-root.pem` before using `CA_ROOT` or the cluster secret.
- **k6 collect:** If the result file is empty, collect stderr is logged and a path like `/tmp/rotation-k6-collect-*.err` is mentioned.
- **Progress during wait:** The suite prints job/pod status at **0s** (immediately) then every 60s while waiting (default on; set `ROTATION_K6_WAIT_PROGRESS=0` to disable).

---

## Last commit vs current (what changed)

- **Last commit on repo:** `git log -1 --oneline` (e.g. `841ca32 feat(platform): Major overhaul …`). That commit did **not** change `scripts/rotation-suite.sh`; it touched other scripts (e.g. `k6-chaos-test.js`, `lib/http3.sh`, `run_pgbench_sweep.sh`, `test-microservices-http2-http3.sh`, cleanup, load tests).
- **To see when rotation-suite.sh was last changed:**  
  `git log -1 --oneline -- scripts/rotation-suite.sh`
- **To compare current rotation-suite.sh to last committed version:**  
  `git diff HEAD -- scripts/rotation-suite.sh`
- **Why 570s is normal:** The k6 Job runs a **90s** scenario at 500 req/s (320 H2 + 180 H3). The **timeout** for `kubectl wait` is 570s (90 + 480) because at high rate k6 can take many minutes after the 90s to finish in-flight requests, aggregate metrics, and exit. So “Waiting for job … to complete (timeout 570s)” with no further output for a while means the job is still running; progress lines appear at 0s and then every 60s.
- **If you see no progress lines:** Ensure `ROTATION_K6_WAIT_PROGRESS` is not set to `0`. Default is `1` (progress on). In another terminal you can run `kubectl -n k6-load logs -f job/k6-chaos-<id>` to stream k6 output.
