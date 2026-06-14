# Record Platform AI soak observability (Phase 16)

Phase 16 adds soak monitors and documents existing Prometheus metrics. No new product features.

## Soak scripts

| Script | Purpose | Reports |
|--------|---------|---------|
| `scripts/rp-ai-soak-monitor.sh` | Sample AI endpoints over `SOAK_DURATION_SECONDS` (default 900s) | `bench_logs/ai-platform/phase-16-ai-soak-monitor.{md,json}` |
| `scripts/rp-event-lag-monitor.sh` | Outbox/notification deltas + Kafka mTLS | `bench_logs/release-contract/phase-16-event-lag-monitor.md` |
| `scripts/phase-16-soak-gates.sh` | Full Phase 16 gate bundle | `bench_logs/ai-platform/phase-16-soak-gates-run.log` |

### Environment

- `SOAK_DURATION_SECONDS` — AI soak window (default `900`)
- `SOAK_INTERVAL_SECONDS` — sample interval (default `60`)
- `LAG_WINDOW_SECONDS` — event lag window (defaults to `SOAK_DURATION_SECONDS`)
- `AI_SOAK_API_BASE` / `RP_PUBLIC_ORIGIN` — `https://record-platform.test`
- `NODE_EXTRA_CA_CERTS` — `certs/dev-chain.pem`

## Prometheus metrics (current RP names)

Scrape job `node-services` in `infra/prometheus.yml` targets auth, records, listings, analytics, api-gateway, python-ai on `/metrics`.

### AI

| Metric | Service | Labels |
|--------|---------|--------|
| `ai_http_requests_total` | python-ai-service | `route`, `code` |
| `analytics_requests_total` | analytics-service | — |
| `analytics_latency_seconds` | analytics-service | — |
| `analytics_fallback_total` | analytics-service | — |
| `analytics_ollama_latency_ms` | analytics-service | — |
| `analytics_ollama_failures_total` | analytics-service | — |

### Outbox / Kafka

| Metric | Service | Labels |
|--------|---------|--------|
| `och_outbox_unpublished_count` | all outbox services | `service` |
| `och_outbox_publish_failures_total` | all outbox services | `service` |
| `och_outbox_publish_success_total` | all outbox services | `service` |
| `notification_consume_latency` | notification-service | — |
| `och_kafka_leader_imbalance_max_ratio` | common | — |

### HTTP / Redis / gRPC

| Metric | Notes |
|--------|-------|
| `http_requests_total`, `http_request_duration_seconds` | Per-service HTTP |
| Redis | Runtime contract via `audit-rp-redis-lua-runtime-contract.sh` (no dedicated counter) |
| gRPC mTLS | Gate via `rp-bootstrap-grpc-mtls-gate.sh` (11/11) |

## Grafana

- Provisioning: `infra/grafana/provisioning/`
- Bootstrap dashboard generator: `scripts/generate-grafana-dashboard.mjs` → `bench_logs/bootstrap_grafana_dashboard.json`
- Formal gates: `scripts/observability/*.mjs`, `docs/observability/rp-observability-integrity-spec-v1.md`

Phase 16 does not add mock metrics or OCH/housing dashboards.
