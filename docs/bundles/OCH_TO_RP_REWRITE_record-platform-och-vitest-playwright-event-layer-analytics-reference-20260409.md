# OCH → RP rewrite scan: `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409`

**Staging (read-only scan):** `/Users/tom/bundle-staging/record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409`

This report lists **detected** OCH-era strings. It does **not** apply edits.

---

## Namespace references

*Kubernetes / config namespace strings*

**Hits:** 102 (capped per file in scanner)

- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/README-BUNDLE.md`
  - L3: `**Purpose:** Continue **Record Platform** (or another repo) with the same **Vitest**, **Kafka/event-layer verification**, **system contract tests**, and **Playwright** patterns from **Off-Campus-Ho…`
  - L44: `Follow **Off-Campus-Housing-Tracker** upstream license.`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/RECORD_PLATFORM_CONTINUATION.md`
  - L64: `**Record Platform:** change **`baseURL`**, **`E2E_API_BASE`**, and hosts from **`off-campus-housing.test`** to your edge hostname. Provide **`certs/dev-root.pem`** (or **`NODE_EXTRA_CA_CERTS`**) as…`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/package.json`
  - L2: `"name": "off-campus-housing-tracker",`
  - L52: `"setup:full-stack": "bash scripts/setup-full-off-campus-housing-stack.sh",`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/common.proto`
  - L7: `option go_package = "github.com/yourorg/off-campus-housing-tracker/proto/common";`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/analytics.proto`
  - L5: `option go_package = "github.com/yourorg/off-campus-housing-tracker/proto/events/analytics";`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/auth.proto`
  - L5: `option go_package = "github.com/yourorg/off-campus-housing-tracker/proto/events/auth";`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/booking.proto`
  - L5: `option go_package = "github.com/yourorg/off-campus-housing-tracker/proto/events/booking";`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/envelope.proto`
  - L5: `option go_package = "github.com/yourorg/off-campus-housing-tracker/proto/events";`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/listing.proto`
  - L5: `option go_package = "github.com/yourorg/off-campus-housing-tracker/proto/events/listing";`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/media.proto`
  - L5: `option go_package = "github.com/yourorg/off-campus-housing-tracker/proto/events/media";`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/messaging.proto`
  - L5: `option go_package = "github.com/yourorg/off-campus-housing-tracker/proto/events/messaging";`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/messaging/v1/messaging_events.proto`
  - L5: `option go_package = "github.com/yourorg/off-campus-housing/proto/events/messaging/v1";`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/notification.proto`
  - L5: `option go_package = "github.com/yourorg/off-campus-housing-tracker/proto/events/notification";`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/trust.proto`
  - L5: `option go_package = "github.com/yourorg/off-campus-housing-tracker/proto/events/trust";`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/create-kafka-event-topics-k8s.sh`
  - L10: `#   KAFKA_K8S_NS=off-campus-housing-tracker`
  - L21: `NS="${KAFKA_K8S_NS:-off-campus-housing-tracker}"`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/lib/edge-test-url.sh`
  - L2: `# Shared helpers: edge-only E2E / k6 (https://off-campus-housing.test), no port-forward / :4020.`
  - L5: `EDGE_TEST_DEFAULT_BASE="https://off-campus-housing.test"`
  - L53: `local ns="${HOUSING_NS:-off-campus-housing-tracker}"`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/run-playwright-e2e-preflight.sh`
  - L10: `#   E2E_API_BASE           — must be https (default https://off-campus-housing.test)`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/verify-kafka-event-topic-partitions.sh`
  - L36: `_ns="${KAFKA_K8S_NS:-off-campus-housing-tracker}"`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/webapp-playwright-strict-edge.sh`
  - L7: `#   E2E_API_BASE   — https only (default https://off-campus-housing.test); :4020 / http localhost rejected`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/api-gateway/src/server.ts`
  - L52: `const AUTH_GRPC_TARGET = process.env.AUTH_GRPC_TARGET || "auth-service.off-campus-housing-tracker.svc.cluster.local:50061";`
  - L59: `const AUTH_HTTP = process.env.AUTH_HTTP || "http://auth-service.off-campus-housing-tracker.svc.cluster.local:4011";`
  - L60: `const LISTINGS_HTTP = process.env.LISTINGS_HTTP || "http://listings-service.off-campus-housing-tracker.svc.cluster.local:4012";`
  - L61: `const BOOKING_HTTP = process.env.BOOKING_HTTP || "http://booking-service.off-campus-housing-tracker.svc.cluster.local:4013";`
  - L62: `const MESSAGING_HTTP = process.env.MESSAGING_HTTP || "http://messaging-service.off-campus-housing-tracker.svc.cluster.local:4014";`
  - L63: `const TRUST_HTTP = process.env.TRUST_HTTP || "http://trust-service.off-campus-housing-tracker.svc.cluster.local:4016";`
  - L64: `const ANALYTICS_HTTP = process.env.ANALYTICS_HTTP || "http://analytics-service.off-campus-housing-tracker.svc.cluster.local:4017";`
  - L66: `const MEDIA_HTTP = process.env.MEDIA_HTTP || "http://media-service.off-campus-housing-tracker.svc.cluster.local:4018";`
  - L68: `process.env.NOTIFICATION_HTTP || "http://notification-service.off-campus-housing-tracker.svc.cluster.local:4015";`
  - L293: `/^https:\/\/off-campus-housing\.local(:\d+)?$/,`
  - L294: `/^https:\/\/off-campus-housing\.test(:\d+)?$/,`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/auth-service/prisma/generated/client/edge.js`
  - L224: `"value": "/Users/tom/Off-Campus-Housing-Tracker/services/auth-service/prisma/generated/client",`
  - L238: `"sourceFilePath": "/Users/tom/Off-Campus-Housing-Tracker/services/auth-service/prisma/schema.prisma",`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/auth-service/prisma/generated/client/index.js`
  - L225: `"value": "/Users/tom/Off-Campus-Housing-Tracker/services/auth-service/prisma/generated/client",`
  - L239: `"sourceFilePath": "/Users/tom/Off-Campus-Housing-Tracker/services/auth-service/prisma/schema.prisma",`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/auth-service/prisma/generated/client/wasm.js`
  - L224: `"value": "/Users/tom/Off-Campus-Housing-Tracker/services/auth-service/prisma/generated/client",`
  - L238: `"sourceFilePath": "/Users/tom/Off-Campus-Housing-Tracker/services/auth-service/prisma/schema.prisma",`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/auth-service/src/lib/mfa.ts`
  - L43: `const serviceName = "Off-Campus-Housing-Tracker";`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/auth-service/src/lib/verification.ts`
  - L112: `subject: "Off-Campus-Housing-Tracker - Email Verification Code",`
  - L170: `const message = `Your Off-Campus-Housing-Tracker verification code is: ${code}. This code expires in 15 minutes.`;`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/auth-service/src/routes/passkey.ts`
  - L45: `name: 'Off-Campus-Housing-Tracker',`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/auth-service/src/server.ts`
  - L890: `<title>Privacy Policy - Off-Campus-Housing-Tracker</title>`
  - L917: `<li>Create and manage your Off-Campus-Housing-Tracker account</li>`
  - L960: `<li><strong>Email:</strong> support@off-campus-housing-tracker.local</li>`
  - L961: `<li><strong>Platform:</strong> Off-Campus-Housing-Tracker</li>`
  - L977: `<title>Terms of Service - Off-Campus-Housing-Tracker</title>`
  - L993: `<p>By accessing and using Off-Campus-Housing-Tracker ("the Service"), you accept and agree to be bound by the terms and provision of this agreement. If you do not agree to abide by the above, pleas…`
  - L996: `<p>Permission is granted to temporarily use Off-Campus-Housing-Tracker for personal, non-commercial transitory viewing only. This is the grant of a license, not a transfer of title, and under this …`
  - L1008: `<p>The Service and its content are owned by Off-Campus-Housing-Tracker and protected by intellectual property laws.</p>`
  - L1011: `<p>The materials are provided on an 'as is' basis. Off-Campus-Housing-Tracker makes no warranties, expressed or implied.</p>`
  - L1014: `<p>In no event shall Off-Campus-Housing-Tracker be liable for damages arising from use or inability to use the Service.</p>`
  - L1023: `<p>If you have questions about these Terms, please contact us at support@off-campus-housing-tracker.local</p>`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/booking-service/README.md`
  - L31: `This sets **`OCH_INTEGRATION_KAFKA_FROM_K8S_LB=1`** (legacy alias: **`BOOKING_IT_KAFKA_FROM_K8S_LB=1`**), discovers **`kafka-0-external` … `kafka-2-external`** LoadBalancer IPs in **`off-campus-hou…`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/booking-service/prisma/generated/client/edge.js`
  - L188: `"value": "/Users/tom/Off-Campus-Housing-Tracker/services/booking-service/prisma/generated/client",`
  - L202: `"sourceFilePath": "/Users/tom/Off-Campus-Housing-Tracker/services/booking-service/prisma/schema.prisma",`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/booking-service/prisma/generated/client/index.js`
  - L189: `"value": "/Users/tom/Off-Campus-Housing-Tracker/services/booking-service/prisma/generated/client",`
  - L203: `"sourceFilePath": "/Users/tom/Off-Campus-Housing-Tracker/services/booking-service/prisma/schema.prisma",`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/booking-service/prisma/generated/client/wasm.js`
  - L188: `"value": "/Users/tom/Off-Campus-Housing-Tracker/services/booking-service/prisma/generated/client",`
  - L202: `"sourceFilePath": "/Users/tom/Off-Campus-Housing-Tracker/services/booking-service/prisma/schema.prisma",`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/booking-service/vitest.integration.kafka-env.ts`
  - L23: `"kafka-0.kafka.off-campus-housing-tracker.svc.cluster.local:9093,kafka-1.kafka.off-campus-housing-tracker.svc.cluster.local:9093,kafka-2.kafka.off-campus-housing-tracker.svc.cluster.local:9093";`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/common/src/grpc-clients.ts`
  - L76: `return "off-campus-housing.test";`
  - L90: `export function createAuthClient(address: string = "auth-service.off-campus-housing-tracker.svc.cluster.local:50061") {`
  - L117: `address: string = process.env.AUTH_GRPC_TARGET || "auth-service.off-campus-housing-tracker.svc.cluster.local:50061",`
  - L162: `address: string = process.env.AUTH_GRPC_TARGET || "auth-service.off-campus-housing-tracker.svc.cluster.local:50061",`
  - L209: `export function createListingsClient(address: string = "listings-service.off-campus-housing-tracker.svc.cluster.local:50062") {`
  - L214: `export function createBookingClient(address: string = "booking-service.off-campus-housing-tracker.svc.cluster.local:50063") {`
  - L219: `export function createMessagingClient(address: string = "messaging-service.off-campus-housing-tracker.svc.cluster.local:50064") {`
  - L224: `export function createTrustClient(address: string = "trust-service.off-campus-housing-tracker.svc.cluster.local:50066") {`
  - L229: `export function createAnalyticsClient(address: string = "analytics-service.off-campus-housing-tracker.svc.cluster.local:50067") {`
  - L234: `export function createMediaClient(address: string = "media-service.off-campus-housing-tracker.svc.cluster.local:50068") {`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/common/src/kafka-vitest-cluster.ts`
  - L8: `*   - OCH_INTEGRATION_K8S_NAMESPACE / BOOKING_IT_K8S_NAMESPACE / HOUSING_NS — kubectl namespace (default off-campus-housing-tracker)`
  - L134: `"off-campus-housing-tracker"`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/common/src/kafka.ts`
  - L90: `clientId: process.env.KAFKA_CLIENT_ID || "off-campus-housing-tracker",`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/common/src/redis.ts`
  - L12: `: 'redis-external.off-campus-housing-tracker.svc.cluster.local'`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/common/src/tracing.ts`
  - L9: `const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://otel-collector.off-campus-housing-tracker.svc.cluster.local:4318";`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/cron-jobs/README.md`
  - L9: `| **`NOTIFICATION_HEARTBEAT_URL`** | No (no-op if empty) | `http://notification-service.off-campus-housing-tracker.svc.cluster.local:4015/internal/cron/heartbeat` |`
  - L51: `0 6 * * * /path/to/off-campus-housing-tracker/scripts/run-daily-test-suite-with-results.sh`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/cron-jobs/src/jobs.ts`
  - L6: `* http://notification-service.off-campus-housing-tracker.svc.cluster.local:4015/internal/cron/heartbeat`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/listings-service/src/analytics-sync.ts`
  - L6: `"http://analytics-service.off-campus-housing-tracker.svc.cluster.local:4017";`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/messaging-service/generated/client/edge.js`
  - L270: `"value": "/Users/tom/Off-Campus-Housing-Tracker/services/messaging-service/generated/client",`
  - L284: `"sourceFilePath": "/Users/tom/Off-Campus-Housing-Tracker/services/messaging-service/prisma/schema.prisma",`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/messaging-service/generated/client/index.js`
  - L271: `"value": "/Users/tom/Off-Campus-Housing-Tracker/services/messaging-service/generated/client",`
  - L285: `"sourceFilePath": "/Users/tom/Off-Campus-Housing-Tracker/services/messaging-service/prisma/schema.prisma",`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/messaging-service/generated/client/wasm.js`
  - L270: `"value": "/Users/tom/Off-Campus-Housing-Tracker/services/messaging-service/generated/client",`
  - L284: `"sourceFilePath": "/Users/tom/Off-Campus-Housing-Tracker/services/messaging-service/prisma/schema.prisma",`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/messaging-service/src/lib/cache.ts`
  - L65: `: 'redis-external.off-campus-housing-tracker.svc.cluster.local'),`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/webapp/README.md`
  - L19: `You need **api-gateway** (and backing services) reachable — typically **`https://off-campus-housing.test`** via ingress or, for quick UI work, same-origin rewrites to **`http://127.0.0.1:4020`** (s…`
  - L60: `- **Edge / TLS:** set `NEXT_PUBLIC_API_BASE=https://off-campus-housing.test` and ensure your browser trusts the cert (or use curl with `-k` only for debugging).`
  - L64: `**E2E and k6 always use the edge hostname** (`https://off-campus-housing.test` by default). **`kubectl port-forward` and `http://127.0.0.1:4020` are not valid E2E targets** — if `E2E_API_BASE` is s…`
  - L74: `**Architecture:** `playwright.config.ts` sets **`baseURL`** to **`E2E_API_BASE`** (default **`https://off-campus-housing.test`**) and **`ignoreHTTPSErrors: true`** so Chromium is not blocked by an …`
  - L79: `curl --cacert certs/dev-root.pem https://off-campus-housing.test/api/readyz   # expect 200`
  - L86: `export E2E_API_BASE=https://off-campus-housing.test`
  - L112: `**Edge + gateway required for:** `e2e/guest.spec.ts` (listings+trust), `e2e/flows.spec.ts`, `e2e/auth-cycle.spec.ts`, `e2e/analytics-api.spec.ts`. Ensure the stack is up and **`off-campus-housing.t…`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/webapp/e2e/analytics-api.spec.ts`
  - L13: `test.skip(!(await apiGatewayHealthy(request)), "edge API not reachable — set E2E_API_BASE and ensure https://off-campus-housing.test (or override) resolves");`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/webapp/e2e/helpers.ts`
  - L5: `const DEFAULT_E2E_EDGE = "https://off-campus-housing.test";`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/webapp/lib/config.ts`
  - L3: `* - If NEXT_PUBLIC_API_BASE is set: browser calls that origin (e.g. https://off-campus-housing.test).`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/webapp/playwright.config.ts`
  - L3: `const DEFAULT_E2E = "https://off-campus-housing.test";`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/webapp/playwright.global-setup.ts`
  - L13: `const raw = process.env.E2E_API_BASE?.trim() || "https://off-campus-housing.test";`

## SNI / hostnames

*Hosts, URLs, and dotted domains*

**Hits:** 30 (capped per file in scanner)

- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/RECORD_PLATFORM_CONTINUATION.md`
  - L64: `**Record Platform:** change **`baseURL`**, **`E2E_API_BASE`**, and hosts from **`off-campus-housing.test`** to your edge hostname. Provide **`certs/dev-root.pem`** (or **`NODE_EXTRA_CA_CERTS`**) as…`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/lib/edge-test-url.sh`
  - L2: `# Shared helpers: edge-only E2E / k6 (https://off-campus-housing.test), no port-forward / :4020.`
  - L5: `EDGE_TEST_DEFAULT_BASE="https://off-campus-housing.test"`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/run-playwright-e2e-preflight.sh`
  - L10: `#   E2E_API_BASE           — must be https (default https://off-campus-housing.test)`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/webapp-playwright-strict-edge.sh`
  - L7: `#   E2E_API_BASE   — https only (default https://off-campus-housing.test); :4020 / http localhost rejected`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/api-gateway/src/server.ts`
  - L59: `const AUTH_HTTP = process.env.AUTH_HTTP || "http://auth-service.off-campus-housing-tracker.svc.cluster.local:4011";`
  - L60: `const LISTINGS_HTTP = process.env.LISTINGS_HTTP || "http://listings-service.off-campus-housing-tracker.svc.cluster.local:4012";`
  - L61: `const BOOKING_HTTP = process.env.BOOKING_HTTP || "http://booking-service.off-campus-housing-tracker.svc.cluster.local:4013";`
  - L62: `const MESSAGING_HTTP = process.env.MESSAGING_HTTP || "http://messaging-service.off-campus-housing-tracker.svc.cluster.local:4014";`
  - L63: `const TRUST_HTTP = process.env.TRUST_HTTP || "http://trust-service.off-campus-housing-tracker.svc.cluster.local:4016";`
  - L64: `const ANALYTICS_HTTP = process.env.ANALYTICS_HTTP || "http://analytics-service.off-campus-housing-tracker.svc.cluster.local:4017";`
  - L66: `const MEDIA_HTTP = process.env.MEDIA_HTTP || "http://media-service.off-campus-housing-tracker.svc.cluster.local:4018";`
  - L68: `process.env.NOTIFICATION_HTTP || "http://notification-service.off-campus-housing-tracker.svc.cluster.local:4015";`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/common/src/grpc-clients.ts`
  - L76: `return "off-campus-housing.test";`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/common/src/tracing.ts`
  - L9: `const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://otel-collector.off-campus-housing-tracker.svc.cluster.local:4318";`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/cron-jobs/README.md`
  - L9: `| **`NOTIFICATION_HEARTBEAT_URL`** | No (no-op if empty) | `http://notification-service.off-campus-housing-tracker.svc.cluster.local:4015/internal/cron/heartbeat` |`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/cron-jobs/src/jobs.ts`
  - L6: `* http://notification-service.off-campus-housing-tracker.svc.cluster.local:4015/internal/cron/heartbeat`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/listings-service/src/analytics-sync.ts`
  - L6: `"http://analytics-service.off-campus-housing-tracker.svc.cluster.local:4017";`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/webapp/README.md`
  - L19: `You need **api-gateway** (and backing services) reachable — typically **`https://off-campus-housing.test`** via ingress or, for quick UI work, same-origin rewrites to **`http://127.0.0.1:4020`** (s…`
  - L60: `- **Edge / TLS:** set `NEXT_PUBLIC_API_BASE=https://off-campus-housing.test` and ensure your browser trusts the cert (or use curl with `-k` only for debugging).`
  - L64: `**E2E and k6 always use the edge hostname** (`https://off-campus-housing.test` by default). **`kubectl port-forward` and `http://127.0.0.1:4020` are not valid E2E targets** — if `E2E_API_BASE` is s…`
  - L74: `**Architecture:** `playwright.config.ts` sets **`baseURL`** to **`E2E_API_BASE`** (default **`https://off-campus-housing.test`**) and **`ignoreHTTPSErrors: true`** so Chromium is not blocked by an …`
  - L79: `curl --cacert certs/dev-root.pem https://off-campus-housing.test/api/readyz   # expect 200`
  - L86: `export E2E_API_BASE=https://off-campus-housing.test`
  - L112: `**Edge + gateway required for:** `e2e/guest.spec.ts` (listings+trust), `e2e/flows.spec.ts`, `e2e/auth-cycle.spec.ts`, `e2e/analytics-api.spec.ts`. Ensure the stack is up and **`off-campus-housing.t…`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/webapp/e2e/analytics-api.spec.ts`
  - L13: `test.skip(!(await apiGatewayHealthy(request)), "edge API not reachable — set E2E_API_BASE and ensure https://off-campus-housing.test (or override) resolves");`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/webapp/e2e/helpers.ts`
  - L5: `const DEFAULT_E2E_EDGE = "https://off-campus-housing.test";`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/webapp/lib/config.ts`
  - L3: `* - If NEXT_PUBLIC_API_BASE is set: browser calls that origin (e.g. https://off-campus-housing.test).`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/webapp/playwright.config.ts`
  - L3: `const DEFAULT_E2E = "https://off-campus-housing.test";`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/webapp/playwright.global-setup.ts`
  - L13: `const raw = process.env.E2E_API_BASE?.trim() || "https://off-campus-housing.test";`

## OCH-prefixed identifiers

*Secrets, services, env keys with och- / och_*

**Hits:** 160 (capped per file in scanner)

- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/RECORD_PLATFORM_CONTINUATION.md`
  - L5: `**Option A — subtree folder:** Unpack this tarball into e.g. `vendor/och-testing-reference/` and copy paths you need.`
  - L38: `- **Kafka TLS integration** often requires **`OCH_INTEGRATION_KAFKA_FROM_K8S_LB=1`** (or explicit **`KAFKA_BROKER`**) and PEM material under **`certs/kafka-ssl/`** — see each service **README** and…`
  - L75: `| `OCH_INTEGRATION_KAFKA_FROM_K8S_LB=1` | Integration tests using MetalLB Kafka external listeners. |`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/package.json`
  - L23: `"test:system": "OCH_INTEGRATION_KAFKA_FROM_K8S_LB=1 ROLLUP_DISABLE_NATIVE=true vitest run --config vitest.system.config.mts",`
  - L34: `"rebuild:och:rollout": "bash scripts/rebuild-och-images-and-rollout.sh",`
  - L37: `"rebuild:service:analytics": "SERVICES=analytics-service bash scripts/rebuild-och-images-and-rollout.sh",`
  - L38: `"rebuild:service:auth": "SERVICES=auth-service bash scripts/rebuild-och-images-and-rollout.sh",`
  - L39: `"rebuild:service:booking": "SERVICES=booking-service bash scripts/rebuild-och-images-and-rollout.sh",`
  - L40: `"rebuild:service:cron": "SERVICES=cron-jobs bash scripts/rebuild-och-images-and-rollout.sh",`
  - L41: `"rebuild:service:listings": "SERVICES=listings-service bash scripts/rebuild-och-images-and-rollout.sh",`
  - L42: `"rebuild:service:media": "SERVICES=media-service bash scripts/rebuild-och-images-and-rollout.sh",`
  - L43: `"rebuild:service:messaging": "SERVICES=messaging-service bash scripts/rebuild-och-images-and-rollout.sh",`
  - L44: `"rebuild:service:notification": "SERVICES=notification-service bash scripts/rebuild-och-images-and-rollout.sh",`
  - L45: `"rebuild:service:search": "SERVICES=listings-service bash scripts/rebuild-och-images-and-rollout.sh",`
  - L46: `"rebuild:service:trust": "SERVICES=trust-service bash scripts/rebuild-och-images-and-rollout.sh",`
  - L47: `"rebuild:service:watchdog": "SERVICES=transport-watchdog bash scripts/rebuild-och-images-and-rollout.sh",`
  - L48: `"rebuild:gateway:rollout": "SERVICES=api-gateway bash scripts/rebuild-och-images-and-rollout.sh",`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/assert-kafka-integration-cluster.mjs`
  - L5: `* Discovers MetalLB brokers when OCH_INTEGRATION_KAFKA_FROM_K8S_LB=1 (same as @common/utils/kafka-vitest-cluster).`
  - L7: `* Skip (e.g. CI without cluster): OCH_SKIP_KAFKA_INTEGRATION_ASSERT=1`
  - L18: `if (process.env.OCH_SKIP_KAFKA_INTEGRATION_ASSERT === "1" || process.env.OCH_SKIP_KAFKA_INTEGRATION_ASSERT === "true") {`
  - L19: `console.warn("[och-it] assert-kafka-integration-cluster: skipped (OCH_SKIP_KAFKA_INTEGRATION_ASSERT=1)");`
  - L25: `console.error("[och-it] Missing services/common/dist/kafka-vitest-cluster.js — run: pnpm -C services/common run build");`
  - L29: `process.env.OCH_INTEGRATION_KAFKA_FROM_K8S_LB ??= "1";`
  - L35: `console.log("[och-it] Kafka cluster integration policy OK (≥3 TLS seeds, PEM material, no plaintext shortcuts).");`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/create-kafka-event-topics-k8s.sh`
  - L13: `#   ENV_PREFIX, PARTITIONS, OCH_KAFKA_TOPIC_SUFFIX — same as create-kafka-event-topics.sh`
  - L39: `och_topic_suffix() {`
  - L40: `local raw="${OCH_KAFKA_TOPIC_SUFFIX:-}"`
  - L46: `SUF="$(och_topic_suffix)"`
  - L48: `# shellcheck source=lib/och-kafka-event-topics-from-proto.sh`
  - L49: `source "$SCRIPT_DIR/lib/och-kafka-event-topics-from-proto.sh"`
  - L50: `och_kafka_event_topics_fill || die "Could not build topic list from proto/events"`
  - L51: `TOPICS=("${OCH_KAFKA_EVENT_TOPICS[@]}")`
  - L66: `} > /tmp/och-k8s-topics.props'`
  - L73: `kubectl exec -n "$NS" "$KPOD" -- kafka-topics --bootstrap-server "$BS" --command-config /tmp/och-k8s-topics.props "$@"`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/create-kafka-event-topics.sh`
  - L5: `# Isolation: when OCH_KAFKA_TOPIC_SUFFIX is set (e.g. GITHUB_RUN_ID), the same rules as`
  - L20: `#   OCH_KAFKA_TOPIC_SUFFIX=...       — optional CI/test isolation (matches services)`
  - L23: `#   OCH_KAFKA_TOPICS_DELETE=1         — delete the same topic set (--if-exists), then exit (optional CI/teardown)`
  - L37: `och_topic_suffix() {`
  - L38: `local raw="${OCH_KAFKA_TOPIC_SUFFIX:-}"`
  - L47: `SUF="$(och_topic_suffix)"`
  - L53: `# Topic names derived from proto/events/*.proto (+ explicit booking.events.v1 + messaging.dlq). See scripts/lib/och-kafka-event-topics-from-proto.sh`
  - L54: `# shellcheck source=lib/och-kafka-event-topics-from-proto.sh`
  - L55: `source "$SCRIPT_DIR/lib/och-kafka-event-topics-from-proto.sh"`
  - L56: `och_kafka_event_topics_fill || die "Could not build topic list from proto/events"`
  - L57: `TOPICS=("${OCH_KAFKA_EVENT_TOPICS[@]}")`
  - L71: `} > /tmp/och-kafka-event-topics.props'`
  - L108: `CONFIG_ARGS=(--command-config /tmp/och-kafka-event-topics.props)`
  - L115: `if [[ "${OCH_KAFKA_TOPICS_DELETE:-}" == "1" ]]; then`
  - L116: `say "OCH_KAFKA_TOPICS_DELETE=1 — deleting listed topics (best-effort, --if-exists)"`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/lib/edge-test-url.sh`
  - L68: `echo "  (Could not discover LB IP — set OCH_EDGE_IP=... from: kubectl get svc -A | grep LoadBalancer)" >&2`
  - L72: `echo "    export OCH_EDGE_IP=$ip" >&2`
  - L76: `echo "  Or: OCH_AUTO_EDGE_HOSTS=1 (uses OCH_EDGE_IP or discovered LB IP; requires sudo on non-root)" >&2`
  - L83: `[[ "${OCH_AUTO_EDGE_HOSTS:-0}" != "1" ]] && return 0`
  - L85: `echo "⚠️  OCH_AUTO_EDGE_HOSTS=1 but IP invalid: $ip" >&2`
  - L101: `echo "❌ OCH_AUTO_EDGE_HOSTS=1 but cannot write /etc/hosts (need root or sudo)" >&2`
  - L124: `local lb="${OCH_EDGE_IP:-}"`
  - L140: `echo "❌ DNS: cannot resolve $host — set OCH_EDGE_IP=<LoadBalancer_IP> and add hosts line, or use OCH_AUTO_EDGE_HOSTS=1 with sudo" >&2`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/lib/och-kafka-event-topics-from-proto.sh`
  - L2: `# Shared: derive OCH_KAFKA_EVENT_TOPICS from proto/events/*.proto (single source of truth with explicit exceptions).`
  - L9: `#   OCH_KAFKA_EVENT_TOPICS — bash array of topic names (sorted unique)`
  - L17: `och_kafka_event_topics_fill() {`
  - L18: `OCH_KAFKA_EVENT_TOPICS=()`
  - L56: `OCH_KAFKA_EVENT_TOPICS+=("$line")`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/verify-kafka-event-topic-partitions.sh`
  - L24: `# shellcheck source=lib/och-kafka-event-topics-from-proto.sh`
  - L25: `source "$SCRIPT_DIR/lib/och-kafka-event-topics-from-proto.sh"`
  - L26: `och_kafka_event_topics_fill || fail "Could not build topic list from proto/events"`
  - L27: `TOPICS=("${OCH_KAFKA_EVENT_TOPICS[@]}")`
  - L50: `} > /tmp/och-kafka-verify.props'`
  - L54: `out="$(kubectl exec -n "$_ns" "$_pod" -- kafka-topics --bootstrap-server "$_bs" --command-config /tmp/och-kafka-verify.props --describe --topic "$t" 2>/dev/null | head -8 || true)"`
  - L97: `} > /tmp/och-kafka-verify.props`
  - L104: `kafka-topics --bootstrap-server localhost:9093 --command-config /tmp/och-kafka-verify.props --describe --topic "$KAFKA_TOPIC" 2>/dev/null | head -8`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/verify-proto-events-topics.sh`
  - L30: `grep -q 'och-kafka-event-topics-from-proto.sh' "$TOPIC_SCRIPT" || fail "$TOPIC_SCRIPT must source scripts/lib/och-kafka-event-topics-from-proto.sh"`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/verify-proto-topic-alignment.sh`
  - L3: `# implemented in scripts/lib/och-kafka-event-topics-from-proto.sh. Fails on drift (new proto without wiring).`
  - L6: `#   ENV_PREFIX=dev  OCH_KAFKA_TOPIC_SUFFIX=   PROTO_EVENTS_ROOT=... (optional)`
  - L19: `raw="${OCH_KAFKA_TOPIC_SUFFIX:-}"`
  - L25: `# shellcheck source=lib/och-kafka-event-topics-from-proto.sh`
  - L26: `source "$SCRIPT_DIR/lib/och-kafka-event-topics-from-proto.sh"`
  - L27: `och_kafka_event_topics_fill || fail "Could not build topic list from proto/events"`
  - L29: `och_topic_list_contains() {`
  - L31: `for t in "${OCH_KAFKA_EVENT_TOPICS[@]}"; do`
  - L45: `och_topic_list_contains "messaging.events.v1" || fail "messaging.proto must map to topic messaging.events.v1"`
  - L48: `och_topic_list_contains "$exp" || fail "Proto $base.proto expects Kafka topic '$exp' in derived topic set (got ${#OCH_KAFKA_EVENT_TOPICS[@]} topics)"`
  - L52: `och_topic_list_contains "${ENV_PREFIX}.booking.events.v1${SUF}" || fail "Missing ${ENV_PREFIX}.booking.events.v1${SUF}"`
  - L53: `och_topic_list_contains "${ENV_PREFIX}.messaging.dlq${SUF}" || fail "Missing ${ENV_PREFIX}.messaging.dlq${SUF}"`
  - L55: `ok "proto/events ↔ Kafka topic naming contract OK (${#OCH_KAFKA_EVENT_TOPICS[@]} topics, ENV_PREFIX=$ENV_PREFIX)"`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/booking-service/README.md`
  - L21: ``./scripts/rebuild-och-images-and-rollout.sh` (or your usual tag/push flow). ConfigMap **`app-config`** already sets **`KAFKA_BROKER`** to a **comma-separated three-broker** bootstrap for in-cluste…`
  - L31: `This sets **`OCH_INTEGRATION_KAFKA_FROM_K8S_LB=1`** (legacy alias: **`BOOKING_IT_KAFKA_FROM_K8S_LB=1`**), discovers **`kafka-0-external` … `kafka-2-external`** LoadBalancer IPs in **`off-campus-hou…`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/booking-service/package.json`
  - L12: `"test:integration": "OCH_INTEGRATION_KAFKA_FROM_K8S_LB=1 ROLLUP_DISABLE_NATIVE=true vitest run --config vitest.integration.config.mts",`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/booking-service/vitest.integration.config.mts`
  - L7: `process.env.OCH_KAFKA_TOPIC_SUFFIX?.trim() ||`
  - L10: `process.env.OCH_KAFKA_TOPIC_SUFFIX = topicSuffix;`
  - L16: `OCH_KAFKA_TOPIC_SUFFIX: topicSuffix,`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/booking-service/vitest.integration.kafka-env.ts`
  - L3: `* See monorepo docs / booking README for OCH_INTEGRATION_KAFKA_FROM_K8S_LB and TLS layout.`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/common/src/grpc-server-credentials.ts`
  - L15: `* Local/CI integration: if **OCH_GRPC_INSECURE_TEST_BIND=1** and **NODE_ENV** is not **production**,`
  - L21: `process.env.OCH_GRPC_INSECURE_TEST_BIND === "1" ||`
  - L22: `process.env.OCH_GRPC_INSECURE_TEST_BIND === "true";`
  - L25: ``[${label}] OCH_GRPC_INSECURE_TEST_BIND: insecure gRPC bind (tests only; NODE_ENV=${process.env.NODE_ENV ?? "(unset)"})`,`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/common/src/kafka-vitest-cluster.ts`
  - L6: `*   - OCH_INTEGRATION_KAFKA_FROM_K8S_LB=1 — discover kafka-{0,1,2}-external LoadBalancer IPs (alias: BOOKING_IT_KAFKA_FROM_K8S_LB=1)`
  - L7: `*   - OCH_INTEGRATION_KAFKA_BROKERS / BOOKING_IT_KAFKA_BROKERS — optional multi-seed string copied to KAFKA_BROKER`
  - L8: `*   - OCH_INTEGRATION_K8S_NAMESPACE / BOOKING_IT_K8S_NAMESPACE / HOUSING_NS — kubectl namespace (default off-campus-housing-tracker)`
  - L32: ``[och-it] Integration requires >=${MIN_TOPIC_REPLICATION_ENFORCED} Kafka broker seeds (MetalLB TLS cluster only); got ${seeds.length}.`,`
  - L36: `throw new Error("[och-it] Duplicate Kafka broker seeds are not allowed.");`
  - L40: `throw new Error(`[och-it] Localhost / loopback Kafka brokers are forbidden for integration: ${seed}`);`
  - L43: `throw new Error(`[och-it] Port 29092 (host-compose plaintext) is forbidden for cluster integration: ${seed}`);`
  - L54: `"[och-it] TLS requires KAFKA_CA_CERT (or KAFKA_SSL_CA_PATH), KAFKA_CLIENT_CERT (or KAFKA_SSL_CERT_PATH), KAFKA_CLIENT_KEY (or KAFKA_SSL_KEY_PATH) pointing at PEM files on disk.",`
  - L63: `throw new Error(`[och-it] Missing TLS PEM file (${label}): ${p}`);`
  - L76: `throw new Error(`[och-it] fetchTopicMetadata: topic "${topicName}" not in metadata`);`
  - L82: ``[och-it] Topic "${topicName}" partition ${p.partitionId} has replica assignment count ${n}; require >= ${minRf} (refusing RF=1 / under-replicated test topics).`,`
  - L106: `process.env.OCH_INTEGRATION_KAFKA_FROM_K8S_LB === "1" ||`
  - L131: `process.env.OCH_INTEGRATION_K8S_NAMESPACE?.trim() ||`
  - L142: `"[och-it] TLS required: set KAFKA_CA_CERT, KAFKA_CLIENT_CERT, KAFKA_CLIENT_KEY or add ca-cert.pem + client.crt + client.key under certs/kafka-ssl/ or certs/kafka-ssl-ci/.",`
  - L163: `throw new Error("[och-it] Plaintext Kafka is forbidden for cluster integration / system tests (KAFKA_SSL_ENABLED=false).");`
  - … *10 more in this file*
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/common/src/kafka.ts`
  - L38: `* like LISTING_EVENTS_TOPIC are unset. Producers and consumers must share the same OCH_KAFKA_TOPIC_SUFFIX.`
  - L41: `const raw = process.env.OCH_KAFKA_TOPIC_SUFFIX?.trim();`
  - L111: `* Optional requiredTopics (or OCH_KAFKA_STARTUP_REQUIRED_TOPICS=comma-separated) enforce that topics`
  - L119: `const budgetMs = Number(process.env.OCH_KAFKA_STARTUP_BARRIER_MS || "60000");`
  - L121: `process.env.OCH_KAFKA_STARTUP_REQUIRED_TOPICS?.split(",")`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/listings-service/README.md`
  - L67: `Integration Vitest uses **`vitest.integration.config.mts`**: **no plaintext Kafka**. You need **≥3 TLS broker seeds** (MetalLB `kafka-*-external` :9094 via **`OCH_INTEGRATION_KAFKA_FROM_K8S_LB=1`**…`
  - L70: `# From repo root (script sets OCH_INTEGRATION_KAFKA_FROM_K8S_LB=1); needs kubectl → Colima/k3s + externals`
  - L80: `**gRPC** integration tests use **insecure bind** via **`OCH_GRPC_INSECURE_TEST_BIND=1`** only under this Vitest config.`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/listings-service/package.json`
  - L12: `"test:integration": "OCH_INTEGRATION_KAFKA_FROM_K8S_LB=1 ROLLUP_DISABLE_NATIVE=true KAFKAJS_NO_PARTITIONER_WARNING=1 vitest run --config vitest.integration.config.mts",`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/listings-service/vitest.integration.config.mts`
  - L10: `process.env.OCH_KAFKA_TOPIC_SUFFIX?.trim() ||`
  - L13: `process.env.OCH_KAFKA_TOPIC_SUFFIX = topicSuffix;`
  - L16: `OCH_GRPC_INSECURE_TEST_BIND: "1",`
  - L19: `OCH_KAFKA_TOPIC_SUFFIX: topicSuffix,`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/tests/system/listing-analytics.contract.test.ts`
  - L7: `* Topic creation: `tests/system/global-setup.ts` + `ensureVitestClusterKafkaTopic` (suffix from `vitest.system.config.mts`: `.sys-<pid>-<time>` via `OCH_KAFKA_TOPIC_SUFFIX` / `ochKafkaTopicIsolatio…`
  - L13: `*   OCH_INTEGRATION_KAFKA_FROM_K8S_LB=1 pnpm run test:system`
  - L64: `clientId: "och-system-contract-listing-producer",`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/tools/kafka-contract/src/index.ts`
  - L9: `* Env: REPO_ROOT, KAFKA_CONTRACT_PROTO_ROOT, PROTO_ROOT, ENV_PREFIX, OCH_KAFKA_TOPIC_SUFFIX, KAFKA_BROKER, KAFKA_SSL_*,`
  - L53: `const suf = topicSuffixFromEnv(process.env.OCH_KAFKA_TOPIC_SUFFIX);`
  - L204: `ENV_PREFIX, OCH_KAFKA_TOPIC_SUFFIX, KAFKA_BROKER, KAFKA_SSL_ENABLED,`
  - L207: `OCH_KAFKA_REQUIRE_QUORUM_3=1 — scripts/validate-kafka-stack-contract.sh sets min brokers to 3 when used there`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/tools/kafka-contract/src/topicBuilder.ts`
  - L2: `* Match scripts/lib/och-kafka-event-topics-from-proto.sh + ochKafkaTopicIsolationSuffix().`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/vitest.system.config.mts`
  - L13: `process.env.OCH_REPO_ROOT?.trim() ||`
  - L24: `process.env.OCH_KAFKA_TOPIC_SUFFIX = `.sys-${process.pid}-${Date.now()}`;`
  - L29: `const suffixClean = process.env.OCH_KAFKA_TOPIC_SUFFIX.replace(/^\.+/u, "").replace(/[^a-zA-Z0-9_.-]/gu, "-");`
  - L30: `process.env.ANALYTICS_LISTING_KAFKA_GROUP ??= `och-sys-contract-${suffixClean}`;`
  - L47: `OCH_KAFKA_TOPIC_SUFFIX: process.env.OCH_KAFKA_TOPIC_SUFFIX!,`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/webapp/Dockerfile`
  - L2: `#   docker build -f webapp/Dockerfile -t och-webapp .`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/webapp/app/booking/page.tsx`
  - L17: `const LAST_BOOKING_KEY = "och_last_booking_id";`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/webapp/app/community/page.tsx`
  - L39: `window.addEventListener("och-auth-change", syncAuth);`
  - L42: `window.removeEventListener("och-auth-change", syncAuth);`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/webapp/components/ClientChrome.tsx`
  - L18: `window.addEventListener("och-auth-change", sync);`
  - L19: `return () => window.removeEventListener("och-auth-change", sync);`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/webapp/components/MessagingSidebar.tsx`
  - L34: `if (e.key === "och_token" || e.key === null) refreshToken();`
  - L37: `window.addEventListener("och-auth-change", refreshToken);`
  - L40: `window.removeEventListener("och-auth-change", refreshToken);`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/webapp/e2e/system-integrity.spec.ts`
  - L33: `const token = await page.evaluate(() => localStorage.getItem("och_token"));`
  - L34: `expect(token, "och_token after register").toBeTruthy();`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/webapp/lib/auth-storage.ts`
  - L1: `const KEY = "och_token";`
  - L2: `const EMAIL_KEY = "och_email";`
  - L6: `window.dispatchEvent(new Event("och-auth-change"));`

## K8s `namespace:` lines (YAML)

*Raw namespace: declarations*

*None found in scanned text files.*

## Cert / SAN hints

*x509-ish strings mentioning OCH hosts*

*None found in scanned text files.*

## Hardcoded gateway / legacy ports

*4020-style ports (RP api-gateway default is :4000)*

**Hits:** 23 (capped per file in scanner)

- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/RECORD_PLATFORM_CONTINUATION.md`
  - L60: `- **Strict edge wrapper:** `scripts/webapp-playwright-strict-edge.sh` — sets **`NODE_EXTRA_CA_CERTS`**, normalizes **`E2E_API_BASE`** to HTTPS edge (rejects legacy `localhost:4020`).`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/lib/edge-test-url.sh`
  - L2: `# Shared helpers: edge-only E2E / k6 (https://off-campus-housing.test), no port-forward / :4020.`
  - L15: `if [[ "$raw" =~ ^http://127\.0\.0\.1:4020 ]] || [[ "$raw" =~ ^http://localhost:4020 ]]; then`
  - L16: `echo "⚠️  Ignoring legacy E2E_API_BASE=$raw (port-forward / :4020 removed). Using $EDGE_TEST_DEFAULT_BASE" >&2`
  - L35: `if [[ "$raw" =~ ^http://127\.0\.0\.1:4020 ]] || [[ "$raw" =~ ^http://localhost:4020 ]]; then`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/run-playwright-e2e-preflight.sh`
  - L5: `# No kubectl port-forward; no http://127.0.0.1:4020 — legacy E2E_API_BASE values are ignored.`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/webapp-playwright-strict-edge.sh`
  - L7: `#   E2E_API_BASE   — https only (default https://off-campus-housing.test); :4020 / http localhost rejected`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/api-gateway/Dockerfile`
  - L62: `EXPOSE 4020`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/api-gateway/README.md`
  - L5: `**Architecture:** All client traffic hits the gateway (port 4020). The gateway validates JWT (via auth-service when needed), applies policy, then forwards gRPC to the appropriate backend. See root …`
  - L33: `Uses `services/common` for shared utilities. Port is set by `GATEWAY_PORT` (default 4020). In K8s, config comes from `app-config` ConfigMap; proto files are mounted from the `proto-files` ConfigMap…`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/api-gateway/src/server.ts`
  - L3: `* Ports per README: gateway 4020; auth 4011/50061, listings 4012/50062, booking 4013/50063, messaging 4014/50064,`
  - L676: `// Housing port 4020 per README — listen immediately; verify auth in background and gate readiness on /readyz (K8s-native).`
  - L677: `const gatewayPort = Number(process.env.GATEWAY_PORT || "4020");`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/transport-watchdog/src/index.ts`
  - L10: `process.env.TRANSPORT_WATCHDOG_GATEWAY_URL || "http://127.0.0.1:4020/readyz";`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/webapp/README.md`
  - L19: `You need **api-gateway** (and backing services) reachable — typically **`https://off-campus-housing.test`** via ingress or, for quick UI work, same-origin rewrites to **`http://127.0.0.1:4020`** (s…`
  - L59: `- **Default (recommended for local):** leave `NEXT_PUBLIC_API_BASE` unset. The app calls same-origin `/api/...`; `next.config.mjs` **rewrites** those to `API_GATEWAY_INTERNAL` (default `http://127.…`
  - L64: `**E2E and k6 always use the edge hostname** (`https://off-campus-housing.test` by default). **`kubectl port-forward` and `http://127.0.0.1:4020` are not valid E2E targets** — if `E2E_API_BASE` is s…`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/webapp/e2e/helpers.ts`
  - L10: `if (/127\.0\.0\.1:4020|localhost:4020/i.test(t)) return DEFAULT_E2E_EDGE;`
  - L15: `/** Public edge URL for API checks (Caddy → HAProxy → gateway). No port-forward / :4020. */`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/webapp/lib/config.ts`
  - L4: `* - If unset: use same-origin `/api/...` and rely on next.config.mjs rewrites to API_GATEWAY_INTERNAL (default http://127.0.0.1:4020).`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/webapp/next.config.mjs`
  - L2: `const gatewayInternal = process.env.API_GATEWAY_INTERNAL || "http://127.0.0.1:4020";`
- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/webapp/playwright.config.ts`
  - L11: `* Rejects legacy port-forward env (http://127.0.0.1:4020, etc.).`
  - L16: `if (/127\.0\.0\.1:4020|localhost:4020/i.test(raw)) return DEFAULT_E2E;`

## HOUSING / legacy env

*Environment variables and assignments*

**Hits:** 1 (capped per file in scanner)

- `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/lib/edge-test-url.sh`
  - L53: `local ns="${HOUSING_NS:-off-campus-housing-tracker}"`

---

## Summary

Apply **`docs/bundles/OCH_TO_RP_CONVERSION_MATRIX.md`** when porting; prefer surgical patches over bulk replace.
