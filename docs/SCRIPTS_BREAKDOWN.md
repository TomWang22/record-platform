# Scripts Breakdown — Major Components

This document groups the main shell scripts in `scripts/` by purpose so you can find the right tool and understand how they fit together. It does not list every script (there are 300+); it focuses on the **big components** used for preflight, Colima/k3s, testing, DB/pgbench, and observability.

## 1. Preflight and readiness (run first)

| Script | Purpose |
|--------|---------|
| **ensure-ready-for-preflight.sh** | Single entry point: run cross-layer diagnostic (optional), ensure API (6443), ensure all 8 Postgres (5433–5440), ensure Kafka (:29093), then print "run preflight" or run preflight with `--run`. Use before `run-preflight-scale-and-all-suites.sh`. |
| **ensure-k8s-api.sh** | Retries `kubectl get nodes`; on first failure kills stale SSH tunnel and re-runs `colima-forward-6443.sh`. Called by preflight (step 1b), install-metallb, apply-caddy-h3-ingress, bring-up-stack. |
| **ensure-pgbench-dbs-ready.sh** | If Docker is available, runs `docker compose up -d` for the 8 Postgres services and waits (up to 120s) for ports 5433–5440. Used by run-daily-pgbench-standalone-with-results.sh. |
| **run-preflight-scale-and-all-suites.sh** | **Command center**: Colima check → trim → preflight kubeconfig → ensure API (step 1b) → ensure-api-server-ready → reissue CA/leaf → Kafka SSL → Postgres/migrations → apply config/Caddy → scale to baseline → verify Caddy TLS → strict TLS preflight → pod/DB/Redis check → cleanup → wait-for-all-services-ready → run all 8 suites → optional pgbench (step 8). Env: RUN_FULL_LOAD=1, RUN_SUITES=0, PREFLIGHT_PHASE, METALLB_ENABLED. |
| **ensure-api-server-ready.sh** | Retries API server reachability (kubectl get nodes / cluster-info / colima ssh kubectl) with per-attempt timeout and total cap. Used in preflight step 3. |
| **preflight-fix-kubeconfig.sh** | Pins Colima cluster server to 127.0.0.1:6443 and fixes kubeconfig so kubectl works from host. |

## 2. Colima and k3s

| Script | Purpose |
|--------|---------|
| **colima-forward-6443.sh** | Establishes SSH tunnel host:6443 → VM:k3s so host kubectl can use 127.0.0.1:6443. Pins kubeconfig to 6443. |
| **colima-k3s-cross-layer-diagnostic.sh** | Cross-layer diagnostic: Colima status, API (host + in-VM), k3s process, API metrics, nodes, pods (not ready + record-platform, ingress-nginx, metallb), controllers, MetalLB, storage. Use to "see what's really going on". |
| **colima-k3s-recover-from-crash-loop.sh** | Recovery when k3s is crash-looping (e.g. 51820 CRD registration). Stops/starts Colima, waits for API, optional re-forward 6443. |
| **colima-fresh-start-12-16-256.sh** | Full teardown and start with 12 CPU, 16 GB RAM, 256 GB disk (and --vm-type=vz on arm64). Use when recovery is not enough. |
| **stabilize-then-metallb.sh** | Ensures Colima is running, trims pods, re-forwards 6443, then optionally installs MetalLB. |
| **colima-teardown-and-start.sh** | Full teardown + start + 6443 tunnel. Use with COLIMA_TEARDOWN_FIRST=1 before preflight when reissue hits connection refused. |

## 3. Test suites (8 suites)

| Script | Purpose |
|--------|---------|
| **run-all-test-suites.sh** | Runs all 8 suites in order: auth, baseline, enhanced, adversarial, rotation, standalone-capture, tls-mtls, social. Optional strict TLS preflight, DB/cache verification, k6 phase (RUN_K6=1). |
| **rotation-suite.sh** | CA/leaf rotation under load (k6 H2+H3), wire-level packet capture, protocol verification (tshark), cert verification. |
| **test-microservices-http2-http3.sh** | Baseline: HTTP/2 and HTTP/3 (curl) + gRPC health and business logic. |
| **test-microservices-http2-http3-enhanced.sh** | Enhanced baseline with packet capture. |
| **test-tls-mtls-comprehensive.sh** | TLS/mTLS: cert chain, gRPC with strict TLS, NodePort vs port-forward. |
| **test-social-service-comprehensive.sh** | Social: forum + messages, archive/recall/kick/ban (requires migrations). |
| **enhanced-adversarial-tests.sh** | Adversarial tests. |
| **test-packet-capture-standalone.sh** | Standalone packet capture verification. |

Shared libs: **lib/packet-capture.sh** (drain, copy pcaps, tshark), **lib/protocol-verification.sh**, **lib/test-log.sh**, **lib/grpc-http3-health.sh**.

## 4. Certificates and TLS

| Script | Purpose |
|--------|---------|
| **reissue-ca-and-leaf-load-all-services.sh** | Reissues dev-root-ca and record-local-tls; updates secrets; step 5 restarts Caddy. Used in preflight step 3a. |
| **ensure-strict-tls-mtls-preflight.sh** | Validates/provisions service-tls + dev-root-ca; restarts gRPC/TLS workloads. Preflight step 5. |
| **verify-caddy-strict-tls.sh** | Verifies Caddy serves valid cert (no curl 60). |
| **kafka-ssl-from-dev-root.sh** | Creates kafka-ssl-secret from dev-root CA for Kafka strict TLS :29093. |

## 5. Database and pgbench

| Script | Purpose |
|--------|---------|
| **run-daily-pgbench-standalone-with-results.sh** | Daily cron entry: runs ensure-pgbench-dbs-ready then run-all-8-pgbench-standalone; writes results to timestamped dir; RUN_EXPLAIN_ALL, RUN_PLAN_DUMP. |
| **run-all-8-pgbench-standalone.sh** | Runs all 8 pgbench sweeps (records 5433, social 5434, auth 5437, shopping 5436, listings 5435, analytics 5439, auction-monitor 5438, python-ai 5440). |
| **run_pgbench_sweep.sh** | Records DB (5433) pgbench sweep (cold/warm, client sweep). |
| **run_auth_pgbench_sweep.sh**, **run_social_pgbench_sweep.sh**, **run_shopping_pgbench_sweep.sh**, **run_listings_pgbench_sweep.sh**, **run_analytics_pgbench_sweep.sh**, **run_auction-monitor_pgbench_sweep.sh**, **run_python-ai_pgbench_sweep.sh** | Per-service pgbench sweeps (respective ports). |
| **install-pgbench-daily-cron.sh** | Prints or installs crontab for run-daily-pgbench-standalone-with-results.sh (default 5 AM). |

## 6. Stack bring-up and apply

| Script | Purpose |
|--------|---------|
| **bring-up-stack-when-api-ready.sh** | Calls ensure-k8s-api then `kubectl apply -k infra/k8s/base`. |
| **apply-caddy-h3-ingress.sh** | Ensures API, creates Caddy configmap and TLS secrets, applies Caddy deploy/service, scale 2. |
| **install-metallb.sh** | Ensures API, installs MetalLB manifest, waits for controller, applies pool and L2 advertisement. |
| **install-prometheus-operator-crds.sh** | Installs ServiceMonitor/PodMonitor CRDs for observability. |

## 7. Pod and service health

| Script | Purpose |
|--------|---------|
| **wait-for-all-services-ready.sh** | Waits for all 9 deployments (auth, records, listings, social, shopping, analytics, auction-monitor, python-ai, api-gateway) to be 1/1 ready; optional self-healing (scale/restart). Used in preflight step 6b. |
| **check-all-pods-and-tls.sh** | Pod health and TLS secret checks. |
| **aggressive-cleanup-replicasets.sh** | Cleans up rogue ReplicaSets/pods. Preflight step 6a. |
| **force-deployments-to-working-replicasets.sh** | Forces deployments to use working ReplicaSets when 0 ready. |
| **ensure-kafka-ready.sh** | Ensures Kafka :29093 is reachable; optional docker compose up. |

## 8. DB and cache verification

| Script | Purpose |
|--------|---------|
| **verify-db-cache-quick.sh** | Quick DB connectivity (all 8 ports) and cache check. |
| **verify-db-and-cache-comprehensive.sh** | Comprehensive DB and cache verification. |
| **ensure-social-migrations.sh** | Applies social DB migrations (archive, recall, kick/ban, roles) on port 5434. |
| **ensure-content-hash-migrations.sh**, **ensure-catalog-all-dbs.sh** | Other migrations and catalog. |

## 9. Observability and reporting

| Script | Purpose |
|--------|---------|
| **generate-preflight-failure-report.sh** | Reads a preflight log and produces a structured failure report (what failed, why, what to do). |
| **generate-preflight-diagnostic-report.sh** | Dumps environment, namespaces, pods, Docker, MetalLB for debugging. |
| **colima-k3s-resource-dissection.sh** | CPU/RAM usage (nodes, top). |
| **colima-k3s-storage-diagnostic.sh** | Storage pressure and VM state. |

## 10. Load and k6

| Script | Purpose |
|--------|---------|
| **run-k6-chaos.sh** | Runs k6 chaos/rotation job in-cluster (ConfigMap for CA, strict TLS). |
| **find-ca-rotation-limit.sh** | Wrapper for incremental CA rotation limit finding (k6). |
| **scripts/load/** | k6 scripts: k6-ca-rotation.js, k6-find-ca-rotation-limit.js, k6-all-services-comprehensive.js, k6-http3-*, etc. See LOAD_TESTS_CATALOG.md. |

## Flow summary

- **Get ready:** `ensure-ready-for-preflight.sh` → diagnostic (optional) + API + DBs + Kafka.
- **Full pipeline:** `run-preflight-scale-and-all-suites.sh` (uses ensure-k8s-api at step 1b, ensure-api-server-ready at 3 and 4c, ensure-pgbench-dbs-ready not in preflight but DBs started at 3b3).
- **Daily pgbench:** Cron runs `run-daily-pgbench-standalone-with-results.sh` which runs `ensure-pgbench-dbs-ready.sh` then `run-all-8-pgbench-standalone.sh`.
- **Suites only:** `run-all-test-suites.sh` (assumes cluster and certs ready; or run after ensure-ready-for-preflight).

References: Runbook.md (bugs 50–51, Colima API, Reissue); docs/PREFLIGHT_AND_DIAGNOSTICS.md; ADR 007; ENGINEERING.md (preflight pipeline, tech stack justification).
