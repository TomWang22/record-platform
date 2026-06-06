## Bundle Extraction Protocol v1

Extraction used `tools/bundle-audit/extract_bundle_v1.sh` (verify → index validate → extract → manifest match → per-file SHA256 → case check → freeze).

- **CHECKSUM_RECORD:** `/Users/tom/record-platform/docs/bundles/CHECKSUM_RECORD_record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410.txt`
- **INTEGRITY (machine):** `/Users/tom/record-platform/docs/bundles/INTEGRITY_record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410.json`

### INTEGRITY summary

```json
{
  "bundle_extraction_protocol": "v1",
  "generated_at": "2026-04-19T00:52:06.477031+00:00",
  "archive": "/Users/tom/record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410.tar.gz",
  "archive_sha256": "2ae24cbc99afae4b2d3036f5282048127ea5e2ee448113bf3b6cc846e0591765",
  "staging_path": "/Users/tom/bundle-staging/record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410",
  "archive_root_layout": {
    "type": "single_top_level",
    "root": "record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410"
  },
  "pre_extract": {
    "safe": true,
    "issues": [],
    "warnings": [
      "symlink_allowed:record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/services/auth-service/prisma/.env->'../../.env'"
    ],
    "file_member_count": 1148
  },
  "post_extract": {
    "manifest_tar_equals_find": true,
    "file_count": 1148,
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
# mechanical_parity: record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410.tar.gz
repo: /Users/tom/record-platform
stripped_prefix: ''
checked_paths: 2693
missing_in_repo: 2693
  MISSING ._record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/._.npmrc
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/._Caddyfile
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/._GOLDEN_SNAPSHOT_AND_CHAOS.md
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/._Makefile
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/._README-BUNDLE.md
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/._README.txt
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/._SELF_BUILT_SERVICE_MESH.md
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/._certs
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/._docker
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/._docs
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/._infra
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/._monitoring
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/._package.json
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/._pnpm-lock.yaml
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/._pnpm-workspace.yaml
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/._proto
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/._scripts
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/._services
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/._tests
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/._tools
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/._tsconfig.base.json
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/._vitest.account-deletion.config.ts
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/._vitest.system.config.mts
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/._webapp
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/.npmrc
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/Caddyfile
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/GOLDEN_SNAPSHOT_AND_CHAOS.md
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/Makefile
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/README-BUNDLE.md
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/README.txt
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/SELF_BUILT_SERVICE_MESH.md
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/certs
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/docker
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/docker/._caddy-with-tcpdump
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/docker/._envoy-with-tcpdump
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/docker/caddy-with-tcpdump
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/docker/caddy-with-tcpdump/._Dockerfile
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/docker/caddy-with-tcpdump/._README.md
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/docker/caddy-with-tcpdump/Dockerfile
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/docker/caddy-with-tcpdump/README.md
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/docker/envoy-with-tcpdump
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/docker/envoy-with-tcpdump/._Dockerfile
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/docker/envoy-with-tcpdump/._README.md
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/docker/envoy-with-tcpdump/Dockerfile
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/docker/envoy-with-tcpdump/README.md
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/docs
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/docs/._runbooks
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/docs/runbooks
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/docs/runbooks/._kafka-kraft-stale-dns-rca.md
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/docs/runbooks/kafka-kraft-stale-dns-rca.md
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/._k8s
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/._base
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/._caddy-h3-configmap.yaml
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/._caddy-h3-deploy-loadbalancer.yaml
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/._caddy-h3-deploy.yaml
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/._caddy-h3-service-clusterip.yaml
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/._caddy-h3-service-loadbalancer.yaml
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/._caddy-h3-service-nodeport.yaml
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/._caddy-h3-service.yaml
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/._echo-backend.yaml
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/._ingress-nginx-envoy.yaml
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/._kafka-certs
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/._kafka-kraft-metallb
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/._kafka-ops
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/._loadbalancer.yaml
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/._metallb
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/._monitoring
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/._observability
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/._overlays
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/._reference
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/._README.md
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/._analytics-service
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/._api-gateway
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/._auth-service
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/._booking-service
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/._config
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/._docs
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/._envoy-test
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/._exporters
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/._haproxy
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/._kafka
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/._kafka-ca-exporter
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/._kafka-external
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/._kustomization.yaml
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/._listings-service
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/._media-service
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/._messaging-service
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/._monitoring
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/._namespaces.yaml
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/._nginx
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/._notification-service
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/._observability
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/._redis
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/._trust-service
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/._webapp
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/README.md
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/analytics-service
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/analytics-service/._deploy.yaml
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/analytics-service/._kustomization.yaml
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/analytics-service/._service.yaml
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/analytics-service/deploy.yaml
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/analytics-service/kustomization.yaml
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/analytics-service/service.yaml
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/api-gateway
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/api-gateway/._deploy.yaml
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/api-gateway/._kustomization.yaml
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/api-gateway/._service.yaml
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/api-gateway/deploy.yaml
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/api-gateway/kustomization.yaml
  MISSING record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410/infra/k8s/base/api-gateway/service.yaml
... (truncated; re-run mechanical_parity_tar_vs_repo.py for full list)
```

---

# Bundle analysis: `record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410`

Generated by `tools/bundle-audit/bundle_ingestion_analyze.py` (controlled ingestion; repo is canonical).

## Metadata

- **Staging tree:** `/Users/tom/bundle-staging/record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410`
- **Repo root:** `/Users/tom/record-platform`
- **Source tarball:** `/Users/tom/record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410.tar.gz`
- **Detected strip prefix:** `record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410`
- **Files under staging (after skips):** 1148
- **UTC timestamp:** 2026-04-19T00:52:09.601077+00:00

## Parity summary

| Class | Count |
|-------|------:|
| `identical` | 533 |
| `missing_in_repo` | 332 |
| `content_diff` | 283 |

## Classification (sample per bucket)

### `bundle_only_scaffolding`

- `README-BUNDLE.md [missing_in_repo]`

### `infra_script`

- `docs/runbooks/kafka-kraft-stale-dns-rca.md [content_diff]`
- `infra/k8s/base/README.md [identical]`
- `infra/k8s/base/analytics-service/deploy.yaml [content_diff]`
- `infra/k8s/base/analytics-service/kustomization.yaml [identical]`
- `infra/k8s/base/analytics-service/service.yaml [content_diff]`
- `infra/k8s/base/api-gateway/deploy.yaml [content_diff]`
- `infra/k8s/base/api-gateway/kustomization.yaml [identical]`
- `infra/k8s/base/api-gateway/service.yaml [content_diff]`
- `infra/k8s/base/auth-service/deploy.yaml [content_diff]`
- `infra/k8s/base/auth-service/grpc-health-probe.yaml [content_diff]`
- `infra/k8s/base/auth-service/kustomization.yaml [identical]`
- `infra/k8s/base/auth-service/service.yaml [content_diff]`
- `infra/k8s/base/booking-service/deploy.yaml [missing_in_repo]`
- `infra/k8s/base/booking-service/kustomization.yaml [missing_in_repo]`
- `infra/k8s/base/booking-service/service.yaml [missing_in_repo]`
- `infra/k8s/base/config/app-config.yaml [content_diff]`
- `infra/k8s/base/config/app-secrets.yaml [identical]`
- `infra/k8s/base/config/kustomization.yaml [identical]`
- `infra/k8s/base/config/proto/README.md [identical]`
- `infra/k8s/base/config/proto/analytics.proto [content_diff]`
- `infra/k8s/base/config/proto/auth.proto [identical]`
- `infra/k8s/base/config/proto/booking.proto [content_diff]`
- `infra/k8s/base/config/proto/common.proto [content_diff]`
- `infra/k8s/base/config/proto/events/auth.proto [content_diff]`
- `infra/k8s/base/config/proto/events/envelope.proto [content_diff]`
- `infra/k8s/base/config/proto/events/messaging/v1/messaging_events.proto [identical]`
- `infra/k8s/base/config/proto/health.proto [identical]`
- `infra/k8s/base/config/proto/listings.proto [content_diff]`
- `infra/k8s/base/config/proto/media.proto [content_diff]`
- `infra/k8s/base/config/proto/messaging.proto [identical]`
- `infra/k8s/base/config/proto/notification.proto [content_diff]`
- `infra/k8s/base/config/proto/trust.proto [content_diff]`
- `infra/k8s/base/config/strict-envelope.json [identical]`
- `infra/k8s/base/config/transport-routing-defaults.json [identical]`
- `infra/k8s/base/docs/grpc-probes-mtls-template.yaml [identical]`
- `infra/k8s/base/envoy-test/deploy.yaml [content_diff]`
- `infra/k8s/base/envoy-test/deploy.yaml.bak [identical]`
- `infra/k8s/base/envoy-test/deploy.yaml.bak2 [identical]`
- `infra/k8s/base/envoy-test/envoy.yaml [content_diff]`
- `infra/k8s/base/envoy-test/kustomization.yaml [identical]`
- … *40 more*

### `observability`

- `infra/k8s/base/observability/alertmanager-slo-route-example.yaml [content_diff]`
- `infra/k8s/base/observability/grafana-dashboard-auth-outbox.yaml [content_diff]`
- `infra/k8s/base/observability/grafana-dashboard-providers.yaml [content_diff]`
- `infra/k8s/base/observability/grafana-dashboards-transport.yaml [content_diff]`
- `infra/k8s/base/observability/grafana-dashboards.yaml [content_diff]`
- `infra/k8s/base/observability/grafana-deploy.yaml [content_diff]`
- `infra/k8s/base/observability/jaeger-deploy.yaml [content_diff]`
- `infra/k8s/base/observability/kustomization.yaml [content_diff]`
- `infra/k8s/base/observability/namespace.yaml [identical]`
- `infra/k8s/base/observability/newrelic-secret.yaml [identical]`
- `infra/k8s/base/observability/och-slo-prometheusrule.yaml [missing_in_repo]`
- `infra/k8s/base/observability/otel-collector-deploy.yaml [identical]`
- `infra/k8s/base/observability/otel-instrumentation.md.gz [identical]`
- `infra/k8s/base/observability/podmonitors.yaml [identical]`
- `infra/k8s/base/observability/prometheus-deploy.yaml [content_diff]`
- `infra/k8s/base/observability/prometheus-rules-auth-outbox.yaml [identical]`
- `infra/k8s/base/observability/prometheus-rules-kafka-health.yaml [content_diff]`
- `infra/k8s/base/observability/prometheus-rules-och-slo.yaml [missing_in_repo]`
- `infra/k8s/base/observability/servicemonitors.yaml [identical]`
- `infra/k8s/base/observability/splunk-secret.yaml [identical]`
- `infra/k8s/observability/chaos-nightly-cronjob.yaml [identical]`
- `monitoring/prometheus-rules/kafka-kraft-dns.yaml [identical]`
- `scripts/diagram/data/kafka-broker-status.prometheus-notes.md [identical]`

### `optional_docs`

- `GOLDEN_SNAPSHOT_AND_CHAOS.md [missing_in_repo]`
- `SELF_BUILT_SERVICE_MESH.md [missing_in_repo]`
- `docker/caddy-with-tcpdump/README.md [content_diff]`
- `docker/envoy-with-tcpdump/README.md [identical]`
- `proto/events/README.md [content_diff]`

### `optional_other`

- `.npmrc [content_diff]`
- `Makefile [content_diff]`
- `README.txt [missing_in_repo]`
- `package.json [content_diff]`
- `pnpm-lock.yaml [content_diff]`
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
- `tsconfig.base.json [identical]`
- `vitest.account-deletion.config.ts [missing_in_repo]`
- `vitest.system.config.mts [content_diff]`

### `runtime_critical`

- `Caddyfile [content_diff]`
- `docker/caddy-with-tcpdump/Dockerfile [content_diff]`
- `docker/envoy-with-tcpdump/Dockerfile [content_diff]`
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

- `docs/runbooks/kafka-kraft-stale-dns-rca.md` — **content_diff** (infra_script) sha256 staging=656c3ae86b30… repo=e20b5f0d3a5b…
- `infra/k8s/base/analytics-service/deploy.yaml` — **content_diff** (infra_script) sha256 staging=e52814aee61c… repo=c3dc4d354410…
- `infra/k8s/base/analytics-service/service.yaml` — **content_diff** (infra_script) sha256 staging=c915a4ad970b… repo=cca52e1b156b…
- `infra/k8s/base/api-gateway/deploy.yaml` — **content_diff** (infra_script) sha256 staging=10fb9fcbe512… repo=0fcc00e7ef22…
- `infra/k8s/base/api-gateway/service.yaml` — **content_diff** (infra_script) sha256 staging=2262a3f83509… repo=0a3c5d72135a…
- `infra/k8s/base/auth-service/deploy.yaml` — **content_diff** (infra_script) sha256 staging=634a910835b7… repo=9a40785a6c69…
- `infra/k8s/base/auth-service/grpc-health-probe.yaml` — **content_diff** (infra_script) sha256 staging=2939a7b1b2a7… repo=3659704e32a9…
- `infra/k8s/base/auth-service/service.yaml` — **content_diff** (infra_script) sha256 staging=2cd022e9d326… repo=5387f4b9707e…
- `infra/k8s/base/config/app-config.yaml` — **content_diff** (infra_script) sha256 staging=6c062f27db87… repo=5ed97ae25e6a…
- `infra/k8s/base/config/proto/analytics.proto` — **content_diff** (infra_script) sha256 staging=08ace97da07d… repo=b187db21d5be…
- `infra/k8s/base/config/proto/booking.proto` — **content_diff** (infra_script) sha256 staging=d7831dd55a09… repo=7bbbf6d8b2e0…
- `infra/k8s/base/config/proto/common.proto` — **content_diff** (infra_script) sha256 staging=7ec3b2a34010… repo=4f47cc651738…
- `infra/k8s/base/config/proto/events/auth.proto` — **content_diff** (infra_script) sha256 staging=fe6a46feab4c… repo=6b2777479ce2…
- `infra/k8s/base/config/proto/events/envelope.proto` — **content_diff** (infra_script) sha256 staging=1b420f6b27ff… repo=c00feaaeffa2…
- `infra/k8s/base/config/proto/listings.proto` — **content_diff** (infra_script) sha256 staging=bfeeda7aeafb… repo=4d3da9351450…
- `infra/k8s/base/config/proto/media.proto` — **content_diff** (infra_script) sha256 staging=e9e290e47df9… repo=097b73119a63…
- `infra/k8s/base/config/proto/notification.proto` — **content_diff** (infra_script) sha256 staging=4f23392c80ce… repo=2e37c47e3fe4…
- `infra/k8s/base/config/proto/trust.proto` — **content_diff** (infra_script) sha256 staging=ed3ea33a362f… repo=c593c67c44a6…
- `infra/k8s/base/envoy-test/deploy.yaml` — **content_diff** (infra_script) sha256 staging=aab4384fcaae… repo=1cf5056a9700…
- `infra/k8s/base/envoy-test/envoy.yaml` — **content_diff** (infra_script) sha256 staging=9b3093521250… repo=424534515bc3…
- `infra/k8s/base/haproxy/configmap.yaml` — **content_diff** (infra_script) sha256 staging=cef95decf1ff… repo=f4ff1f477220…
- `infra/k8s/base/haproxy/deploy.yaml` — **content_diff** (infra_script) sha256 staging=98ac0b29740a… repo=8d8ab8ce9381…
- `infra/k8s/base/haproxy/haproxy.cfg` — **content_diff** (infra_script) sha256 staging=886b44b92b13… repo=8292afe0eab0…
- `infra/k8s/base/kustomization.yaml` — **content_diff** (infra_script) sha256 staging=253e6a8548d5… repo=eb40455552ca…
- `infra/k8s/base/listings-service/deploy.yaml` — **content_diff** (infra_script) sha256 staging=cad67df83223… repo=3a06f66bb18d…
- `infra/k8s/base/listings-service/kustomization.yaml` — **content_diff** (infra_script) sha256 staging=226826ec1969… repo=d61aab5128f1…
- `infra/k8s/base/listings-service/service.yaml` — **content_diff** (infra_script) sha256 staging=c8b47c08c3b3… repo=79e86f2b1148…
- `infra/k8s/base/monitoring/servicemonitors.yaml` — **content_diff** (infra_script) sha256 staging=c6e31d008951… repo=56ef494d148d…
- `infra/k8s/base/nginx/deploy.yaml` — **content_diff** (infra_script) sha256 staging=0eec789c78b8… repo=cf420531d59a…
- `infra/k8s/base/nginx/nginx.conf` — **content_diff** (infra_script) sha256 staging=54359834d11d… repo=66c5e3d9a3c7…
- `infra/k8s/base/redis/deploy.yaml` — **content_diff** (infra_script) sha256 staging=3d9635a4b6aa… repo=f0e3cd7d255f…
- `infra/k8s/base/redis/external-service.yaml` — **content_diff** (infra_script) sha256 staging=fdc14bbd76e9… repo=d73547bcbd7e…
- `infra/k8s/base/webapp/deploy.yaml` — **content_diff** (infra_script) sha256 staging=f24cc0be6fcc… repo=6f4cf318caee…
- `infra/k8s/base/webapp/kustomization.yaml` — **content_diff** (infra_script) sha256 staging=d61aab5128f1… repo=67f6888386cc…
- `infra/k8s/base/webapp/service.yaml` — **content_diff** (infra_script) sha256 staging=6ae4cf8a9866… repo=923c5c6f1b42…
- `infra/k8s/caddy-h3-configmap.yaml` — **content_diff** (infra_script) sha256 staging=bc0947ed8b29… repo=3da92aeff207…
- `infra/k8s/caddy-h3-deploy-loadbalancer.yaml` — **content_diff** (infra_script) sha256 staging=b04f19858fa4… repo=5ca98d2ac8d7…
- `infra/k8s/caddy-h3-deploy.yaml` — **content_diff** (infra_script) sha256 staging=41d43ea2877e… repo=eb8ccae0b754…
- `infra/k8s/ingress-nginx-envoy.yaml` — **content_diff** (infra_script) sha256 staging=c1bb568e6dcb… repo=2d3a7ae31b2e…
- `infra/k8s/kafka-certs/README.md` — **content_diff** (infra_script) sha256 staging=e16c4946f41c… repo=8ed2419f1413…
- `infra/k8s/kafka-certs/kafka-tls-preflight-job.yaml` — **content_diff** (infra_script) sha256 staging=b190402810fb… repo=0990f3da6ef9…
- `infra/k8s/kafka-kraft-metallb/exporter.py` — **content_diff** (infra_script) sha256 staging=fcf7b33ba13c… repo=09abfe4525b5…
- `infra/k8s/kafka-kraft-metallb/external-services.yaml` — **content_diff** (infra_script) sha256 staging=e9fe1bbefd99… repo=224f606c722d…
- `infra/k8s/kafka-kraft-metallb/kustomization.yaml` — **content_diff** (infra_script) sha256 staging=6d41731e8293… repo=ca2a63bf3590…
- `infra/k8s/loadbalancer.yaml` — **content_diff** (infra_script) sha256 staging=eb8449750102… repo=6b01baa84e15…
- `infra/k8s/metallb/bgpadvertisement.example.yaml` — **content_diff** (infra_script) sha256 staging=23b42837b121… repo=9d137589b1a5…
- `infra/k8s/metallb/bgpadvertisement.yaml` — **content_diff** (infra_script) sha256 staging=9db582cebadd… repo=1bc5a831f2fc…
- `infra/k8s/overlays/dev/bootstrap.sh` — **content_diff** (infra_script) sha256 staging=503a29017bfb… repo=ea75e4cbc211…
- `infra/k8s/overlays/dev/ingress-grpc.yaml` — **content_diff** (infra_script) sha256 staging=402e431c8778… repo=288316bd6cbf…
- `infra/k8s/overlays/dev/ingress-privacy-terms.yaml` — **content_diff** (infra_script) sha256 staging=aba44bfdfb5e… repo=1fa30d511f60…
- `infra/k8s/overlays/dev/ingress.yaml` — **content_diff** (infra_script) sha256 staging=49cb6dbed84b… repo=ce1e90a4b855…
- `infra/k8s/overlays/dev/kustomization.yaml` — **content_diff** (infra_script) sha256 staging=f0460fff0b42… repo=3ef3dfcc2b4c…
- `infra/k8s/overlays/dev/patches/api-gateway-resources.yaml` — **content_diff** (infra_script) sha256 staging=1c272ca398ac… repo=d3eabf105d3c…
- `infra/k8s/overlays/dev/patches/disk-pressure-tolerations.yaml` — **content_diff** (infra_script) sha256 staging=bd9b1d8aa84b… repo=b8b78b6b1bc9…
- `infra/k8s/overlays/dev/patches/replicas-rest.yaml` — **content_diff** (infra_script) sha256 staging=d12a3b1b6856… repo=e84a744e0fb6…
- `infra/k8s/overlays/prod/caddy-rolling-update.yaml` — **content_diff** (infra_script) sha256 staging=d213873d8eb4… repo=a98a75c1999c…
- `scripts/aggressive-cleanup-replicasets.sh` — **content_diff** (infra_script) sha256 staging=623cac4f381d… repo=96999f9f3f2b…
- `scripts/apply-kafka-kraft-staged.sh` — **content_diff** (infra_script) sha256 staging=8d00d75d913a… repo=864a7987207a…
- `scripts/apply-metallb-pool-colima.sh` — **content_diff** (infra_script) sha256 staging=b79f7b688793… repo=2524edcff8ed…
- `scripts/assert-kafka-integration-cluster.mjs` — **content_diff** (infra_script) sha256 staging=ccca46e6a98e… repo=f43d60fa7a70…
- `scripts/bring-up-external-infra.sh` — **content_diff** (infra_script) sha256 staging=6fa9ed27d376… repo=2d3dcfb7b478…
- `scripts/build-housing-images-k3s.sh` — **content_diff** (infra_script) sha256 staging=605b4f153695… repo=618592a1faef…
- `scripts/build-k6-http3.sh` — **content_diff** (infra_script) sha256 staging=11b3d16720d0… repo=1eb62035fed6…
- `scripts/check-all-pods-and-tls.sh` — **content_diff** (infra_script) sha256 staging=33850cb3c7fc… repo=2541dfebfacf…
- `scripts/ci/generate-kafka-ci-tls.sh` — **content_diff** (infra_script) sha256 staging=9f1e048d6782… repo=0a2f99005db0…
- `scripts/ci/smoke-api-gateway.sh` — **content_diff** (infra_script) sha256 staging=a549f50e65d7… repo=9151fd4e498b…
- `scripts/ci/start-kafka-tls-ci.sh` — **content_diff** (infra_script) sha256 staging=5344695e47e0… repo=1f9521e73254…
- `scripts/ci/verify-quic-hostname-invariant.sh` — **content_diff** (infra_script) sha256 staging=ecca55a2af86… repo=e69476c1eea0…
- `scripts/cleanup-kafka-ops-cronjob-pods.sh` — **content_diff** (infra_script) sha256 staging=0a57e499b54d… repo=7bfa7bb38e46…
- `scripts/cluster-log-sweep.sh` — **content_diff** (infra_script) sha256 staging=9621c52e71e5… repo=aa1b9b9af736…
- `scripts/colima-apply-host-aliases.sh` — **content_diff** (infra_script) sha256 staging=83f9e91e52ee… repo=fe2b490160f6…
- `scripts/colima-edge-sysctl-tuning.sh` — **content_diff** (infra_script) sha256 staging=7b07daf78449… repo=15ceee458d72…
- `scripts/colima-metallb-bring-up.sh` — **content_diff** (infra_script) sha256 staging=c17c0364a72c… repo=b95df40950a6…
- `scripts/colima-patch-app-config-db-host-to-gateway.sh` — **content_diff** (infra_script) sha256 staging=8ce559e7a866… repo=350d65179b31…
- `scripts/compare-h2-h3-headers.sh` — **content_diff** (infra_script) sha256 staging=7ccb9de7e03c… repo=12ed91ac8696…
- `scripts/create-kafka-event-topics-k8s.sh` — **content_diff** (infra_script) sha256 staging=e81386e2ca9e… repo=3c7173026554…
- `scripts/create-kafka-event-topics.sh` — **content_diff** (infra_script) sha256 staging=d1ad5b10d745… repo=de37bad6bd39…
- `scripts/deep-dive-pod-diagnostics.sh` — **content_diff** (infra_script) sha256 staging=ae25e17d8d75… repo=de2e6f695cb9…
- `scripts/dev-generate-certs.sh` — **content_diff** (infra_script) sha256 staging=5737a49cb388… repo=3d8952a49b35…
- `scripts/dev-onboard-local.sh` — **content_diff** (infra_script) sha256 staging=99e3bd465b1b… repo=4178c9edb825…
- `scripts/dev-onboard-zero-trust-preflight.sh` — **content_diff** (infra_script) sha256 staging=3a6455a2768a… repo=b72f48358ffe…
- `scripts/diagnose-k6-edge-connectivity.sh` — **content_diff** (infra_script) sha256 staging=48ba3007d109… repo=9636cf54b2e9…
- `scripts/edge-readiness-gate.sh` — **content_diff** (infra_script) sha256 staging=28d4c96b78ef… repo=c755430f0c87…
- `scripts/enhanced-adversarial-tests.sh` — **content_diff** (infra_script) sha256 staging=808bf4d4f34c… repo=8109f8a87dca…
- `scripts/ensure-all-services-tls.sh` — **content_diff** (infra_script) sha256 staging=89c8e836589a… repo=36a15dc7c082…
- `scripts/ensure-caddy-envoy-strict-tls.sh` — **content_diff** (infra_script) sha256 staging=81c8d40a903e… repo=b640de33e7c9…
- `scripts/ensure-colima-metallb-for-l2.sh` — **content_diff** (infra_script) sha256 staging=672712baf065… repo=f64e02672f66…
- `scripts/ensure-edge-hosts.sh` — **content_diff** (infra_script) sha256 staging=abd5bb3ee24c… repo=06059dfdaf87…
- `scripts/ensure-housing-cluster-secrets.sh` — **content_diff** (infra_script) sha256 staging=4ea01a162c2c… repo=d9142ff4a6b4…
- `scripts/ensure-kafka-ready.sh` — **content_diff** (infra_script) sha256 staging=f0671916a4b2… repo=1dd2de6be1a8…
- `scripts/ensure-ready-for-preflight.sh` — **content_diff** (infra_script) sha256 staging=1e204cc0d6c9… repo=531074f8c36a…
- `scripts/ensure-strict-tls-mtls-preflight.sh` — **content_diff** (infra_script) sha256 staging=8115673a7198… repo=bacd2bebc832…
- `scripts/force-deployments-to-working-replicasets.sh` — **content_diff** (infra_script) sha256 staging=59fca109fa5c… repo=4080a0dc5c2c…
- `scripts/generate-envoy-client-cert.sh` — **content_diff** (infra_script) sha256 staging=7092b14eb3a2… repo=648c37eb79b1…
- `scripts/get-pods-to-ready.sh` — **content_diff** (infra_script) sha256 staging=f4635db1c67e… repo=b3adc7dc50ca…
- `scripts/golden-snapshot-verify.sh` — **content_diff** (infra_script) sha256 staging=7a410e6767b8… repo=9d2e87d35216…
- `scripts/k3d-registry-push-and-patch.sh` — **content_diff** (infra_script) sha256 staging=0004c38bf42d… repo=f5970f8e4e06…
- `scripts/k6-chaos-test.js` — **content_diff** (infra_script) sha256 staging=7135307c3bcb… repo=50f652009fc3…
- `scripts/k6-exec-strict-edge.sh` — **content_diff** (infra_script) sha256 staging=b9f56650fcc6… repo=4a61537b418b…
- `scripts/k6/k6-smoke-gateway.js` — **content_diff** (infra_script) sha256 staging=16f4fbcb60e5… repo=9f98e4374b1a…
- `scripts/kafka-refresh-tls-from-lb.sh` — **content_diff** (infra_script) sha256 staging=18eb547794cd… repo=df008f526e35…
- `scripts/kafka-runtime-sync.sh` — **content_diff** (infra_script) sha256 staging=9ab539c4bfd5… repo=b46466e72266…
- `scripts/kafka-ssl-from-dev-root.sh` — **content_diff** (infra_script) sha256 staging=e5e98590f62c… repo=d5356fba84e6…
- `scripts/kafka-sync-metallb.sh` — **content_diff** (infra_script) sha256 staging=40db1ad1f720… repo=61e86afcbed6…
- `scripts/kafka-tls-guard.sh` — **content_diff** (infra_script) sha256 staging=7c6f54769005… repo=576b801d505e…
- `scripts/kafka-tls-rotate-atomic.sh` — **content_diff** (infra_script) sha256 staging=5e53a5a8b009… repo=dc4cdb631b1e…
- `scripts/lib/COHERENT_ANALYSIS.md` — **content_diff** (infra_script) sha256 staging=ab528b71be96… repo=b32aaaf5840e…
- `scripts/lib/edge-test-url.sh` — **content_diff** (infra_script) sha256 staging=cfa614052ce9… repo=df827f5ced16…
- `scripts/lib/ensure-colima-docker-context.sh` — **content_diff** (infra_script) sha256 staging=21f42fb0d7b4… repo=4305d0cfcfe2…
- `scripts/lib/grpc-http3-health.sh` — **content_diff** (infra_script) sha256 staging=202fc3ca136c… repo=3207bc1d1d64…
- `scripts/lib/http3.sh` — **content_diff** (infra_script) sha256 staging=e355be1dcea3… repo=958a2e83c164…
- `scripts/lib/kafka-kraft-quorum-ok.sh` — **content_diff** (infra_script) sha256 staging=8e5d33d80a9d… repo=0841670fc3dd…
- `scripts/lib/packet-capture-v2.sh` — **content_diff** (infra_script) sha256 staging=e6a872c6a67b… repo=d4890cef06c0…
- `scripts/lib/packet-capture.sh` — **content_diff** (infra_script) sha256 staging=86d175b4a189… repo=76c3f5d1389c…
- `scripts/lib/protocol-verification.sh` — **content_diff** (infra_script) sha256 staging=ef04ec6b3b14… repo=fe0470b33253…
- `scripts/lib/transport_validator.py` — **content_diff** (infra_script) sha256 staging=0c8d991c99d5… repo=f54b9003eab5…
- `scripts/lib/trust-dev-root-ca-macos.sh` — **content_diff** (infra_script) sha256 staging=6e8f49797f56… repo=b53befb1a37c…
- `scripts/load/k6-analytics-daily-smoke.js` — **content_diff** (infra_script) sha256 staging=163bc86cb894… repo=58e0e1f829e2…
- `scripts/load/k6-analytics-listing-feel-smoke.js` — **content_diff** (infra_script) sha256 staging=bf968095ab7f… repo=81a594445ef3…
- `scripts/load/k6-edge-load-diagnostics.sh` — **content_diff** (infra_script) sha256 staging=905b9911be06… repo=0d0c7fc58b32…
- `scripts/load/k6-find-max-rps-http3.js` — **content_diff** (infra_script) sha256 staging=17b270577c8a… repo=61b40a3d3e1a…
- `scripts/load/k6-http3-complete.js` — **content_diff** (infra_script) sha256 staging=d8dc2a564974… repo=7391c5f06b27…
- `scripts/load/k6-http3-toolchain.js` — **content_diff** (infra_script) sha256 staging=c33cd2dbadcb… repo=f75ef749ca93…
- `scripts/load/k6-limit-test-comprehensive.js` — **content_diff** (infra_script) sha256 staging=31985240bcbe… repo=d4fa7f7f6436…
- `scripts/load/k6-listings-health.js` — **content_diff** (infra_script) sha256 staging=ed6495a96d60… repo=4ccea25c0c7a…
- `scripts/load/k6-listings.js` — **content_diff** (infra_script) sha256 staging=95106dea7055… repo=7fd454a5d4ee…
- `scripts/load/k6-media-upload.js` — **content_diff** (infra_script) sha256 staging=6f37cfc46a3b… repo=f9d6540dac37…
- `scripts/load/k6-messaging-direct-message.js` — **content_diff** (infra_script) sha256 staging=da7034ea1742… repo=013ab2008ac6…
- `scripts/load/k6-messaging-e2e.js` — **content_diff** (infra_script) sha256 staging=d5aca273a85c… repo=42ccb27932d3…
- `scripts/load/k6-messaging-flow.js` — **content_diff** (infra_script) sha256 staging=4603cd89876b… repo=25eed5299c0b…
- `scripts/load/k6-messaging-limit-finder.js` — **content_diff** (infra_script) sha256 staging=ec58b3374f6f… repo=0c92a175e1bb…
- `scripts/load/k6-messaging.js` — **content_diff** (infra_script) sha256 staging=743faf25c973… repo=8a7069052a8e…
- `scripts/load/k6-reads.js` — **content_diff** (infra_script) sha256 staging=ca54f00de1c2… repo=52297f3736e4…
- `scripts/load/k6-spam-test.js` — **content_diff** (infra_script) sha256 staging=2d95c640e4f6… repo=13f2aa02819c…
- `scripts/load/k6-strict-edge-tls.js` — **content_diff** (infra_script) sha256 staging=22c6bdc8d8e6… repo=0831c8642707…
- `scripts/load/run-k6-all-services.sh` — **content_diff** (infra_script) sha256 staging=68a874a2afdb… repo=6080952b35b5…
- `scripts/load/run-k6-phases.sh` — **content_diff** (infra_script) sha256 staging=3dfe62d6a8ea… repo=9bcc75c80d9b…
- `scripts/patch-kafka-external-host.sh` — **content_diff** (infra_script) sha256 staging=b4ba968fd148… repo=c0f4972a2a5d…
- `scripts/perf/build-canonical-bundle.sh` — **content_diff** (infra_script) sha256 staging=61f71947ef24… repo=af1f4c91bfe4…
- `scripts/perf/run-all-k6-load-report.sh` — **content_diff** (infra_script) sha256 staging=19d628a31c08… repo=1de50a5b8daf…
- `scripts/perf/run-k6-cross-service-isolation.sh` — **content_diff** (infra_script) sha256 staging=1fb53b6e0f7b… repo=92f991c829cd…
- `scripts/perf/run-preflight-phase-d-tail-lab.sh` — **content_diff** (infra_script) sha256 staging=1aab52fc3412… repo=045cc1e09206…
- `scripts/perf/watch-cluster-contention.sh` — **content_diff** (infra_script) sha256 staging=03a73c17cbca… repo=0de01c055166…
- `scripts/preflight-kafka-k8s-rollout.sh` — **content_diff** (infra_script) sha256 staging=538d3297e2ca… repo=94f9da127f2c…
- `scripts/protocol/full-edge-transport-validation.sh` — **content_diff** (infra_script) sha256 staging=07091845dfe5… repo=c4d63b5e136a…
- `scripts/protocol/test-service-protocol.sh` — **content_diff** (infra_script) sha256 staging=45c6d9923b54… repo=d3feec0c41f0…
- `scripts/quick-pod-diagnostics.sh` — **content_diff** (infra_script) sha256 staging=bc9f02c72a7d… repo=b6d6bf481a19…
- `scripts/rebuild-all-housing-images-k3s.sh` — **content_diff** (infra_script) sha256 staging=da921b1a78cb… repo=efd70f3b385e…
- `scripts/rebuild-traffic-control-stack.sh` — **content_diff** (infra_script) sha256 staging=9ee33eda07ef… repo=f3e781838158…
- `scripts/reissue-ca-and-leaf-load-all-services.sh` — **content_diff** (infra_script) sha256 staging=547a43adff67… repo=4b1f0f80d8e2…
- … *465 more missing/diff rows*
