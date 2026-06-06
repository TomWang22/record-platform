## Bundle Extraction Protocol v1

Extraction used `tools/bundle-audit/extract_bundle_v1.sh` (verify → index validate → extract → manifest match → per-file SHA256 → case check → freeze).

- **CHECKSUM_RECORD:** `/Users/tom/record-platform/docs/bundles/CHECKSUM_RECORD_record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409.txt`
- **INTEGRITY (machine):** `/Users/tom/record-platform/docs/bundles/INTEGRITY_record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409.json`

### INTEGRITY summary

```json
{
  "bundle_extraction_protocol": "v1",
  "generated_at": "2026-04-19T00:53:50.682722+00:00",
  "archive": "/Users/tom/record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409.tar.gz",
  "archive_sha256": "362e531762ea6d44c723d7f01bad9a688a3c2096bd9999a333f0f2bfbc50a6a4",
  "staging_path": "/Users/tom/bundle-staging/record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409",
  "archive_root_layout": {
    "type": "single_top_level",
    "root": "record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409"
  },
  "pre_extract": {
    "safe": true,
    "issues": [],
    "warnings": [
      "symlink_allowed:record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/auth-service/prisma/.env->'../../.env'"
    ],
    "file_member_count": 471
  },
  "post_extract": {
    "manifest_tar_equals_find": true,
    "file_count": 471,
    "case_collision_free": true,
    "staging_frozen_read_only": true,
    "apple_double_neutral_manifest": true
  },
  "explicit_non_actions": [
    "tarball_not_mutated",
    "no_line_endings_normalized",
    "no_top_level_strip_rewrite",
    "no_repo_copy",
    "no_git_add"
  ]
}```

## Mechanical parity (tar index vs repo)

```text
# mechanical_parity: record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409.tar.gz
repo: /Users/tom/record-platform
stripped_prefix: ''
checked_paths: 1173
missing_in_repo: 1173
  MISSING ._record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/._ANALYTICS_AND_OLLAMA.md
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/._README-BUNDLE.md
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/._RECORD_PLATFORM_CONTINUATION.md
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/._package.json
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/._pnpm-workspace.yaml
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/._proto
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/._scripts
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/._services
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/._tests
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/._tools
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/._vitest.account-deletion.config.ts
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/._vitest.system.config.mts
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/._webapp
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/ANALYTICS_AND_OLLAMA.md
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/README-BUNDLE.md
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/RECORD_PLATFORM_CONTINUATION.md
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/package.json
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/pnpm-workspace.yaml
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/._common.proto
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/._events
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/common.proto
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/._README.md
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/._analytics.proto
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/._auth.proto
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/._booking.proto
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/._envelope.proto
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/._listing.proto
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/._media.proto
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/._messaging
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/._messaging.proto
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/._notification.proto
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/._trust.proto
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/README.md
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/analytics.proto
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/auth.proto
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/booking.proto
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/envelope.proto
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/listing.proto
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/media.proto
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/messaging
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/messaging.proto
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/messaging/._v1
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/messaging/v1
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/messaging/v1/._messaging_events.proto
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/messaging/v1/messaging_events.proto
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/notification.proto
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/proto/events/trust.proto
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/._assert-kafka-integration-cluster.mjs
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/._create-kafka-event-topics-k8s.sh
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/._create-kafka-event-topics.sh
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/._lib
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/._load
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/._open-service-coverage-html.sh
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/._run-event-layer-verification.sh
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/._run-kafka-contract-validate.sh
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/._run-playwright-e2e-preflight.sh
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/._shims
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/._verify-kafka-event-topic-partitions.sh
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/._verify-proto-events-topics.sh
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/._verify-proto-topic-alignment.sh
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/._webapp-playwright-strict-edge.sh
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/assert-kafka-integration-cluster.mjs
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/create-kafka-event-topics-k8s.sh
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/create-kafka-event-topics.sh
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/lib
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/lib/._edge-test-url.sh
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/lib/._och-kafka-event-topics-from-proto.sh
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/lib/edge-test-url.sh
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/lib/och-kafka-event-topics-from-proto.sh
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/load
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/load/._k6-event-layer-adversarial.js
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/load/k6-event-layer-adversarial.js
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/open-service-coverage-html.sh
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/run-event-layer-verification.sh
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/run-kafka-contract-validate.sh
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/run-playwright-e2e-preflight.sh
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/shims
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/shims/._curl
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/shims/._kubectl
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/shims/._kubectl-bulletproof
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/shims/curl
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/shims/kubectl
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/shims/kubectl-bulletproof
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/verify-kafka-event-topic-partitions.sh
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/verify-proto-events-topics.sh
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/verify-proto-topic-alignment.sh
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/scripts/webapp-playwright-strict-edge.sh
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/._README.md
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/._analytics-service
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/._api-gateway
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/._auth-service
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/._booking-service
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/._common
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/._cron-jobs
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/._event-layer-verification
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/._listings-service
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/._media-service
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/._messaging-service
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/._notification-service
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/._transport-watchdog
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/._trust-service
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/README.md
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/analytics-service
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/analytics-service/._Dockerfile
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/analytics-service/._README.md
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/analytics-service/._package.json
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/analytics-service/._src
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/analytics-service/._tests
  MISSING record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409/services/analytics-service/._tsconfig.json
... (truncated; re-run mechanical_parity_tar_vs_repo.py for full list)
```

---

# Bundle analysis: `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409`

Generated by `tools/bundle-audit/bundle_ingestion_analyze.py` (controlled ingestion; repo is canonical).

## Metadata

- **Staging tree:** `/Users/tom/bundle-staging/record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409`
- **Repo root:** `/Users/tom/record-platform`
- **Source tarball:** `/Users/tom/record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409.tar.gz`
- **Detected strip prefix:** `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409`
- **Files under staging (after skips):** 471
- **UTC timestamp:** 2026-04-19T00:53:53.004141+00:00

## Parity summary

| Class | Count |
|-------|------:|
| `missing_in_repo` | 305 |
| `identical` | 87 |
| `content_diff` | 79 |

## Classification (sample per bucket)

### `bundle_only_scaffolding`

- `README-BUNDLE.md [missing_in_repo]`

### `infra_script`

- `scripts/assert-kafka-integration-cluster.mjs [content_diff]`
- `scripts/create-kafka-event-topics-k8s.sh [content_diff]`
- `scripts/create-kafka-event-topics.sh [content_diff]`
- `scripts/lib/edge-test-url.sh [content_diff]`
- `scripts/lib/och-kafka-event-topics-from-proto.sh [missing_in_repo]`
- `scripts/load/k6-event-layer-adversarial.js [identical]`
- `scripts/open-service-coverage-html.sh [identical]`
- `scripts/run-event-layer-verification.sh [identical]`
- `scripts/run-kafka-contract-validate.sh [identical]`
- `scripts/run-playwright-e2e-preflight.sh [content_diff]`
- `scripts/shims/curl [identical]`
- `scripts/shims/kubectl [identical]`
- `scripts/shims/kubectl-bulletproof [identical]`
- `scripts/verify-kafka-event-topic-partitions.sh [content_diff]`
- `scripts/verify-proto-events-topics.sh [content_diff]`
- `scripts/verify-proto-topic-alignment.sh [content_diff]`
- `scripts/webapp-playwright-strict-edge.sh [content_diff]`
- `tools/kafka-contract/package.json [identical]`
- `tools/kafka-contract/src/index.ts [identical]`
- `tools/kafka-contract/src/kafkaClient.ts [identical]`
- `tools/kafka-contract/src/protoScanner.ts [identical]`
- `tools/kafka-contract/src/topicBuilder.ts [identical]`
- `tools/kafka-contract/src/types.ts [identical]`
- `tools/kafka-contract/src/validator.ts [identical]`
- `tools/kafka-contract/tsconfig.json [identical]`

### `optional_docs`

- `ANALYTICS_AND_OLLAMA.md [missing_in_repo]`
- `RECORD_PLATFORM_CONTINUATION.md [missing_in_repo]`
- `proto/events/README.md [content_diff]`

### `optional_other`

- `package.json [content_diff]`
- `pnpm-workspace.yaml [identical]`
- `proto/common.proto [content_diff]`
- `proto/events/analytics.proto [content_diff]`
- `proto/events/auth.proto [content_diff]`
- `proto/events/booking.proto [content_diff]`
- `proto/events/envelope.proto [content_diff]`
- `proto/events/listing.proto [content_diff]`
- `proto/events/media.proto [content_diff]`
- `proto/events/messaging.proto [content_diff]`
- `proto/events/messaging/v1/messaging_events.proto [content_diff]`
- `proto/events/notification.proto [content_diff]`
- `proto/events/trust.proto [content_diff]`
- `tests/account-deletion.e2e.test.ts [missing_in_repo]`
- `tests/system/booking-analytics.contract.test.ts [missing_in_repo]`
- `tests/system/global-setup.ts [missing_in_repo]`
- `tests/system/helpers/waitForCondition.ts [missing_in_repo]`
- `tests/system/listing-analytics.contract.test.ts [missing_in_repo]`
- `vitest.account-deletion.config.ts [missing_in_repo]`
- `vitest.system.config.mts [content_diff]`

### `runtime_critical`

- `tests/helpers/wait-for-kafka-propagation.ts [missing_in_repo]`

### `service_or_app`

- `services/README.md [missing_in_repo]`
- `services/analytics-service/Dockerfile [content_diff]`
- `services/analytics-service/README.md [missing_in_repo]`
- `services/analytics-service/package.json [content_diff]`
- `services/analytics-service/src/booking-read-pool.ts [missing_in_repo]`
- `services/analytics-service/src/consumers/listingEventsConsumer.ts [missing_in_repo]`
- `services/analytics-service/src/consumers/messagingConsumer.ts [missing_in_repo]`
- `services/analytics-service/src/db.ts [content_diff]`
- `services/analytics-service/src/grpc-server.ts [content_diff]`
- `services/analytics-service/src/http-server.ts [missing_in_repo]`
- `services/analytics-service/src/index.ts [missing_in_repo]`
- `services/analytics-service/src/listing-metrics-projection.ts [missing_in_repo]`
- `services/analytics-service/src/ollama.ts [missing_in_repo]`
- `services/analytics-service/src/server.ts [content_diff]`
- `services/analytics-service/tests/analytics-http.integration.test.ts [missing_in_repo]`
- `services/analytics-service/tests/smoke.test.ts [missing_in_repo]`
- `services/analytics-service/tsconfig.json [content_diff]`
- `services/analytics-service/vitest.config.ts [missing_in_repo]`
- `services/analytics-service/vitest.integration.config.ts [missing_in_repo]`
- `services/api-gateway/Dockerfile [content_diff]`
- `services/api-gateway/README.md [missing_in_repo]`
- `services/api-gateway/package.json [content_diff]`
- `services/api-gateway/pm2.config.cjs [identical]`
- `services/api-gateway/src/cluster-weight-budget.ts [missing_in_repo]`
- `services/api-gateway/src/e2e-test-mode-inflight-cap.ts [missing_in_repo]`
- `services/api-gateway/src/e2e-traffic-shaper.ts [missing_in_repo]`
- `services/api-gateway/src/gateway-traffic-skip.ts [missing_in_repo]`
- `services/api-gateway/src/proxy-limits.ts [missing_in_repo]`
- `services/api-gateway/src/server.ts [content_diff]`
- `services/api-gateway/src/watchdog-throttle-poll.ts [missing_in_repo]`
- `services/api-gateway/tests/smoke.test.ts [missing_in_repo]`
- `services/api-gateway/tsconfig.json [identical]`
- `services/api-gateway/vitest.config.ts [missing_in_repo]`
- `services/auth-service/.dockerignore [identical]`
- `services/auth-service/AUTH_FEATURES.md.gz [identical]`
- `services/auth-service/Dockerfile [content_diff]`
- `services/auth-service/README.md [missing_in_repo]`
- `services/auth-service/generated/auth-client/default.d.ts [identical]`
- `services/auth-service/generated/auth-client/default.js [identical]`
- `services/auth-service/generated/auth-client/edge.d.ts [identical]`
- … *40 more*

## Safe import suggestions

- Paths marked **`missing_in_repo`** may be candidates for **add-if-missing** imports; review namespace/SNI (`record-platform`, `record.test`, `kafka-ssl-secret`).
- Paths marked **`content_diff`** require **manual diff** (`diff -u` or IDE); do not `cp -r` from staging.
- Prefer **`git apply`** / focused **`git checkout -- path`** over wholesale copy.
- **Do not** overwrite `scripts/run-preflight-scale-and-all-suites.sh` from bundles unless explicitly approved.

## Top paths to review

- `scripts/assert-kafka-integration-cluster.mjs` — **content_diff** (infra_script) sha256 staging=ccca46e6a98e… repo=f43d60fa7a70…
- `scripts/create-kafka-event-topics-k8s.sh` — **content_diff** (infra_script) sha256 staging=bd99f1637ca1… repo=3c7173026554…
- `scripts/create-kafka-event-topics.sh` — **content_diff** (infra_script) sha256 staging=d1ad5b10d745… repo=de37bad6bd39…
- `scripts/lib/edge-test-url.sh` — **content_diff** (infra_script) sha256 staging=c00f734994d7… repo=df827f5ced16…
- `scripts/run-playwright-e2e-preflight.sh` — **content_diff** (infra_script) sha256 staging=373f743fd764… repo=7c7dad1bcc63…
- `scripts/verify-kafka-event-topic-partitions.sh` — **content_diff** (infra_script) sha256 staging=355fc9a277ab… repo=c7db5fcb732a…
- `scripts/verify-proto-events-topics.sh` — **content_diff** (infra_script) sha256 staging=6943f175373d… repo=e580d153cf27…
- `scripts/verify-proto-topic-alignment.sh` — **content_diff** (infra_script) sha256 staging=990f7e3576c6… repo=247e046252e0…
- `scripts/webapp-playwright-strict-edge.sh` — **content_diff** (infra_script) sha256 staging=223d26b187b6… repo=fae6c5543552…
- `proto/events/README.md` — **content_diff** (optional_docs) sha256 staging=5d17e332fdcd… repo=47d4c2a7c569…
- `package.json` — **content_diff** (optional_other) sha256 staging=53a41f724cce… repo=11599ba9b6d7…
- `proto/common.proto` — **content_diff** (optional_other) sha256 staging=7ec3b2a34010… repo=3b2e7c3e2e73…
- `proto/events/analytics.proto` — **content_diff** (optional_other) sha256 staging=9de242ad2789… repo=f1c8e1f1b4dd…
- `proto/events/auth.proto` — **content_diff** (optional_other) sha256 staging=fe6a46feab4c… repo=c5ba054c31af…
- `proto/events/booking.proto` — **content_diff** (optional_other) sha256 staging=ec6521734fc2… repo=58636de68d03…
- `proto/events/envelope.proto` — **content_diff** (optional_other) sha256 staging=1b420f6b27ff… repo=d561c8ae66dc…
- `proto/events/listing.proto` — **content_diff** (optional_other) sha256 staging=bff7b11c64c8… repo=d307bbfdc981…
- `proto/events/media.proto` — **content_diff** (optional_other) sha256 staging=3d1338033c85… repo=310c377bc56a…
- `proto/events/messaging.proto` — **content_diff** (optional_other) sha256 staging=23713911f0cb… repo=55c9f3ce8ba9…
- `proto/events/messaging/v1/messaging_events.proto` — **content_diff** (optional_other) sha256 staging=2af794c236b0… repo=6193fd80fc79…
- `proto/events/notification.proto` — **content_diff** (optional_other) sha256 staging=416e59b06155… repo=5fbb7f5ba624…
- `proto/events/trust.proto` — **content_diff** (optional_other) sha256 staging=72e0cd7ca632… repo=5928fe62e2ec…
- `vitest.system.config.mts` — **content_diff** (optional_other) sha256 staging=6f31945e4073… repo=34ec973cedb2…
- `services/analytics-service/Dockerfile` — **content_diff** (service_or_app) sha256 staging=bf156cb49520… repo=0ee38c4ffe14…
- `services/analytics-service/package.json` — **content_diff** (service_or_app) sha256 staging=886b2f5bd125… repo=8a15c4b2ebda…
- `services/analytics-service/src/db.ts` — **content_diff** (service_or_app) sha256 staging=0c911a09ac52… repo=f122dcf49d0b…
- `services/analytics-service/src/grpc-server.ts` — **content_diff** (service_or_app) sha256 staging=4fe297a89f0d… repo=a42699bd73f8…
- `services/analytics-service/src/server.ts` — **content_diff** (service_or_app) sha256 staging=994e43d68e66… repo=9992046ac157…
- `services/analytics-service/tsconfig.json` — **content_diff** (service_or_app) sha256 staging=9c0513da516d… repo=df626adc85bb…
- `services/api-gateway/Dockerfile` — **content_diff** (service_or_app) sha256 staging=abc6eedcaf75… repo=32314ab6778a…
- `services/api-gateway/package.json` — **content_diff** (service_or_app) sha256 staging=fba0d45e44d8… repo=dd215c0f128f…
- `services/api-gateway/src/server.ts` — **content_diff** (service_or_app) sha256 staging=c70463747198… repo=7fac4b0788d0…
- `services/auth-service/Dockerfile` — **content_diff** (service_or_app) sha256 staging=a4acafd482d7… repo=24f6db0cee1c…
- `services/auth-service/generated/auth-client/schema.prisma` — **content_diff** (service_or_app) sha256 staging=3763cda8fcd2… repo=6eee1989fe80…
- `services/auth-service/package.json` — **content_diff** (service_or_app) sha256 staging=5ab8c0a6e0aa… repo=c70f5f7d6f85…
- `services/auth-service/prisma/generated/client/edge.js` — **content_diff** (service_or_app) sha256 staging=d5bb010394ad… repo=f545613c070a…
- `services/auth-service/prisma/generated/client/index-browser.js` — **content_diff** (service_or_app) sha256 staging=5d38303ecd78… repo=e7772a5d0a75…
- `services/auth-service/prisma/generated/client/index.d.ts` — **content_diff** (service_or_app) sha256 staging=d07d32ef3eb8… repo=3f6c59de8a28…
- `services/auth-service/prisma/generated/client/index.js` — **content_diff** (service_or_app) sha256 staging=ec05d12e8c02… repo=6a1f257bfe7c…
- `services/auth-service/prisma/generated/client/package.json` — **content_diff** (service_or_app) sha256 staging=b5eb1e6df857… repo=a41fad3aa951…
- `services/auth-service/prisma/generated/client/schema.prisma` — **content_diff** (service_or_app) sha256 staging=9e30dd9c1261… repo=7be738dd937f…
- `services/auth-service/prisma/generated/client/wasm.js` — **content_diff** (service_or_app) sha256 staging=cf141a7a086b… repo=20af82e8a828…
- `services/auth-service/prisma/schema.prisma` — **content_diff** (service_or_app) sha256 staging=5530ccb6c6cc… repo=c919dce0bdc1…
- `services/auth-service/src/grpc-server.ts` — **content_diff** (service_or_app) sha256 staging=358db7d2514f… repo=101d80431b19…
- `services/auth-service/src/lib/mfa.ts` — **content_diff** (service_or_app) sha256 staging=3b0189c13fa0… repo=f188697d73d4…
- `services/auth-service/src/lib/prisma.ts` — **content_diff** (service_or_app) sha256 staging=1f73419c2963… repo=7817ddfee5ab…
- `services/auth-service/src/lib/verification.ts` — **content_diff** (service_or_app) sha256 staging=2d33f19be2d1… repo=b7f51df31a75…
- `services/auth-service/src/routes/passkey.ts` — **content_diff** (service_or_app) sha256 staging=5ad431398b96… repo=07bbed4a1e89…
- `services/auth-service/src/server.ts` — **content_diff** (service_or_app) sha256 staging=f5468f4a3315… repo=63ab632138ad…
- `services/common/package.json` — **content_diff** (service_or_app) sha256 staging=cbb5acbcf0a8… repo=cd6677a2be91…
- `services/common/src/grpc-clients.ts` — **content_diff** (service_or_app) sha256 staging=dcff46e9de3e… repo=e5439991b3fc…
- `services/common/src/grpc-health.ts` — **content_diff** (service_or_app) sha256 staging=c54c994fc9d6… repo=6e279f40b377…
- `services/common/src/index.ts` — **content_diff** (service_or_app) sha256 staging=a3cd9827c3a1… repo=918aa17183c9…
- `services/common/src/kafka.ts` — **content_diff** (service_or_app) sha256 staging=a6588bd1ecc7… repo=c2d717ac5450…
- `services/common/src/proto.ts` — **content_diff** (service_or_app) sha256 staging=d822f1c555de… repo=8e38c50e01e5…
- `services/common/src/redis.ts` — **content_diff** (service_or_app) sha256 staging=fa683b9236e1… repo=d18466273260…
- `services/common/src/tracing.ts` — **content_diff** (service_or_app) sha256 staging=554266cdf6dc… repo=5e6248d1bc74…
- `services/cron-jobs/Dockerfile` — **content_diff** (service_or_app) sha256 staging=195e0445fcb0… repo=7f27f14d7621…
- `services/cron-jobs/README.md` — **content_diff** (service_or_app) sha256 staging=b90426af15dd… repo=2082d67da59e…
- `services/cron-jobs/package.json` — **content_diff** (service_or_app) sha256 staging=6fcd11c7233a… repo=fbe80946a031…
- `services/cron-jobs/src/jobs.ts` — **content_diff** (service_or_app) sha256 staging=d08b0a989827… repo=734af7007a0b…
- `services/listings-service/Dockerfile` — **content_diff** (service_or_app) sha256 staging=dfcec26622fc… repo=fc56e052b870…
- `services/listings-service/package.json` — **content_diff** (service_or_app) sha256 staging=ee7b79027073… repo=02e705b130de…
- `services/listings-service/src/grpc-server.ts` — **content_diff** (service_or_app) sha256 staging=030ff62d393e… repo=4e0781efacd6…
- `services/listings-service/src/server.ts` — **content_diff** (service_or_app) sha256 staging=8c5fbd4def6c… repo=642531b83c46…
- `services/listings-service/tsconfig.json` — **content_diff** (service_or_app) sha256 staging=b24dddc88c32… repo=df626adc85bb…
- `webapp/Dockerfile` — **content_diff** (service_or_app) sha256 staging=712c1d0e13c3… repo=9cb8cddeaaed…
- `webapp/README.md` — **content_diff** (service_or_app) sha256 staging=9a9ad0356586… repo=4f15e0f689c9…
- `webapp/app/globals.css` — **content_diff** (service_or_app) sha256 staging=829a1a933cad… repo=951f49d44822…
- `webapp/app/layout.tsx` — **content_diff** (service_or_app) sha256 staging=73c208aed2fb… repo=ffd0537e5ee4…
- `webapp/app/page.tsx` — **content_diff** (service_or_app) sha256 staging=bf355d7411c6… repo=56a7cbe86510…
- `webapp/lib/config.ts` — **content_diff** (service_or_app) sha256 staging=ce13251cb397… repo=5b59c99be774…
- `webapp/next-env.d.ts` — **content_diff** (service_or_app) sha256 staging=9dd9d642cdb8… repo=9269d492817e…
- `webapp/next.config.mjs` — **content_diff** (service_or_app) sha256 staging=a62e76045882… repo=baaec97d8425…
- `webapp/package.json` — **content_diff** (service_or_app) sha256 staging=1ce1bcf7206e… repo=9c9b0f27b761…
- `webapp/playwright.config.ts` — **content_diff** (service_or_app) sha256 staging=97195ef9ffbd… repo=3365bb550feb…
- `webapp/postcss.config.mjs` — **content_diff** (service_or_app) sha256 staging=ac31e2a95ef6… repo=01ec9c5ed665…
- `webapp/tailwind.config.ts` — **content_diff** (service_or_app) sha256 staging=5153867d3940… repo=b437efa9d140…
- `webapp/tsconfig.json` — **content_diff** (service_or_app) sha256 staging=54202f1d6d35… repo=8d86851fb32e…
- `README-BUNDLE.md` — **missing_in_repo** (bundle_only_scaffolding)
- `scripts/lib/och-kafka-event-topics-from-proto.sh` — **missing_in_repo** (infra_script)
- `ANALYTICS_AND_OLLAMA.md` — **missing_in_repo** (optional_docs)
- `RECORD_PLATFORM_CONTINUATION.md` — **missing_in_repo** (optional_docs)
- `tests/account-deletion.e2e.test.ts` — **missing_in_repo** (optional_other)
- `tests/system/booking-analytics.contract.test.ts` — **missing_in_repo** (optional_other)
- `tests/system/global-setup.ts` — **missing_in_repo** (optional_other)
- `tests/system/helpers/waitForCondition.ts` — **missing_in_repo** (optional_other)
- `tests/system/listing-analytics.contract.test.ts` — **missing_in_repo** (optional_other)
- `vitest.account-deletion.config.ts` — **missing_in_repo** (optional_other)
- `tests/helpers/wait-for-kafka-propagation.ts` — **missing_in_repo** (runtime_critical)
- `services/README.md` — **missing_in_repo** (service_or_app)
- `services/analytics-service/README.md` — **missing_in_repo** (service_or_app)
- `services/analytics-service/src/booking-read-pool.ts` — **missing_in_repo** (service_or_app)
- `services/analytics-service/src/consumers/listingEventsConsumer.ts` — **missing_in_repo** (service_or_app)
- `services/analytics-service/src/consumers/messagingConsumer.ts` — **missing_in_repo** (service_or_app)
- `services/analytics-service/src/http-server.ts` — **missing_in_repo** (service_or_app)
- `services/analytics-service/src/index.ts` — **missing_in_repo** (service_or_app)
- `services/analytics-service/src/listing-metrics-projection.ts` — **missing_in_repo** (service_or_app)
- `services/analytics-service/src/ollama.ts` — **missing_in_repo** (service_or_app)
- `services/analytics-service/tests/analytics-http.integration.test.ts` — **missing_in_repo** (service_or_app)
- `services/analytics-service/tests/smoke.test.ts` — **missing_in_repo** (service_or_app)
- `services/analytics-service/vitest.config.ts` — **missing_in_repo** (service_or_app)
- `services/analytics-service/vitest.integration.config.ts` — **missing_in_repo** (service_or_app)
- `services/api-gateway/README.md` — **missing_in_repo** (service_or_app)
- `services/api-gateway/src/cluster-weight-budget.ts` — **missing_in_repo** (service_or_app)
- `services/api-gateway/src/e2e-test-mode-inflight-cap.ts` — **missing_in_repo** (service_or_app)
- `services/api-gateway/src/e2e-traffic-shaper.ts` — **missing_in_repo** (service_or_app)
- `services/api-gateway/src/gateway-traffic-skip.ts` — **missing_in_repo** (service_or_app)
- `services/api-gateway/src/proxy-limits.ts` — **missing_in_repo** (service_or_app)
- `services/api-gateway/src/watchdog-throttle-poll.ts` — **missing_in_repo** (service_or_app)
- `services/api-gateway/tests/smoke.test.ts` — **missing_in_repo** (service_or_app)
- `services/api-gateway/vitest.config.ts` — **missing_in_repo** (service_or_app)
- `services/auth-service/README.md` — **missing_in_repo** (service_or_app)
- `services/auth-service/prisma/migrations/20260330103000_account_soft_delete/migration.sql` — **missing_in_repo** (service_or_app)
- `services/auth-service/prisma/migrations/20260404120000_auth_transactional_outbox/migration.sql` — **missing_in_repo** (service_or_app)
- `services/auth-service/scripts/prisma-generate-retry.sh` — **missing_in_repo** (service_or_app)
- `services/auth-service/src/cli/outbox-tick-once.ts` — **missing_in_repo** (service_or_app)
- `services/auth-service/src/lib/auth-outbox-metrics.ts` — **missing_in_repo** (service_or_app)
- `services/auth-service/src/lib/auth-outbox-publisher.ts` — **missing_in_repo** (service_or_app)
- `services/auth-service/tests/auth-outbox-publisher.test.ts` — **missing_in_repo** (service_or_app)
- `services/auth-service/tests/smoke.test.ts` — **missing_in_repo** (service_or_app)
- `services/auth-service/vitest.config.ts` — **missing_in_repo** (service_or_app)
- `services/booking-service/Dockerfile` — **missing_in_repo** (service_or_app)
- `services/booking-service/README.md` — **missing_in_repo** (service_or_app)
- `services/booking-service/package.json` — **missing_in_repo** (service_or_app)
- `services/booking-service/prisma/generated/client/client.d.ts` — **missing_in_repo** (service_or_app)
- `services/booking-service/prisma/generated/client/client.js` — **missing_in_repo** (service_or_app)
- `services/booking-service/prisma/generated/client/default.d.ts` — **missing_in_repo** (service_or_app)
- `services/booking-service/prisma/generated/client/default.js` — **missing_in_repo** (service_or_app)
- `services/booking-service/prisma/generated/client/edge.d.ts` — **missing_in_repo** (service_or_app)
- `services/booking-service/prisma/generated/client/edge.js` — **missing_in_repo** (service_or_app)
- `services/booking-service/prisma/generated/client/index-browser.js` — **missing_in_repo** (service_or_app)
- `services/booking-service/prisma/generated/client/index.d.ts` — **missing_in_repo** (service_or_app)
- `services/booking-service/prisma/generated/client/index.js` — **missing_in_repo** (service_or_app)
- `services/booking-service/prisma/generated/client/libquery_engine-darwin-arm64.dylib.node` — **missing_in_repo** (service_or_app)
- `services/booking-service/prisma/generated/client/libquery_engine-darwin.dylib.node` — **missing_in_repo** (service_or_app)
- `services/booking-service/prisma/generated/client/libquery_engine-debian-openssl-3.0.x.so.node` — **missing_in_repo** (service_or_app)
- `services/booking-service/prisma/generated/client/libquery_engine-linux-arm64-openssl-3.0.x.so.node` — **missing_in_repo** (service_or_app)
- `services/booking-service/prisma/generated/client/package.json` — **missing_in_repo** (service_or_app)
- `services/booking-service/prisma/generated/client/query_engine_bg.js` — **missing_in_repo** (service_or_app)
- `services/booking-service/prisma/generated/client/query_engine_bg.wasm` — **missing_in_repo** (service_or_app)
- `services/booking-service/prisma/generated/client/runtime/edge-esm.js` — **missing_in_repo** (service_or_app)
- `services/booking-service/prisma/generated/client/runtime/edge.js` — **missing_in_repo** (service_or_app)
- `services/booking-service/prisma/generated/client/runtime/index-browser.d.ts` — **missing_in_repo** (service_or_app)
- `services/booking-service/prisma/generated/client/runtime/index-browser.js` — **missing_in_repo** (service_or_app)
- `services/booking-service/prisma/generated/client/runtime/library.d.ts` — **missing_in_repo** (service_or_app)
- `services/booking-service/prisma/generated/client/runtime/library.js` — **missing_in_repo** (service_or_app)
- `services/booking-service/prisma/generated/client/runtime/react-native.js` — **missing_in_repo** (service_or_app)
- `services/booking-service/prisma/generated/client/runtime/wasm-compiler-edge.js` — **missing_in_repo** (service_or_app)
- `services/booking-service/prisma/generated/client/runtime/wasm-engine-edge.js` — **missing_in_repo** (service_or_app)
- … *234 more missing/diff rows*
