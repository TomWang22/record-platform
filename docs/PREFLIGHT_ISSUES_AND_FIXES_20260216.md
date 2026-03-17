# Preflight Issues and Fixes (k3d Two-Node, DB Verification, tcpdump)

**Date:** 2026-02-16  
**Context:** Running preflight and all suites on **k3d two-node** (Colima k3s control plane was overwhelmed). Three focus areas: MetalLB suites (regular vs advanced), DB verification slowness after `test-microservices-http2-http3.sh`, and doing tcpdump installation “first”.

---

## 1. MetalLB Tests: Regular vs Advanced (k3d Two-Node)

### What exists today

- **Regular MetalLB suite:** `scripts/verify-metallb-and-traffic-policy.sh`
  - Steps: namespace, controller, speaker, IPAddressPool, L2Advertisement, all LoadBalancer services, in-cluster Caddy curl, host curl to LB IP, optional setup-lb-ip-host-access.
  - This is the “thorough” suite (steps 1–4 in the script).

- **Advanced MetalLB suite:** `scripts/verify-metallb-advanced.sh`
  - Run **from** `verify-metallb-and-traffic-policy.sh` at the end, unless `SKIP_METALLB_ADVANCED=1`.
  - Covers: BGP mode, route flaps, ARP simulation, asymmetric routing, multi-subnet failover.
  - On **k3d** the script treats the environment as “simulated L2/BGP”; **real** L2/ARP/BGP is only on Colima (see `verify-metallb-advanced.sh` and `docs/METALLB_ADVANCED.md`).

### Where it’s invoked in preflight

In `scripts/run-preflight-scale-and-all-suites.sh`:

- **Step 3c1b:** Runs `verify-metallb-and-traffic-policy.sh`.
  - If `METALLB_VERIFY_COLIMA_L2=1`: runs with **`SKIP_METALLB_ADVANCED=1`** on k3d (advanced skipped on k3d), then step **3c1c** runs `verify-metallb-colima-l2-only.sh` on Colima for real L2/BGP.
  - If `METALLB_VERIFY_COLIMA_L2=0`: runs full `verify-metallb-and-traffic-policy.sh` (which includes the advanced script at the end).

### Recommended usage on k3d two-node

- **MetalLB on k3d only (no Colima):**
  - `REQUIRE_COLIMA=0 METALLB_ENABLED=1 ./scripts/run-preflight-scale-and-all-suites.sh`
  - Regular suite runs; advanced runs in “simulated” mode (BGP/ARP etc. are checks only; no real L2).

- **Faster runs on k3d (skip advanced on k3d):**
  - Set `SKIP_METALLB_ADVANCED=1` when you don’t need BGP/route-flap/ARP/asymmetric checks on k3d:
  - Example: `METALLB_ENABLED=1 SKIP_METALLB_ADVANCED=1 ./scripts/verify-metallb-and-traffic-policy.sh`
  - Preflight does **not** set this by default on k3d unless `METALLB_VERIFY_COLIMA_L2=1`; you can set it yourself for k3d-only runs.

- **Real L2/BGP on Colima only:**
  - Keep preflight and suites on k3d; run L2 verification once on Colima:
  - `METALLB_VERIFY_COLIMA_L2=1 METALLB_ENABLED=1 REQUIRE_COLIMA=0 ./scripts/run-preflight-scale-and-all-suites.sh`
  - Preflight will run 3c1b on k3d with advanced skipped, then 3c1c on Colima (full L2/BGP).

References: `docs/METALLB_ADVANCED.md`, `docs/adr/010-k3d-primary-colima-l2-isolated.md`, `docs/PREFLIGHT_PHASES_README.md`.

---

## 2. Database Verification Taking Forever After test-microservices-http2-http3.sh

### What actually runs “right after” baseline

- In `scripts/run-all-test-suites.sh`, the **baseline** suite is `test-microservices-http2-http3.sh`.
- After **every** suite (including baseline), the script runs **`verify-db-cache-quick.sh`** (see `_run_suite` and the “Running DB & Cache verification after $suite_name…” step).
- So “database verification right after test-microservices-http2-http3” is **`verify-db-cache-quick.sh`**, run once per suite (and once at pre-flight).

### Why it might “take forever”

1. **Sequential DB connectivity (8 DBs)**  
   `verify-db-cache-quick.sh` connects to ports 5433–5440 in sequence. Each attempt uses `DB_VERIFY_CONNECT_TIMEOUT` (default **3** seconds). If a DB is slow or unreachable, each attempt can take up to 3s; 8 DBs ⇒ up to **24s** for step 1 alone.

2. **Redis / kubectl exec**  
   Redis check uses `kubectl exec` into the Redis pod. If the API server is slow or the cluster is under load (e.g. right after many suite steps), `kubectl exec` can hang or be very slow (no script-level timeout around the whole verification).

3. **Multiple psql queries**  
   Shopping cart (step 3) and social (step 4) run several `psql` calls; each can block on slow DB or connection.

4. **No overall timeout**  
   The script has no total wall-clock timeout; if one step hangs (e.g. `kubectl exec` or a stuck TCP connection), the whole verification can appear to run “forever”.

### Recommended changes

- **Add an overall timeout for the quick verification**  
  - **Done:** `verify-db-cache-quick.sh` supports `DB_VERIFY_MAX_SECONDS` (e.g. `60`). When set and `timeout` is available, the script runs under that wall-clock cap so it never blocks the pipeline indefinitely.  
  - **Done:** `run-all-test-suites.sh` exports `DB_VERIFY_MAX_SECONDS=60` by default when calling the verification. Override with `DB_VERIFY_MAX_SECONDS=0` or unset to disable the cap.

- **Keep connect timeouts short**  
  - Keep `DB_VERIFY_CONNECT_TIMEOUT=3` (or lower) so no single DB connection blocks long. Already used in the script for `PGCONNECT_TIMEOUT`.

- **Optional: run DB checks in parallel**  
  - Step 1 (8 DBs) could be run in parallel (e.g. background jobs, then wait with a cap); would shorten step 1 when several DBs are slow.

- **Optional: verify only once after all suites**  
  - If the goal is to confirm DB/cache at the end rather than after every suite, add an env (e.g. `SKIP_PER_SUITE_DB_VERIFY=1`) so `run-all-test-suites.sh` skips `verify-db-cache-quick.sh` after each suite and only runs the existing comprehensive verification at the end (`verify-db-and-cache-comprehensive.sh`). Reduces how often “right after baseline” verification runs.

- **Diagnose**  
  - On the next run, log timestamps (e.g. `date` before/after step 1, 2, 3, 4) or run with `time` to see which step is slow: DB connectivity, Redis, or shopping/social queries.

Files: `scripts/verify-db-cache-quick.sh`, `scripts/run-all-test-suites.sh` (e.g. around lines 166–178 pre-flight, 227–233 per-suite).

---

## 3. Doing tcpdump Installation “First”

### Current behavior

- **Packet capture** (baseline, enhanced, rotation, standalone) installs tcpdump **at capture start** inside each pod:
  - `scripts/lib/packet-capture.sh`: `start_capture` runs `apk add tcpdump` or `apt-get install tcpdump` in the pod, with a cap of `CAPTURE_INSTALL_TIMEOUT` (default 60s; 55s in “quick” mode when `CAPTURE_STOP_TIMEOUT` is set).
  - Same pattern in `test-microservices-http2-http3-enhanced.sh`, `rotation-suite.sh`, etc.
- If install is slow or times out, capture is skipped for that pod (Runbook #59b, #63). So “doing tcpdump first” means: **pre-install tcpdump** so capture start doesn’t wait.

### Options to “do tcpdump first”

**Option A – Pre-install in images (recommended for Caddy/Envoy)**  
- Use images that already include tcpdump:
  - **Caddy:** `docker/caddy-with-tcpdump/Dockerfile` (FROM caddy:2.8 + `RUN apk add --no-cache tcpdump`). Build and push to k3d registry, then patch the Caddy deploy:
    - e.g. `kubectl set image deployment/caddy-h3 -n ingress-nginx caddy=k3d-record-platform-registry:5000/caddy-with-tcpdump:dev`
  - **Envoy:** `docker/envoy-with-tcpdump` is already built and patched by `scripts/k3d-registry-push-and-patch.sh` (envoy-test uses `envoy-with-tcpdump:dev` when available).
- If preflight (or your k3d setup) uses these images **before** step 7 (run all suites), then baseline/enhanced/rotation will find tcpdump already in the pods and won’t run apk/apt at capture start.

**Option B – One-time pre-install in pods before suites**  
- Add a step **before** “7. Running all test suites” in `run-preflight-scale-and-all-suites.sh` (or in `ensure-ready-for-preflight.sh`) that:
  - Lists Caddy and Envoy pods (e.g. ingress-nginx/caddy-h3, envoy-test/envoy).
  - For each pod: `kubectl exec ... -- sh -c 'apk add --no-cache tcpdump 2>/dev/null || (apt-get update -qq && apt-get install -y tcpdump 2>/dev/null)'` (with a per-pod timeout).
  - No change to capture scripts; they will see `tcpdump` already present and skip install.
- This can be a small script, e.g. `scripts/ensure-tcpdump-in-capture-pods.sh`, called from preflight or ensure-ready.

**Option C – Ensure-ready or “get ready” script**  
- In `scripts/ensure-ready-for-preflight.sh` you already ensure: diagnostic, API, Postgres (5433–5440), Kafka, and optionally run preflight. You could add a step “Ensure tcpdump in Caddy/Envoy pods” that runs Option B (or ensures Caddy/Envoy use the -with-tcpdump images), so that when you run preflight, tcpdump is already there.

### Suggested order of operations

1. **Before heavy testing:** Run `./scripts/ensure-ready-for-preflight.sh` (and optionally `--run` to run preflight).  
2. **In that flow (or in preflight before step 7):** Either:
   - Use **caddy-with-tcpdump** (and envoy-with-tcpdump) so tcpdump is in the image, or  
   - Run a one-off **ensure-tcpdump-in-capture-pods** step so all Caddy/Envoy pods have tcpdump installed.  
3. Then run the full preflight/suites; baseline/enhanced/rotation will not block on tcpdump install.

References: `scripts/lib/packet-capture.sh`, `scripts/k3d-registry-push-and-patch.sh`, `docker/caddy-with-tcpdump/Dockerfile`, Runbook #59b, #63, `scripts/TEST-FAILURES-AND-WARNINGS.md` (Enhanced suite bottleneck).

---

## Summary

| Issue | Cause / location | Fix |
|-------|-------------------|-----|
| MetalLB “two suites” | Regular = `verify-metallb-and-traffic-policy.sh`; advanced = `verify-metallb-advanced.sh` (called from it). On k3d, advanced is “simulated”. | Use `SKIP_METALLB_ADVANCED=1` on k3d for speed; use `METALLB_VERIFY_COLIMA_L2=1` when you want real L2 only on Colima. |
| DB verification “forever” after baseline | `verify-db-cache-quick.sh` runs after **every** suite (including baseline); 8 DBs sequential + Redis exec + no overall timeout. | Add overall timeout (e.g. 60s), optionally parallelize DB checks, optionally skip per-suite verify and only run comprehensive at end. |
| tcpdump “do first” | tcpdump is installed at capture start in each pod (up to ~55–60s per pod). | Pre-install: use **caddy-with-tcpdump** (and envoy-with-tcpdump) and/or add a preflight/ensure step that installs tcpdump in Caddy/Envoy pods before step 7. |
