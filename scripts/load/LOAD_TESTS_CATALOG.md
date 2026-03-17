# Load Tests Catalog (k6 + pgbench)

This document catalogs all k6 scripts in `scripts/load/` and related pgbench scripts, with coverage for **read**, **soak**, **sweep**, **limit** (absolute max), **constant stress**, **Little's Law**, and **granular percentiles** (p99…p99.99999, p100). Future integration with `run-all-test-suites.sh` and pgbench is noted at the end.

---

## Three pillars (absolute limit / enhanced sustained / read–sweep–soak)

| Pillar | Purpose | k6 script(s) | pgbench |
|--------|--------|--------------|--------|
| **1) Absolute limit** | Find max throughput / breaking point; short ramp to failure | `k6-e2e-find-limit.js`, `k6-limit-test-comprehensive.js` (MODE=limit), `k6-limit-test-wire-verification.js`, `k6-find-ca-rotation-limit.js` | — |
| **2) Enhanced (sustained limit)** | Find limit the system can stay at for a long period; stability at high load | `k6-limit-test-comprehensive.js` (MODE=persistence), `k6-analytics-soak.js`, `k6-shopping-stress.js`, `k6-pipeline-tail-latency.js` | — |
| **3) Read / sweep / soak** | Read-heavy, rate sweep, long soak | **Read**: `k6-reads.js` (MODE=rate). **Sweep**: `k6-reads.js` (MODE=sweep, STAGES or RATE_START/STEP). **Soak**: `k6-reads.js` (MODE=soak), `k6-analytics-soak.js` | **Sweep**: `run_pgbench_sweep.sh`, `run_*_pgbench_sweep.sh` (see `scripts/PGBENCH_HARDENING.md`) |

**Root-cause focus**: (1) **HTTP/2/QUIC capture**: Use **tcpdump in foreground inside the pod** and **kubectl exec in background** (see `scripts/lib/packet-capture.sh`, `scripts/rotation-suite.sh`). Set `CAPTURE_DRAIN_SECONDS=5` (or 10) before stop so in-flight QUIC is captured. **ALPN h2** in TLS Client Hello is definitive for HTTP/2 without keylog; for frame-level proof set **SSLKEYLOGFILE** (H2_KEYLOG). QUIC may appear only on one Caddy pod—both pods are captured; if neither shows QUIC, add a short drain (e.g. 2s) before stop. (2) **Shopping checkout duplicate key**: Run **`scripts/ensure-shopping-order-number-sequence.sh`** (applies `infra/db/09-shopping-order-number-sequence.sql` on port 5436 **database `shopping`**; preflight and run-all run it before suites). (3) **Rotation suite k6 ConfigMap**: Namespace **k6-load** is created by the rotation script; ConfigMap uses `--from-file=ca.crt=$CA_ROOT` on k3d/kind. (4) **xk6-http3**: Same k6 phases (read, soak, limit, max) with HTTP/3: set **K6_HTTP3=1 K6_HTTP3_PHASES=1** in `run-k6-phases.sh`, or run **`scripts/load/run-k6-http3-phases.sh`** (requires built xk6: `./scripts/build-k6-http3.sh`). Adversarial: **Test 5** malformed hardening (oversized header, invalid method, garbage body); **Test 6** connection flood via k6 (k6-reads.js 15s from host).

---

## Quick reference

| Type        | k6 script(s) | pgbench | Notes |
|------------|--------------|--------|--------|
| **Read**   | `k6-reads.js` | — | GET-heavy, MODE=rate/sweep/soak |
| **Soak**   | `k6-analytics-soak.js`, `k6-limit-test-comprehensive.js` (MODE=persistence), `k6-shopping-stress.js`, `k6-pipeline-tail-latency.js` (stages) | — | Long-duration steady load |
| **Sweep**  | `k6-reads.js` (MODE=sweep, STAGES or RATE_START/STEP) | `run_pgbench_sweep.sh` | Ramp rates / client counts |
| **Limit**  | `k6-e2e-find-limit.js`, `k6-limit-test-comprehensive.js`, `k6-limit-test-wire-verification.js`, `k6-find-ca-rotation-limit.js` | — | Find max throughput / breaking point |
| **Constant stress** | `k6-limit-test-comprehensive.js` (constant-arrival-rate), `k6-reads.js` (MODE=rate), `all-in-one-k6.js` | — | Fixed arrival rate over time |
| **Little's Law** | `k6-limit-test-comprehensive.js` (queue_length, throughput, L=λW) | `run_pgbench_sweep.sh` (lat_est_ms) | Queue / latency analysis |
| **p99…p99.99999, p100** | `k6-reads.js`, `k6-limit-test-comprehensive.js`, `k6-pipeline-tail-latency.js`, `all-in-one-k6.js`, `calculate-granular-percentiles.js`, `calculate-percentiles.py` | pgbench sweep (p50…p100) | Tail latency and max |

---

## k6 scripts by category

### Read-heavy

- **`k6-reads.js`**
  - **MODE**: `rate` | `sweep` | `soak` (env: `MODE`, `RATE`, `STAGES` or `RATE_START`/`RATE_STEP`/`STEPS`/`STEP_DUR`, `VUS`, `DURATION`).
  - GET `/records`, strict error/latency thresholds.
  - **Percentiles**: p50, p95, p99, p99.9, p99.99, p99.999, p99.9999, p99.99999, p100 (thresholds + `handleSummary`).
  - Example: `MODE=sweep STAGES=100,200,300,400 k6 run scripts/load/k6-reads.js`

### Soak (long-duration stability)

- **`k6-analytics-soak.js`** – Analytics pipeline, 30m+ steady VUs, mix read/write.
- **`k6-limit-test-comprehensive.js`** – `MODE=persistence`: 1h constant-arrival-rate H2+H3 (soak).
- **`k6-shopping-stress.js`** – Shopping service stress.
- **`k6-pipeline-tail-latency.js`** – Pipeline latency; can use `--stages` for soak-style ramps.

### Sweep (ramp rates / stages)

- **`k6-reads.js`** – `MODE=sweep`: stages from `STAGES` CSV or `RATE_START`/`RATE_STEP`/`STEPS`/`STEP_DUR`.
- **pgbench**: `scripts/run_pgbench_sweep.sh` – client/thread sweep, records p50…p100 and Little’s Law–style lat_est.

### Limit (absolute max / find breaking point)

- **`k6-e2e-find-limit.js`** – E2E ramp (10→500 VUs) to find limit; HTTP/2 or HTTP/3 via `HTTP_VERSION`.
- **`k6-limit-test-comprehensive.js`** – `MODE=limit` or `both`: constant-arrival-rate H2+H3, comprehensive percentiles, **Little’s Law** (queue_length, throughput, L=λW).
- **`k6-limit-test-wire-verification.js`** – Limit test with wire-level capture.
- **`k6-find-ca-rotation-limit.js`** – Limit finding around CA rotation.

### Constant stress (fixed rate for long time)

- **`k6-limit-test-comprehensive.js`** – `constant-arrival-rate` for H2 and H3 (persistence or limit).
- **`k6-reads.js`** – `MODE=rate` + `RATE` + `DURATION`.
- **`all-in-one-k6.js`** – Mixed API load; supports rate/duration; comprehensive percentiles (p50…p100).

### Granular percentiles (p99…p99.99999, p100)

- **In-script thresholds/reporting**: `k6-reads.js`, `k6-limit-test-comprehensive.js`, `k6-pipeline-tail-latency.js`, `all-in-one-k6.js`, `k6-listings-service-comprehensive.js`, `k6-python-ai-pipeline.js`, `k6-all-services-comprehensive.js`, `k6-e2e-find-limit.js`.
- **Post-processing**:
  - **`calculate-granular-percentiles.js`** – From k6 JSON: p100, p99, p99.9, p99.99, p99.999, p99.9999, p99.99999, p99.999999.
  - **`calculate-percentiles.py`** – p1…p100, p999, p9999, ….
  - **`generate-latency-graph.py`** / **`generate-markdown-report.py`** – Reports and graphs including p99.99999, p100.

### Service- and scenario-specific

- **Analytics**: `k6-analytics-soak.js`, `k6-analytics-read-heavy.js`, `k6-analytics-stress.js`, `k6-analytics-load-ramp.js`, `k6-analytics-ingestion.js`, `k6-analytics-data-quality.js`, `k6-analytics-db-validation.js`, `k6-analytics-real-data.js`.
- **Auth**: `k6-auth-comprehensive.js`, `k6-auth-limit-test.js`, `k6-auth-limit-test-improved.js`, `k6-auth-incremental-load.js`.
- **Shopping**: `k6-shopping-comprehensive.js`, `k6-shopping-stress.js`, `k6-shopping-ramp.js`, `k6-shopping-db-validation.js`.
- **Listings**: `k6-listings-service-comprehensive.js`.
- **Social**: `k6-social-service-comprehensive.js`, `k6-social-limit-test.js`.
- **Python AI**: `k6-python-ai.js`, `k6-python-ai-pipeline.js`.
- **Platform / E2E**: `k6-platform-wide-comprehensive.js`, `k6-all-services-comprehensive.js`, `k6-mixed.js`, `k6-http3-complete.js`, `k6-http3-toolchain.js`, `k6-bottleneck-finder.js`, `k6-ca-rotation.js`, `k6-summary-handler.js`.

---

## pgbench (DB-level load)

- **`scripts/run_pgbench_sweep.sh`** – Main sweep over client/thread variants; records TPS, p50…p9999999, p100, and latency estimate (Little’s Law–style). Output CSV and DB for analysis.
- **Service-specific sweeps** (in `scripts/`): `run_social_pgbench_sweep.sh`, `run_auth_pgbench_sweep.sh`, `run_shopping_pgbench_sweep.sh`, `run_python-ai_pgbench_sweep.sh`, `run_listings_pgbench_sweep.sh`, `run_auction-monitor_pgbench_sweep.sh`, `run_analytics_pgbench_sweep.sh`. All align to the same hardening: regression (RUN_DIFF_MODE, BASELINE_CSV, REG_THRESH_*), TPS highlight, RUN_PLAN_DUMP, timeouts, plan_cache_mode (see **`scripts/PGBENCH_HARDENING.md`**).

pgbench is **not** currently invoked from `run-all-test-suites.sh`; it is intended to be incorporated later (see below).

---

## How these are used today

- **`run-all-test-suites.sh`**: Runs 8 suites (auth, baseline, enhanced, adversarial, rotation, standalone-capture, tls-mtls, social). **Does not** run k6 or pgbench.
- **`rotation-suite.sh`**: Uses `run-k6-chaos.sh` and `k6-chaos-test.js` (from `scripts/`) for chaos/load during rotation.
- **`run-final-test-suite.sh`**: Runs k6 limit tests (`k6-e2e-find-limit.js`) for HTTP/2 and HTTP/3.
- **`run-complete-optimization-and-test-suite.sh`**: k6 persistence (soak) + limit test (e.g. `k6-limit-test-wire-verification.js`), with percentile output (p90–p9999999, p100).
- **`run-final-complete-suite.sh`**: k6 persistence + limit (`k6-limit-test-comprehensive.js`), JSON summary and percentiles.
- **`run-full-test-suite.sh`**: k6 limit test with wire capture (`k6-limit-test-wire-verification.js`).
- **`run-k6-with-wire-capture.sh`**: Generic k6 script runner with wire capture.

---

## k6 in `run-all-test-suites.sh` and preflight

**Implemented:** RUN_K6=1 runs k6 after the 8 suites (strict TLS). If K6_PHASES is set (e.g. read,soak,sweep,limit,max), runs `scripts/load/run-k6-phases.sh`; else single `k6-reads.js` (MODE=rate). RUN_FULL_LOAD=1 sets K6_PHASES and K6_HTTP3=1 for xk6-http3.

**pgbench:** RUN_PGBENCH=1 is used by run-preflight-scale-and-all-suites.sh (step 8). K6_PHASES runs run-k6-phases.sh (read, soak, sweep, limit, max, http3). Preflight 3b4e applies analytics/auction_monitor/python_ai schemas for pgbench.

---

## Test coverage and known gaps

- **MetalLB and HTTP/3:** `scripts/verify-metallb-and-traffic-policy.sh` verifies (1) MetalLB controller/speaker and LB IP, (2) in-cluster Caddy over LB, (3) host HTTPS to LB IP (step 5), (4) **HTTP/3 (QUIC) to LB IP** (step 6) when the host can reach the LB IP. This proves MetalLB forwards **UDP 443** for QUIC. On k3d the host often cannot reach the LB IP; use **NodePort 30443** for HTTP/2 and HTTP/3 from the host (see docs/K3D_PREFLIGHT_AND_SUITES_INVESTIGATION.md).
- **Records pgbench statement timeouts:** Under high client count, `search_records_fuzzy_ids` can hit **statement timeout** (default 30s in quick mode, 60s in deep). If you see many "canceling statement due to statement timeout" in records sweep logs: (1) set **`USE_AUTO_WRAPPER=true`** to use `search_records_fuzzy_ids_auto` (200ms cap + fast→deep fallback, production-like), or (2) raise **`STATEMENT_TIMEOUT`** (e.g. `STATEMENT_TIMEOUT=60000` or higher) for capacity runs. See `scripts/run_pgbench_sweep.sh` and `scripts/PGBENCH_HARDENING.md`.
- **Disk space:** Preflight and pgbench check host disk; at **>90%** they warn and suggest **`./scripts/emergency-disk-cleanup.sh`**. At **>95%** preflight/pgbench refuse to run. Run `./scripts/emergency-disk-cleanup.sh --dry-run` to see what would be removed; the script also prints a **disk usage breakdown** (bench_logs, test-results, webapp/.next, Docker, backups, /tmp logs). Safe targets: old bench_logs, test-results, Next.js cache, Docker prune, old /tmp preflight/suite logs.
- **Suite checklist (run-all-test-suites):** Auth, baseline, enhanced, adversarial, rotation, standalone-capture, tls-mtls, social. Auth/baseline/enhanced/adversarial and tls-mtls are core; rotation requires k6 CA ConfigMap in `k6-load`; social runs after DBs are up. MFA/OAuth and some auth paths are env-dependent (secrets). Shopping checkout (Test 13c): migration no longer run in preflight or run-all. If 13c fails (e.g. fresh DB), run **`scripts/ensure-shopping-order-number-sequence.sh`** once (applies 09 on port 5436, database **shopping**). **Known failures/warnings:** see **`scripts/TEST-FAILURES-AND-WARNINGS.md`** (auth MFA/OAuth/email, Envoy gRPC on Colima, Caddy admin reload, malformed test, rotation duration).

---

## Future: full k6 + pgbench integration

Planned (beyond RUN_K6=1):

1. **Optional k6 phase** after the 8 suites (or as a separate “load” phase):
   - **Read**: `k6-reads.js` (MODE=rate or sweep).
   - **Soak**: `k6-limit-test-comprehensive.js` MODE=persistence (or shorter duration for CI).
   - **Limit**: `k6-limit-test-comprehensive.js` MODE=limit or `k6-e2e-find-limit.js`.
   - Export JSON summary and run `calculate-granular-percentiles.js` / `calculate-percentiles.py` for p99…p99.99999, p100.

2. **Optional pgbench phase** (after or in parallel with k6, when DB is available):
   - Run `run_pgbench_sweep.sh` (and optionally service-specific pgbench sweeps) for DB-level throughput and tail latencies (p50…p100, Little’s Law–style metrics).

3. **CI**: Use env flags (e.g. `RUN_K6=1`, `RUN_PGBENCH=1`) or a separate “full load” pipeline so `run-all-test-suites.sh` can stay fast by default.

Until then, run k6 and pgbench manually or via the scripts above (rotation-suite, run-final-test-suite, run-complete-optimization-and-test-suite, run_pgbench_sweep.sh).
