# Suite and Preflight Slowdown Audit

This doc lists **known slow points** in preflight and test suites, **tunables** to speed runs or diagnose slowness, and **how to use telemetry** to see where time is spent.

## 1. Finding where time is spent

### Preflight phase timestamps (telemetry log)

When `PREFLIGHT_TELEMETRY=1` (default), the script appends **phase markers** to `telemetry-during-<ts>.log` in the repo root. Each line looks like:

```text
phase=3c0a_k3d_registry_push start_ts=1739123456 iso=2025-02-10T12:30:56Z
```

**How to use:**  
Open `telemetry-during-<ts>.log` and look at the **gaps between `start_ts` values** (or between `phase=...` and the next `===` metrics block). The biggest gaps are the slowest steps.

**Phase names you’ll see:**

| Phase | Step |
|-------|------|
| `telemetry_start` | After step 0 (kill stale) |
| `0_kill_stale` | Kill stale pipeline/test processes |
| `3_ensure_api` | ensure-api-server-ready (API check) |
| `3c_apply_app_config` | Apply config, kafka-external, nginx, social, etc. |
| `3c0a_k3d_registry_push` | k3d: build/push :dev images + patch deployments (includes **node restart**) |
| `3c0b_k3d_api_stabilize` | k3d: wait for API to stabilize after node restart (up to **7.5 min** by default) |
| `4_scale_baseline` | Scale to baseline (1 replica per app, Caddy 2) |
| `5_strict_tls_mtls` | Strict TLS/mTLS preflight |
| `6_pod_health_db_redis` | Pod health, DB, Redis, TLS checks |
| `7_run_all_suites` | run-all-test-suites (auth, baseline, enhanced, …) |

### Metrics in the same log

Between phase lines, the telemetry loop appends apiserver metrics every 8s. If you see long stretches of `(metrics unavailable)` or very high `apiserver_current_inflight_*`, the control plane was under load or unreachable during that window.

---

## 2. Preflight slow points and tunables

| Step | What can be slow | Tunables / notes |
|------|------------------|-------------------|
| **3. Ensure API** | Many attempts × sleep; Colima cold start | `ENSURE_CAP=120` to fail faster. k3d default 180s, Colima 480s. `API_SERVER_SLEEP=2` (default 3) to retry a bit quicker. |
| **3c0a. k3d registry push** | Docker build (e.g. envoy-with-tcpdump), push, **node restart** | Build images beforehand so only push runs. `K3D_SKIP_NODE_RESTART=1` avoids restart but pulls may fail (HTTPS) until nodes use `registries.yaml`. |
| **3c0b. k3d API stabilize** | Waits up to **7.5 min** (90 × 5s slots) for 3 consecutive `kubectl get nodes` OK | `PREFLIGHT_K3D_API_STABILIZE_SLOTS=24` (~2 min). If API is stable sooner, loop exits early. |
| **3c / 4** | Many `kubectl apply` / scale calls | `APPLY_RATE_LIMIT_SLEEP=1` (default 2). `PREFLIGHT_ABORT_ON_SLOW_APPLY=1` aborts if a single apply takes >10s. |
| **5z** | Fixed **90s** wait for gRPC readiness | No env toggle; reduces flaky gRPC tests later. |
| **6b** | Wait for all services ready | Per-service timeout (e.g. 30s); total time depends on pod startup. |

---

## 3. Test suite (baseline / enhanced) slow points

These are inside `scripts/test-microservices-http2-http3.sh` and `run-all-test-suites.sh`.

| Area | What can be slow | Tunables / notes |
|------|------------------|-------------------|
| **Packet capture start** | tcpdump install in pods (Caddy, Envoy); default install timeout 60s | `CAPTURE_STOP_TIMEOUT` set → install timeout 35s. Envoy needs custom image with tcpdump (envoy-with-tcpdump) or capture skips Envoy. |
| **Packet capture stop** | stop_and_analyze_captures (drain, copy, tshark) | `CAPTURE_STOP_TIMEOUT=30` (default when run from run-all) → quick stop, no full analysis. Omit it for full pcap/tshark (slower). |
| **gRPC (Test 15)** | Envoy NodePort probe (multiple ports × timeout); port-forward + grpcurl per service; strict TLS cap | `_grpc_test_with_cap` 45s per test. Colima: strict TLS cap 25s per service. `GRPC_STRICT_CAP=30` if strict TLS often times out. |
| **HTTP/3** | QUIC handshake and timeouts (e.g. 12s, 60s for some calls) | Retries and `--max-time` add up; especially on Colima/slow network. |
| **DB verification** | Three `psql` calls (records, social, listings) | Usually &lt;5s total; if DB is remote or overloaded, this can spike. |
| **run-all suites order** | auth → baseline → enhanced → … → social; each suite runs sequentially | `SUITE_TIMEOUT` / `ENHANCED_SUITE_TIMEOUT` cap duration; suite exits when cap hit. |

---

## 4. Colima vs k3d

- **Colima:** API and port-forward can be slower; grpcurl via `colima ssh` adds latency. Strict TLS timeout is increased (25s) automatically; you can set `GRPC_STRICT_CAP=30` if needed.
- **k3d:** 3c0a triggers a **node restart** (to pick up registry config); 3c0b then waits for API stabilize. This pair is often the largest single delay in preflight. Reducing `PREFLIGHT_K3D_API_STABILIZE_SLOTS` shortens the worst case; ensure API is actually stable before continuing.

---

## 5. Quick checks when things feel slow

1. **Inspect phase timestamps**  
   Open `telemetry-during-<ts>.log` and look for `phase=... start_ts=...`. Compute deltas between consecutive phases; the largest delta is the slow step.

2. **Preflight only (no suites)**  
   Run with `RUN_SUITES=0` to see preflight duration without suite time.

3. **Shorter k3d stabilize**  
   If API is usually stable within 2 minutes, set `PREFLIGHT_K3D_API_STABILIZE_SLOTS=24` before preflight.

4. **Skip full preflight**  
   For repeated suite-only runs, use `SKIP_FULL_PREFLIGHT=1` when calling run-all (cluster already up and preflighted).

5. **Telemetry off**  
   `PREFLIGHT_TELEMETRY=0` avoids the 8s metrics loop and a bit of I/O; phase markers won’t be written.

---

## 6. Envoy + tcpdump (packet capture)

If the **envoy-with-tcpdump** image build fails (e.g. distroless base), the script falls back to the official Envoy image and **skips** tcpdump capture on the Envoy pod. To fix:

- The Dockerfile at `docker/envoy-with-tcpdump/Dockerfile` uses a **multi-stage** build: copy the Envoy binary from the official image into Ubuntu and install tcpdump. If build still fails, check the last 15 lines of the build log (printed by the script) or the full log path it prints.
- Force a rebuild with `BUILD_ENVOY_TCPDUMP=1` when running the registry push step.
- With a working envoy-with-tcpdump image, the Envoy deployment is patched to use it so that packet capture can run tcpdump in the Envoy pod.
