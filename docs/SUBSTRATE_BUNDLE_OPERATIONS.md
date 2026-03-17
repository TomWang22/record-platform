# Substrate bundle: what’s included, what’s left out, how to operate

This document describes the **portable substrate tarball** produced by `scripts/build-substrate-bundle.sh`: what is inside, what is **record-platform–specific and left out**, how to run it, and what to add for your project (e.g. housing with 10 services).

**Separate repo:** The bundle is an **extra copy** for use in a **different project repository**. Build from record-platform, then extract the tarball in the other repo (e.g. housing); do not merge into record-platform. Use a project name to get a distinct tarball: `./scripts/build-substrate-bundle.sh substrate-bundle housing` → `substrate-bundle-housing.tar.gz`. See the bundle README for extract-and-merge steps.

---

## 1. What’s in the tarball

- **Root:** `Caddyfile`, `docker-compose.yml` (Redis + Kafka + Zookeeper + Postgres layout; DB count per-project).
- **infra/k8s:** Caddy deploy (NodePort + LoadBalancer), MetalLB manifests, base namespaces, envoy-test, config (app-config, proto), **Kafka** (base/kafka deploy + service with KAFKA_SSL_CLIENT_AUTH=required), HPA example, observability namespace, Redis config example.
- **proto:** All `proto/*.proto` files (health, auth, and RP app protos as gRPC reference; replace with housing-specific protos as needed).
- **services:** `services/common`, `services/api-gateway`, `services/auth-service` (ported from RP), `services/cron-jobs`, and nine housing skeletons (housing-filter-service, search-service, booking-service, notification-service, review-service, moderation-service, media-service, analytics-service, messaging-service). **webapp/** at repo root (Next.js reference; adapt for housing). **backups/:** Place or use `5437-auth.dump` for auth-service DB restore; bundle may include it if built from a repo that has `backups/all-8-*/5437-auth.dump`.
- **scripts:** TLS/Colima/MetalLB: `strict-tls-bootstrap.sh`, `rollout-caddy.sh`, `generate-envoy-client-cert.sh`, `colima-apply-host-aliases.sh`, `ensure-ready-for-preflight.sh`, `ensure-k8s-api.sh`, `get-pods-to-ready.sh`, `install-metallb.sh`, `verify-metallb-and-traffic-policy.sh`, `setup-new-colima-cluster.sh` (one-shot Colima + MetalLB; **set METALLB_POOL** per project).  
  Preflight and tests: `run-preflight-scale-and-all-suites.sh`, `test-microservices-http2-http3.sh`, `test-grpc-http2-http3.sh`, `test-http2-http3-strict-tls.sh`, `test-full-chain-with-rotation.sh`, `smoke-services.sh`.  
  Rotation/k6: `rotation-suite.sh`, `run-k6-chaos.sh`, `k6-chaos-test.js`; **scripts/load/run-k6-phases.sh** (k6 phases + optional xk6 HTTP/3; on Colima, host HTTP/3 is skipped). k6 load: `k6-http3-complete.js`, `k6-reads.js`, `k6-limit-test-comprehensive.js`, `k6-find-max-rps-http3.js`, `k6-http3-toolchain.js` (strict TLS via K6_CA_ABSOLUTE).  
  DB ops (portable, PGPASSWORD=postgres, report with timestamp): `backup-all-dbs.sh`, `inspect-external-db-schemas.sh`.  
  Kafka: `kafka-ssl-from-dev-root.sh` (broker + client certs when ssl.client.auth=required).  
  Helpers: `compare-h2-h3-headers.sh`, **scripts/lib/** (e.g. `http3.sh`, `packet-capture-v2.sh`, `kubectl-helper.sh`).
- **docs:** `SUBSTRATE_OPERATIONS_REPORT.md`, `SUBSTRATE_BUNDLE_OPERATIONS.md` (this file), METALLB, STRICT_TLS_MTLS_AND_KAFKA, KAFKA_CURRENT_AND_ROADMAP, RUN-PREFLIGHT, XK6_HTTP3_SETUP, VERIFY_VS_PREFLIGHT_HTTP3.
- **certs:** Placeholder dir; you add dev-root, leaf, envoy-client (and Kafka client certs when using mTLS).

---

## 2. What’s record-platform–specific (left out of bundle)

So the bundle stays **portable**, the following are **not** included; add your own equivalents in your repo:

- **Other application services:** The bundle includes `services/common`, `services/api-gateway`, `services/auth-service` (ported), `services/cron-jobs`, `webapp/`, and nine housing skeletons. RP-only services (records-service, listings-service, shopping-service, social-service, auction-monitor, python-ai-service) are not included. Implement the nine housing services (see §4) using the skeletons and the same pattern as api-gateway and common.
- **Proto:** All RP `proto/*.proto` files are included as gRPC reference; replace or add housing-specific protos as needed.
- **RP DB schemas and migrations:** `infra/db/*.sql` (00–23, service-specific schemas).  
  You add your own DB count (e.g. 10) and schemas.
- **RP-only scripts:** e.g. `ensure-shopping-order-number-sequence.sh`, shopping/listings/records-specific setup and tuning scripts.  
  Use `backup-all-dbs.sh` / `inspect-external-db-schemas.sh` with your own DB list (env or file).
- **Full Kustomize base:** The bundle has namespaces, config, envoy-test, Kafka, HPA example, Redis config; it does not include every RP service deploy. You add your service deployments (one per housing service) and wire Caddy/Envoy to your gateway and backends.

---

## 3. How to operate the substrate

1. **New cluster (Colima + MetalLB)**  
   ```bash
   METALLB_POOL=192.168.64.240-192.168.64.250 ./scripts/setup-new-colima-cluster.sh
   ```  
   For **housing** (or another project), use a **different** pool to avoid conflict, e.g.:  
   `METALLB_POOL=192.168.64.251-192.168.64.260 ./scripts/setup-new-colima-cluster.sh`.

2. **TLS and Caddy**  
   Generate or copy CA + leaf; run `scripts/strict-tls-bootstrap.sh`, `scripts/generate-envoy-client-cert.sh`, then `scripts/rollout-caddy.sh` (with `CADDY_USE_LOADBALANCER=1` if using MetalLB).

3. **Preflight and suites**  
   `scripts/ensure-ready-for-preflight.sh` then `scripts/run-preflight-scale-and-all-suites.sh`. Override `NS` and `HOST` for your hostname/namespace.

4. **DB backup and schema report**  
   - Backup: `./scripts/backup-all-dbs.sh [backup-dir]` — uses `PGPASSWORD=postgres` (override with env), writes dumps and `backup-report-<timestamp>.md`.  
   - Inspect schemas: `./scripts/inspect-external-db-schemas.sh [report-dir]` — writes `schema-report-<timestamp>.md`.  
   Set `BACKUP_DBS` / `INSPECT_DBS` to a file or list (format `port:dbname:label`) for your DB layout (e.g. 10 DBs).

5. **K6 tests and xk6 HTTP/3**  
   Bundle includes `k6-chaos-test.js`, `scripts/load/run-k6-phases.sh` (phases + optional HTTP/3), and xk6 HTTP/3 scripts. Use **K6_CA_ABSOLUTE** (e.g. `certs/dev-root.pem`) for strict TLS. On Colima, host HTTP/3 is skipped automatically; in-cluster k6 and pod capture are authoritative. See docs/XK6_HTTP3_SETUP.md and docs/VERIFY_VS_PREFLIGHT_HTTP3.md.

6. **Kafka mTLS (ssl.client.auth=required)**  
   Both Docker Compose and in-cluster Kafka use **KAFKA_SSL_CLIENT_AUTH=required**. Run `scripts/kafka-ssl-from-dev-root.sh` after CA reissue; mount `kafka-ssl-secret` (and client cert/keystore if your client lib requires it) in every service that talks to Kafka. Set `KAFKA_CA_CERT`, `KAFKA_SSL_ENABLED`, and client cert env in app-config and deploys.

---

## 4. What to add: housing project (10 services)

Use the substrate as the base; then add **your** services, DBs, and config.

**In the bundle:** Auth-service is **ported** (full code); restore its DB from `backups/5437-auth.dump` (included if build has that backup, else place dump in `backups/` per backups/README.txt). The other nine services are **skeletons** (README per service); implement using common + api-gateway pattern.

| # | Service | In bundle |
|---|---------|-----------|
| 1 | **auth-service** | Ported (full). DB: restore from backups/5437-auth.dump. |
| 2 | **housing-filter-service** | Skeleton (README). Price, distance from campus, etc. |
| 3 | **search-service** | Skeleton. Search with Housing Filter integration. |
| 4 | **booking-service** | Skeleton. Reservation + landlord side. |
| 5 | **notification-service** | Skeleton. Rent reminders, price drop alerts. |
| 6 | **review-service** | Skeleton. Reviews and ratings. |
| 7 | **moderation-service** | Skeleton. Flag bad listings, abuse. |
| 8 | **media-service** | Skeleton. Image uploads, etc. |
| 9 | **analytics-service** | Skeleton. Usage and business metrics. |
| 10 | **messaging-service** | Skeleton. Tenant–landlord messaging. |

**Also in bundle:** `services/common`, `services/api-gateway`, `services/cron-jobs`, `webapp/` (root). **Layout:** Add `infra/k8s/base/<service>/` deploy for each service; register in base kustomization; point Caddy/Envoy at your API gateway and backends. Use **10 DBs** in Docker Compose and in `BACKUP_DBS` / `INSPECT_DBS` (and app-config) with your own ports and schema names.

---

## 5. MetalLB and run-preflight

- **MetalLB:** Included in the bundle (`infra/k8s/metallb/`, `scripts/install-metallb.sh`, `scripts/setup-new-colima-cluster.sh`). Always set **METALLB_POOL** per project.  
- **run-preflight-scale-and-all-suites.sh:** Included; it drives MetalLB install (when enabled), Caddy deploy, TLS verify, and all suites. Override `NS`, `HOST`, and (if needed) namespace/hostname inside the script for your project.

This keeps the tarball one coherent substrate: MetalLB, k3s, Kafka (strict TLS + **ssl.client.auth=required**), Redis, TLS CA, Ingress (Caddy), gRPC (all protos), services/common + api-gateway reference, protocol verification (HTTP/2, HTTP/3, strict TLS, mTLS), xk6 HTTP/3 and run-k6-phases, metrics-ready layout, DB backup/inspect scripts, and k6/rotation. Plug in the 10 housing services per §4 and run preflight and k6 on top.
