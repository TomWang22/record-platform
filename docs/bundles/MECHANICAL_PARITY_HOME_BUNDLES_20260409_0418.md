# Mechanical parity: home bundles (≈2026-04-09–04-18) → repo

Repo root: `/Users/tom/record-platform`

## Scope

- **Full MISSING:** any member path not present in the repo (after bundle prefix strip).
- **Infra MISSING:** subset aimed at **Kafka / QUIC / transport / preflight / MetalLB / edge**; excludes `services/`, `webapp/`, root `tests/`, `testd/`, typical app microservice test scripts, and **per-service** `infra/k8s/base/{messaging,booking,trust,notification,media}-service/` manifests.

Rules:
- Members are normalized (`./` stripped, trailing `/` removed for checks).
- If **every** member sits under a single top-level directory `root/` and `root` is **not** a normal repo root (`scripts`, `infra`, …), that bundle folder is stripped (snapshot tar layout).
- Layouts that already start at `scripts/`, `infra/`, … (no wrapper folder) are checked as-is.
- Tar-only metadata (`PaxHeaders`, `__MACOSX`, `.DS_Store`) is skipped; `__pycache__` / `*.pyc` skipped.
- Vendored mappings: `PREFLIGHT_CLUSTER_QUIC_BUNDLE.txt`, `RECORD_PLATFORM_PREFLIGHT_KAFKA_OPS_SETUP.md`, `docs/preflight-quic-step-grep.txt` → `docs/bundles/`.

## Summary

| Archive | Checked | Missing (all) | Missing (infra) | Stripped prefix |
|---------|--------:|---------------:|----------------:|-----------------|
| `record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410.tar.gz` | 1342 | 396 | 0 | `record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/` |
| `record-platform-kafka-kraft-3broker-kafka-certs-20260410.tar.gz` | 21 | 0 | 0 | `record-platform-kafka-3broker-kraft-kafka-certs-20260410/` |
| `record-platform-kafka-metallb-tls-reference-20260409.tar.gz` | 104 | 0 | 0 | `record-platform-kafka-metallb-tls-reference-20260409/` |
| `record-platform-kafka-observability-proto-reference-20260410.tar.gz` | 152 | 0 | 0 | `record-platform-kafka-observability-proto-reference-20260410/` |
| `record-platform-kafka-ops-certs-alignment-cron-preflight-20260410.tar.gz` | 538 | 0 | 0 | `record-platform-kafka-ops-certs-alignment-cron-20260410/` |
| `record-platform-makefile-golden-snapshot-kafka-chaos-20260410.tar.gz` | 508 | 0 | 0 | `record-platform-makefile-golden-chaos-kafka-20260410/` |
| `record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410.tar.gz` | 94 | 41 | 0 | `record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/` |
| `record-platform-och-full-scripts-infra-reference-20260410-1245.tar.gz` | 644 | 0 | 0 | `record-platform-och-full-scripts-infra-reference-20260410-1245/` |
| `record-platform-och-preflight-cert-kafka-bundle-20260418-025117.tar.gz` | 620 | 7 | 1 | `record-platform-och-preflight-cert-kafka-bundle/` |
| `record-platform-och-preflight-kafka-kraft-certs-caddy-reference-20260409.tar.gz` | 786 | 22 | 0 | `record-platform-och-preflight-kafka-kraft-certs-caddy-reference-20260409/` |
| `record-platform-och-preflight-scale-transport-v7b-20260418-011819.tar.gz` | 70 | 6 | 0 | `record-platform-och-preflight-scale-transport-v7b/` |
| `record-platform-och-transport-watchdog-preflight-kafka-mesh-full-scripts-reference-20260410.tar.gz` | 820 | 39 | 0 | `record-platform-och-transport-watchdog-preflight-kafka-mesh-full-scripts-reference-20260410/` |
| `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409.tar.gz` | 586 | 375 | 0 | `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/` |
| `record-platform-quic-transport-porting-bundle-20260416-192801.tar.gz` | 44 | 5 | 0 | `record-platform-quic-transport-porting-bundle/` |
| `record.test-och-housing-20260418-161510.tar.gz` | 24 | 2 | 0 | `(none)` |
| `preflight-cluster-quic-scripts-20260418-165316.tar.gz` | 277 | 0 | 0 | `(none)` |
| `preflight-cluster-quic-scripts-20260418-165326.tar.gz` | 276 | 0 | 0 | `(none)` |
| `preflight-cluster-quic-scripts-20260418-165415.tar.gz` | 277 | 0 | 0 | `(none)` |
| `och-preflight-cluster-stability-jaeger-transport-bundle-20260418-011502.tar.gz` | 70 | 6 | 0 | `och-preflight-cluster-stability-jaeger-transport-bundle/` |
| `kafka-kraft-3broker-chaos-suite-bundle-20260418-022748.tar.gz` | 87 | 7 | 0 | `kafka-kraft-3broker-chaos-suite-bundle/` |

## `record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410.tar.gz`
- Full path: `/Users/tom/record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410.tar.gz`
- Members (raw, non-empty): **1343**
- Stripped prefix: `record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/`
- Paths checked: **1342**
- **MISSING (all): 396** — **MISSING (infra focus): 0**

### MISSING — all (first 120, for forensics)
  - `GOLDEN_SNAPSHOT_AND_CHAOS.md`
  - `tests`
  - `vitest.account-deletion.config.ts`
  - `README.txt`
  - `SELF_BUILT_SERVICE_MESH.md`
  - `services/media-service`
  - `services/notification-service`
  - `services/event-layer-verification`
  - `services/README.md`
  - `services/transport-watchdog`
  - `services/trust-service`
  - `services/booking-service`
  - `services/messaging-service`
  - `services/messaging-service/generated`
  - `services/messaging-service/Dockerfile`
  - `services/messaging-service/prisma`
  - `services/messaging-service/tests`
  - `services/messaging-service/README.md`
  - `services/messaging-service/package.json`
  - `services/messaging-service/tsconfig.json`
  - `services/messaging-service/vitest.config.ts`
  - `services/messaging-service/src`
  - `services/messaging-service/src/types`
  - `services/messaging-service/src/rateLimit.ts`
  - `services/messaging-service/src/kafkaMessagingEvents.ts`
  - `services/messaging-service/src/lib`
  - `services/messaging-service/src/grpc-server.ts`
  - `services/messaging-service/src/server.ts`
  - `services/messaging-service/src/routes`
  - `services/messaging-service/src/user-lifecycle-consumer.ts`
  - `services/messaging-service/src/routes/messages.ts`
  - `services/messaging-service/src/routes/forum.ts`
  - `services/messaging-service/src/lib/singleflight_cache.lua`
  - `services/messaging-service/src/lib/cache.ts`
  - `services/messaging-service/src/lib/db.ts`
  - `services/messaging-service/src/lib/auth.ts`
  - `services/messaging-service/src/types/ioredis.d.ts`
  - `services/messaging-service/tests/integration`
  - `services/messaging-service/tests/setup`
  - `services/messaging-service/tests/setup/env.ts`
  - `services/messaging-service/tests/integration/messaging-flow.integration.test.ts`
  - `services/messaging-service/tests/integration/README.md`
  - `services/messaging-service/prisma/schema.prisma`
  - `services/messaging-service/generated/client`
  - `services/messaging-service/generated/client/wasm-edge-light-loader.mjs`
  - `services/messaging-service/generated/client/client.js`
  - `services/messaging-service/generated/client/edge.d.ts`
  - `services/messaging-service/generated/client/schema.prisma`
  - `services/messaging-service/generated/client/wasm.d.ts`
  - `services/messaging-service/generated/client/wasm-worker-loader.mjs`
  - `services/messaging-service/generated/client/runtime`
  - `services/messaging-service/generated/client/index.js`
  - `services/messaging-service/generated/client/edge.js`
  - `services/messaging-service/generated/client/libquery_engine-linux-arm64-openssl-3.0.x.so.node`
  - `services/messaging-service/generated/client/index-browser.js`
  - `services/messaging-service/generated/client/package.json`
  - `services/messaging-service/generated/client/query_engine_bg.js`
  - `services/messaging-service/generated/client/libquery_engine-darwin-arm64.dylib.node`
  - `services/messaging-service/generated/client/wasm.js`
  - `services/messaging-service/generated/client/default.js`
  - `services/messaging-service/generated/client/index.d.ts`
  - `services/messaging-service/generated/client/default.d.ts`
  - `services/messaging-service/generated/client/libquery_engine-darwin.dylib.node`
  - `services/messaging-service/generated/client/libquery_engine-debian-openssl-3.0.x.so.node`
  - `services/messaging-service/generated/client/client.d.ts`
  - `services/messaging-service/generated/client/query_engine_bg.wasm`
  - `services/messaging-service/generated/client/runtime/wasm-engine-edge.js`
  - `services/messaging-service/generated/client/runtime/wasm-compiler-edge.js`
  - `services/messaging-service/generated/client/runtime/library.js`
  - `services/messaging-service/generated/client/runtime/edge.js`
  - `services/messaging-service/generated/client/runtime/index-browser.js`
  - `services/messaging-service/generated/client/runtime/library.d.ts`
  - `services/messaging-service/generated/client/runtime/index-browser.d.ts`
  - `services/messaging-service/generated/client/runtime/edge-esm.js`
  - `services/messaging-service/generated/client/runtime/react-native.js`
  - `services/booking-service/Dockerfile`
  - `services/booking-service/vitest.integration.kafka-topics-bootstrap.ts`
  - `services/booking-service/prisma`
  - `services/booking-service/tests`
  - `services/booking-service/README.md`
  - `services/booking-service/vitest.integration.global-setup.ts`
  - `services/booking-service/package.json`
  - `services/booking-service/vitest.integration.config.mts`
  - `services/booking-service/tsconfig.json`
  - `services/booking-service/vitest.config.ts`
  - `services/booking-service/vitest.integration.kafka-env.ts`
  - `services/booking-service/src`
  - `services/booking-service/src/http-app.ts`
  - `services/booking-service/src/lib`
  - `services/booking-service/src/grpc-server.ts`
  - `services/booking-service/src/server.ts`
  - `services/booking-service/src/user-lifecycle-consumer.ts`
  - `services/booking-service/src/lib/prisma.ts`
  - `services/booking-service/tests/smoke.test.ts`
  - `services/booking-service/tests/booking-http.integration.test.ts`
  - `services/booking-service/prisma/generated`
  - `services/booking-service/prisma/migrations`
  - `services/booking-service/prisma/schema.prisma`
  - `services/booking-service/prisma/migrations/migration_lock.toml`
  - `services/booking-service/prisma/migrations/20260330104500_booking_processed_events`
  - `services/booking-service/prisma/migrations/20260320180000_align_booking_with_domain_schema`
  - `services/booking-service/prisma/migrations/20260317120000_init_booking_service`
  - `services/booking-service/prisma/migrations/20260406120000_booking_tenant_notes`
  - `services/booking-service/prisma/migrations/20260406120000_booking_tenant_notes/migration.sql`
  - `services/booking-service/prisma/migrations/20260317120000_init_booking_service/migration.sql`
  - `services/booking-service/prisma/migrations/20260320180000_align_booking_with_domain_schema/migration.sql`
  - `services/booking-service/prisma/migrations/20260330104500_booking_processed_events/migration.sql`
  - `services/booking-service/prisma/generated/client`
  - `services/booking-service/prisma/generated/client/wasm-edge-light-loader.mjs`
  - `services/booking-service/prisma/generated/client/client.js`
  - `services/booking-service/prisma/generated/client/edge.d.ts`
  - `services/booking-service/prisma/generated/client/schema.prisma`
  - `services/booking-service/prisma/generated/client/wasm.d.ts`
  - `services/booking-service/prisma/generated/client/wasm-worker-loader.mjs`
  - `services/booking-service/prisma/generated/client/runtime`
  - `services/booking-service/prisma/generated/client/index.js`
  - `services/booking-service/prisma/generated/client/edge.js`
  - `services/booking-service/prisma/generated/client/libquery_engine-linux-arm64-openssl-3.0.x.so.node`
  - `services/booking-service/prisma/generated/client/index-browser.js`
  - `services/booking-service/prisma/generated/client/package.json`
  - … and **276** more

## `record-platform-kafka-kraft-3broker-kafka-certs-20260410.tar.gz`
- Full path: `/Users/tom/record-platform-kafka-kraft-3broker-kafka-certs-20260410.tar.gz`
- Members (raw, non-empty): **22**
- Stripped prefix: `record-platform-kafka-3broker-kraft-kafka-certs-20260410/`
- Paths checked: **21**
- **MISSING (all): 0** — **MISSING (infra focus): 0**

## `record-platform-kafka-metallb-tls-reference-20260409.tar.gz`
- Full path: `/Users/tom/record-platform-kafka-metallb-tls-reference-20260409.tar.gz`
- Members (raw, non-empty): **105**
- Stripped prefix: `record-platform-kafka-metallb-tls-reference-20260409/`
- Paths checked: **104**
- **MISSING (all): 0** — **MISSING (infra focus): 0**

## `record-platform-kafka-observability-proto-reference-20260410.tar.gz`
- Full path: `/Users/tom/record-platform-kafka-observability-proto-reference-20260410.tar.gz`
- Members (raw, non-empty): **153**
- Stripped prefix: `record-platform-kafka-observability-proto-reference-20260410/`
- Paths checked: **152**
- **MISSING (all): 0** — **MISSING (infra focus): 0**

## `record-platform-kafka-ops-certs-alignment-cron-preflight-20260410.tar.gz`
- Full path: `/Users/tom/record-platform-kafka-ops-certs-alignment-cron-preflight-20260410.tar.gz`
- Members (raw, non-empty): **539**
- Stripped prefix: `record-platform-kafka-ops-certs-alignment-cron-20260410/`
- Paths checked: **538**
- **MISSING (all): 0** — **MISSING (infra focus): 0**

## `record-platform-makefile-golden-snapshot-kafka-chaos-20260410.tar.gz`
- Full path: `/Users/tom/record-platform-makefile-golden-snapshot-kafka-chaos-20260410.tar.gz`
- Members (raw, non-empty): **509**
- Stripped prefix: `record-platform-makefile-golden-chaos-kafka-20260410/`
- Paths checked: **508**
- **MISSING (all): 0** — **MISSING (infra focus): 0**

## `record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410.tar.gz`
- Full path: `/Users/tom/record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410.tar.gz`
- Members (raw, non-empty): **95**
- Stripped prefix: `record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/`
- Paths checked: **94**
- **MISSING (all): 41** — **MISSING (infra focus): 0**

### MISSING — all (first 41, for forensics)
  - `tests`
  - `vitest.account-deletion.config.ts`
  - `testd`
  - `testd/physical`
  - `testd/domain`
  - `testd/domain/domain.dot`
  - `testd/domain/domain.svg`
  - `testd/physical/auth.svg`
  - `testd/physical/messaging.svg`
  - `testd/physical/auth.dot`
  - `testd/physical/messaging.dot`
  - `testd/physical/media.dot`
  - `testd/physical/json`
  - `testd/physical/notification.svg`
  - `testd/physical/media.svg`
  - `testd/physical/notification.dot`
  - `testd/physical/analytics.svg`
  - `testd/physical/trust.svg`
  - `testd/physical/listings.svg`
  - `testd/physical/bookings.svg`
  - `testd/physical/listings.dot`
  - `testd/physical/trust.dot`
  - `testd/physical/analytics.dot`
  - `testd/physical/bookings.dot`
  - `testd/physical/json/trust.json`
  - `testd/physical/json/messaging.json`
  - `testd/physical/json/analytics.json`
  - `testd/physical/json/bookings.json`
  - `testd/physical/json/media.json`
  - `testd/physical/json/notification.json`
  - `testd/physical/json/auth.json`
  - `testd/physical/json/listings.json`
  - `tests/account-deletion.e2e.test.ts`
  - `tests/system`
  - `tests/helpers`
  - `tests/helpers/wait-for-kafka-propagation.ts`
  - `tests/system/booking-analytics.contract.test.ts`
  - `tests/system/listing-analytics.contract.test.ts`
  - `tests/system/global-setup.ts`
  - `tests/system/helpers`
  - `tests/system/helpers/waitForCondition.ts`

## `record-platform-och-full-scripts-infra-reference-20260410-1245.tar.gz`
- Full path: `/Users/tom/record-platform-och-full-scripts-infra-reference-20260410-1245.tar.gz`
- Members (raw, non-empty): **645**
- Stripped prefix: `record-platform-och-full-scripts-infra-reference-20260410-1245/`
- Paths checked: **644**
- **MISSING (all): 0** — **MISSING (infra focus): 0**

## `record-platform-och-preflight-cert-kafka-bundle-20260418-025117.tar.gz`
- Full path: `/Users/tom/record-platform-och-preflight-cert-kafka-bundle-20260418-025117.tar.gz`
- Members (raw, non-empty): **621**
- Stripped prefix: `record-platform-och-preflight-cert-kafka-bundle/`
- Paths checked: **620**
- **MISSING (all): 7** — **MISSING (infra focus): 1**

### MISSING — infra focus (first 1)
  - `scripts/package-record-platform-preflight-cert-kafka-bundle.sh`

### MISSING — all (first 7, for forensics)
  - `MANIFEST.txt`
  - `make-fragments`
  - `README_BUNDLE.txt`
  - `scripts/package-record-platform-preflight-cert-kafka-bundle.sh`
  - `scripts/kubectl-och.sh`
  - `make-fragments/package.json.kafka-verify.snippet.txt`
  - `make-fragments/package.json.preflight-scripts.snippet.json`

## `record-platform-och-preflight-kafka-kraft-certs-caddy-reference-20260409.tar.gz`
- Full path: `/Users/tom/record-platform-och-preflight-kafka-kraft-certs-caddy-reference-20260409.tar.gz`
- Members (raw, non-empty): **787**
- Stripped prefix: `record-platform-och-preflight-kafka-kraft-certs-caddy-reference-20260409/`
- Paths checked: **786**
- **MISSING (all): 22** — **MISSING (infra focus): 0**

### MISSING — all (first 22, for forensics)
  - `CADDY_IMAGE_XCADDY_TCPDUMP_TSHARK.md`
  - `PLATFORM_REUSE_AND_PREFLIGHT.md`
  - `infra/k8s/base/media-service`
  - `infra/k8s/base/notification-service`
  - `infra/k8s/base/trust-service`
  - `infra/k8s/base/booking-service`
  - `infra/k8s/base/messaging-service`
  - `infra/k8s/base/messaging-service/kustomization.yaml`
  - `infra/k8s/base/messaging-service/deploy.yaml`
  - `infra/k8s/base/messaging-service/service.yaml`
  - `infra/k8s/base/booking-service/kustomization.yaml`
  - `infra/k8s/base/booking-service/deploy.yaml`
  - `infra/k8s/base/booking-service/service.yaml`
  - `infra/k8s/base/trust-service/kustomization.yaml`
  - `infra/k8s/base/trust-service/deploy.yaml`
  - `infra/k8s/base/trust-service/service.yaml`
  - `infra/k8s/base/notification-service/kustomization.yaml`
  - `infra/k8s/base/notification-service/deploy.yaml`
  - `infra/k8s/base/notification-service/service.yaml`
  - `infra/k8s/base/media-service/kustomization.yaml`
  - `infra/k8s/base/media-service/deploy.yaml`
  - `infra/k8s/base/media-service/service.yaml`

## `record-platform-och-preflight-scale-transport-v7b-20260418-011819.tar.gz`
- Full path: `/Users/tom/record-platform-och-preflight-scale-transport-v7b-20260418-011819.tar.gz`
- Members (raw, non-empty): **71**
- Stripped prefix: `record-platform-och-preflight-scale-transport-v7b/`
- Paths checked: **70**
- **MISSING (all): 6** — **MISSING (infra focus): 0**

### MISSING — all (first 6, for forensics)
  - `MANIFEST.txt`
  - `make-fragments`
  - `README_BUNDLE.txt`
  - `services/listings-service/vitest.integration.config.mts`
  - `make-fragments/Makefile.transport-quic.fragment`
  - `make-fragments/Makefile.packet-capture.fragment`

## `record-platform-och-transport-watchdog-preflight-kafka-mesh-full-scripts-reference-20260410.tar.gz`
- Full path: `/Users/tom/record-platform-och-transport-watchdog-preflight-kafka-mesh-full-scripts-reference-20260410.tar.gz`
- Members (raw, non-empty): **821**
- Stripped prefix: `record-platform-och-transport-watchdog-preflight-kafka-mesh-full-scripts-reference-20260410/`
- Paths checked: **820**
- **MISSING (all): 39** — **MISSING (infra focus): 0**

### MISSING — all (first 39, for forensics)
  - `TRANSPORT_WATCHDOG_API_GATEWAY.md`
  - `KAFKA_TLS_EKU_STALE_DNS_AND_SCRIPTS.md`
  - `SELF_BUILT_SERVICE_MESH.md`
  - `services/transport-watchdog`
  - `services/transport-watchdog/Dockerfile`
  - `services/transport-watchdog/package.json`
  - `services/transport-watchdog/tsconfig.json`
  - `services/transport-watchdog/src`
  - `services/transport-watchdog/src/index.ts`
  - `services/api-gateway/tests`
  - `services/api-gateway/README.md`
  - `services/api-gateway/vitest.config.ts`
  - `services/api-gateway/src/gateway-traffic-skip.ts`
  - `services/api-gateway/src/watchdog-throttle-poll.ts`
  - `services/api-gateway/src/cluster-weight-budget.ts`
  - `services/api-gateway/src/proxy-limits.ts`
  - `services/api-gateway/src/e2e-traffic-shaper.ts`
  - `services/api-gateway/src/e2e-test-mode-inflight-cap.ts`
  - `services/api-gateway/tests/smoke.test.ts`
  - `infra/k8s/base/media-service`
  - `infra/k8s/base/notification-service`
  - `infra/k8s/base/trust-service`
  - `infra/k8s/base/booking-service`
  - `infra/k8s/base/messaging-service`
  - `infra/k8s/base/messaging-service/kustomization.yaml`
  - `infra/k8s/base/messaging-service/deploy.yaml`
  - `infra/k8s/base/messaging-service/service.yaml`
  - `infra/k8s/base/booking-service/kustomization.yaml`
  - `infra/k8s/base/booking-service/deploy.yaml`
  - `infra/k8s/base/booking-service/service.yaml`
  - `infra/k8s/base/trust-service/kustomization.yaml`
  - `infra/k8s/base/trust-service/deploy.yaml`
  - `infra/k8s/base/trust-service/service.yaml`
  - `infra/k8s/base/notification-service/kustomization.yaml`
  - `infra/k8s/base/notification-service/deploy.yaml`
  - `infra/k8s/base/notification-service/service.yaml`
  - `infra/k8s/base/media-service/kustomization.yaml`
  - `infra/k8s/base/media-service/deploy.yaml`
  - `infra/k8s/base/media-service/service.yaml`

## `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409.tar.gz`
- Full path: `/Users/tom/record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409.tar.gz`
- Members (raw, non-empty): **587**
- Stripped prefix: `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/`
- Paths checked: **586**
- **MISSING (all): 375** — **MISSING (infra focus): 0**

### MISSING — all (first 120, for forensics)
  - `RECORD_PLATFORM_CONTINUATION.md`
  - `tests`
  - `vitest.account-deletion.config.ts`
  - `ANALYTICS_AND_OLLAMA.md`
  - `services/media-service`
  - `services/notification-service`
  - `services/event-layer-verification`
  - `services/README.md`
  - `services/transport-watchdog`
  - `services/trust-service`
  - `services/booking-service`
  - `services/messaging-service`
  - `services/messaging-service/generated`
  - `services/messaging-service/Dockerfile`
  - `services/messaging-service/prisma`
  - `services/messaging-service/tests`
  - `services/messaging-service/README.md`
  - `services/messaging-service/package.json`
  - `services/messaging-service/tsconfig.json`
  - `services/messaging-service/vitest.config.ts`
  - `services/messaging-service/src`
  - `services/messaging-service/src/types`
  - `services/messaging-service/src/rateLimit.ts`
  - `services/messaging-service/src/kafkaMessagingEvents.ts`
  - `services/messaging-service/src/lib`
  - `services/messaging-service/src/grpc-server.ts`
  - `services/messaging-service/src/server.ts`
  - `services/messaging-service/src/routes`
  - `services/messaging-service/src/user-lifecycle-consumer.ts`
  - `services/messaging-service/src/routes/messages.ts`
  - `services/messaging-service/src/routes/forum.ts`
  - `services/messaging-service/src/lib/singleflight_cache.lua`
  - `services/messaging-service/src/lib/cache.ts`
  - `services/messaging-service/src/lib/db.ts`
  - `services/messaging-service/src/lib/auth.ts`
  - `services/messaging-service/src/types/ioredis.d.ts`
  - `services/messaging-service/tests/integration`
  - `services/messaging-service/tests/setup`
  - `services/messaging-service/tests/setup/env.ts`
  - `services/messaging-service/tests/integration/messaging-flow.integration.test.ts`
  - `services/messaging-service/tests/integration/README.md`
  - `services/messaging-service/prisma/schema.prisma`
  - `services/messaging-service/generated/client`
  - `services/messaging-service/generated/client/wasm-edge-light-loader.mjs`
  - `services/messaging-service/generated/client/client.js`
  - `services/messaging-service/generated/client/edge.d.ts`
  - `services/messaging-service/generated/client/schema.prisma`
  - `services/messaging-service/generated/client/wasm.d.ts`
  - `services/messaging-service/generated/client/wasm-worker-loader.mjs`
  - `services/messaging-service/generated/client/runtime`
  - `services/messaging-service/generated/client/index.js`
  - `services/messaging-service/generated/client/edge.js`
  - `services/messaging-service/generated/client/libquery_engine-linux-arm64-openssl-3.0.x.so.node`
  - `services/messaging-service/generated/client/index-browser.js`
  - `services/messaging-service/generated/client/package.json`
  - `services/messaging-service/generated/client/query_engine_bg.js`
  - `services/messaging-service/generated/client/libquery_engine-darwin-arm64.dylib.node`
  - `services/messaging-service/generated/client/wasm.js`
  - `services/messaging-service/generated/client/default.js`
  - `services/messaging-service/generated/client/index.d.ts`
  - `services/messaging-service/generated/client/default.d.ts`
  - `services/messaging-service/generated/client/libquery_engine-darwin.dylib.node`
  - `services/messaging-service/generated/client/libquery_engine-debian-openssl-3.0.x.so.node`
  - `services/messaging-service/generated/client/client.d.ts`
  - `services/messaging-service/generated/client/query_engine_bg.wasm`
  - `services/messaging-service/generated/client/runtime/wasm-engine-edge.js`
  - `services/messaging-service/generated/client/runtime/wasm-compiler-edge.js`
  - `services/messaging-service/generated/client/runtime/library.js`
  - `services/messaging-service/generated/client/runtime/edge.js`
  - `services/messaging-service/generated/client/runtime/index-browser.js`
  - `services/messaging-service/generated/client/runtime/library.d.ts`
  - `services/messaging-service/generated/client/runtime/index-browser.d.ts`
  - `services/messaging-service/generated/client/runtime/edge-esm.js`
  - `services/messaging-service/generated/client/runtime/react-native.js`
  - `services/booking-service/Dockerfile`
  - `services/booking-service/vitest.integration.kafka-topics-bootstrap.ts`
  - `services/booking-service/prisma`
  - `services/booking-service/tests`
  - `services/booking-service/README.md`
  - `services/booking-service/vitest.integration.global-setup.ts`
  - `services/booking-service/package.json`
  - `services/booking-service/vitest.integration.config.mts`
  - `services/booking-service/tsconfig.json`
  - `services/booking-service/vitest.config.ts`
  - `services/booking-service/vitest.integration.kafka-env.ts`
  - `services/booking-service/src`
  - `services/booking-service/src/http-app.ts`
  - `services/booking-service/src/lib`
  - `services/booking-service/src/grpc-server.ts`
  - `services/booking-service/src/server.ts`
  - `services/booking-service/src/user-lifecycle-consumer.ts`
  - `services/booking-service/src/lib/prisma.ts`
  - `services/booking-service/tests/smoke.test.ts`
  - `services/booking-service/tests/booking-http.integration.test.ts`
  - `services/booking-service/prisma/generated`
  - `services/booking-service/prisma/migrations`
  - `services/booking-service/prisma/schema.prisma`
  - `services/booking-service/prisma/migrations/migration_lock.toml`
  - `services/booking-service/prisma/migrations/20260330104500_booking_processed_events`
  - `services/booking-service/prisma/migrations/20260320180000_align_booking_with_domain_schema`
  - `services/booking-service/prisma/migrations/20260317120000_init_booking_service`
  - `services/booking-service/prisma/migrations/20260406120000_booking_tenant_notes`
  - `services/booking-service/prisma/migrations/20260406120000_booking_tenant_notes/migration.sql`
  - `services/booking-service/prisma/migrations/20260317120000_init_booking_service/migration.sql`
  - `services/booking-service/prisma/migrations/20260320180000_align_booking_with_domain_schema/migration.sql`
  - `services/booking-service/prisma/migrations/20260330104500_booking_processed_events/migration.sql`
  - `services/booking-service/prisma/generated/client`
  - `services/booking-service/prisma/generated/client/wasm-edge-light-loader.mjs`
  - `services/booking-service/prisma/generated/client/client.js`
  - `services/booking-service/prisma/generated/client/edge.d.ts`
  - `services/booking-service/prisma/generated/client/schema.prisma`
  - `services/booking-service/prisma/generated/client/wasm.d.ts`
  - `services/booking-service/prisma/generated/client/wasm-worker-loader.mjs`
  - `services/booking-service/prisma/generated/client/runtime`
  - `services/booking-service/prisma/generated/client/index.js`
  - `services/booking-service/prisma/generated/client/edge.js`
  - `services/booking-service/prisma/generated/client/libquery_engine-linux-arm64-openssl-3.0.x.so.node`
  - `services/booking-service/prisma/generated/client/index-browser.js`
  - `services/booking-service/prisma/generated/client/package.json`
  - `services/booking-service/prisma/generated/client/query_engine_bg.js`
  - … and **255** more

## `record-platform-quic-transport-porting-bundle-20260416-192801.tar.gz`
- Full path: `/Users/tom/record-platform-quic-transport-porting-bundle-20260416-192801.tar.gz`
- Members (raw, non-empty): **45**
- Stripped prefix: `record-platform-quic-transport-porting-bundle/`
- Paths checked: **44**
- **MISSING (all): 5** — **MISSING (infra focus): 0**

### MISSING — all (first 5, for forensics)
  - `MANIFEST.txt`
  - `make-fragments`
  - `README_PORTING.txt`
  - `make-fragments/Makefile.transport-quic.fragment`
  - `make-fragments/Makefile.packet-capture.fragment`

## `record.test-och-housing-20260418-161510.tar.gz`
- Full path: `/Users/tom/record.test-och-housing-20260418-161510.tar.gz`
- Members (raw, non-empty): **24**
- Stripped prefix: `(none)`
- Paths checked: **24**
- **MISSING (all): 2** — **MISSING (infra focus): 0**

### MISSING — all (first 2, for forensics)
  - `RECORD.test`
  - `nvmrc`

## `preflight-cluster-quic-scripts-20260418-165316.tar.gz`
- Full path: `/Users/tom/preflight-cluster-quic-scripts-20260418-165316.tar.gz`
- Members (raw, non-empty): **277**
- Stripped prefix: `(none)`
- Paths checked: **277**
- **MISSING (all): 0** — **MISSING (infra focus): 0**

## `preflight-cluster-quic-scripts-20260418-165326.tar.gz`
- Full path: `/Users/tom/preflight-cluster-quic-scripts-20260418-165326.tar.gz`
- Members (raw, non-empty): **276**
- Stripped prefix: `(none)`
- Paths checked: **276**
- **MISSING (all): 0** — **MISSING (infra focus): 0**

## `preflight-cluster-quic-scripts-20260418-165415.tar.gz`
- Full path: `/Users/tom/preflight-cluster-quic-scripts-20260418-165415.tar.gz`
- Members (raw, non-empty): **277**
- Stripped prefix: `(none)`
- Paths checked: **277**
- **MISSING (all): 0** — **MISSING (infra focus): 0**

## `och-preflight-cluster-stability-jaeger-transport-bundle-20260418-011502.tar.gz`
- Full path: `/Users/tom/och-preflight-cluster-stability-jaeger-transport-bundle-20260418-011502.tar.gz`
- Members (raw, non-empty): **71**
- Stripped prefix: `och-preflight-cluster-stability-jaeger-transport-bundle/`
- Paths checked: **70**
- **MISSING (all): 6** — **MISSING (infra focus): 0**

### MISSING — all (first 6, for forensics)
  - `MANIFEST.txt`
  - `make-fragments`
  - `README_BUNDLE.txt`
  - `services/listings-service/vitest.integration.config.mts`
  - `make-fragments/Makefile.transport-quic.fragment`
  - `make-fragments/Makefile.packet-capture.fragment`

## `kafka-kraft-3broker-chaos-suite-bundle-20260418-022748.tar.gz`
- Full path: `/Users/tom/kafka-kraft-3broker-chaos-suite-bundle-20260418-022748.tar.gz`
- Members (raw, non-empty): **88**
- Stripped prefix: `kafka-kraft-3broker-chaos-suite-bundle/`
- Paths checked: **87**
- **MISSING (all): 7** — **MISSING (infra focus): 0**

### MISSING — all (first 7, for forensics)
  - `MANIFEST.txt`
  - `make-fragments`
  - `README_BUNDLE.txt`
  - `make-fragments/Makefile.apply-kafka-kraft.fragment`
  - `make-fragments/Makefile.chaos-suite-kafka.fragment`
  - `make-fragments/Makefile.kafka-alignment-suite.fragment`
  - `make-fragments/Makefile.kafka-health-and-chaos-cert.fragment`

---

## SHA-256 sidecars (`shasum -a 256 -c`)

- `/Users/tom/preflight-cluster-quic-scripts-20260418-165316.sha256` → **OK** (/Users/tom/preflight-cluster-quic-scripts-20260418-165316.tar.gz: OK)
- `/Users/tom/preflight-cluster-quic-scripts-20260418-165326.sha256` → **OK** (/Users/tom/preflight-cluster-quic-scripts-20260418-165326.tar.gz: OK)
- `/Users/tom/preflight-cluster-quic-scripts-20260418-165415.sha256` → **OK** (/Users/tom/preflight-cluster-quic-scripts-20260418-165415.tar.gz: OK)
- `/Users/tom/record.test-och-housing-20260418-161510.sha256` → **OK** (/Users/tom/record.test-och-housing-20260418-161510.tar.gz: OK)

---

## Reference: `scripts/run-preflight-scale-and-all-suites.sh` (QUIC bundles vs repo)

- Repo SHA-256: `e38e158f3ac6d0bbd166fb8f3a39064d862ddbf41e9d2bef9ec9f373f9278471`

| QUIC archive | SHA-256 (member) | Match repo |
|--------------|------------------|------------|
| `preflight-cluster-quic-scripts-20260418-165316.tar.gz` | `e38e158f3ac6d0bbd166fb8f3a39064d862ddbf41e9d2bef9ec9f373f9278471` | **yes** |
| `preflight-cluster-quic-scripts-20260418-165326.tar.gz` | `e38e158f3ac6d0bbd166fb8f3a39064d862ddbf41e9d2bef9ec9f373f9278471` | **yes** |
| `preflight-cluster-quic-scripts-20260418-165415.tar.gz` | `e38e158f3ac6d0bbd166fb8f3a39064d862ddbf41e9d2bef9ec9f373f9278471` | **yes** |

Use the QUIC bundle as a **reference** for phase gates / transport / cluster stability wiring; merge deltas into the repo script while keeping **Record** defaults (`record.test`, `record-platform`, `kafka-ssl-secret`, api-gateway **:4000**).

