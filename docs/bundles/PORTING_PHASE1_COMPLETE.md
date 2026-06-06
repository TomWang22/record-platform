# Porting Phase 1 — applied (2026-05-19)

Source bundle: `record-platform-och-cold-bootstrap-porting-bundle-20260519-114643.tar.gz`

## Services copied into repo

| Service | Path |
|---------|------|
| messaging-service | `services/messaging-service/` |
| media-service | `services/media-service/` |
| trust-service | `services/trust-service/` |
| notification-service | `services/notification-service/` |
| transport-watchdog | `services/transport-watchdog/` (api-gateway sidecar) |
| event-layer-verification | `services/event-layer-verification/` |
| ollama-gateway / ollama-worker | `services/ollama-gateway/`, `services/ollama-worker/` |
| auth-service | merged from bundle |
| analytics-service | merged from bundle |
| listings-service | merged from bundle (OCH search/kafka/revisions) |

**Not deployed:** `booking-service` (RP uses `shopping-service` + shipments).

## API gateway

- Port **4020**, `transport-watchdog` sidecar, Redis key `rp:gw:watchdog_throttle`
- Proxies: `/messaging`, `/api/messages`, `/api/forum`, `/trust`, `/media`, `/notification`
- Auth HTTP **4011**, listings **4012**, analytics **4017**, auth gRPC **50061**, listings gRPC **50062**

## Kubernetes

`infra/k8s/base/kustomization.yaml` now includes: messaging, media, trust, notification, metrics-server, ollama.

TLS secret refs normalized to `service-tls` + `kafka-ssl-secret`.

## External infra

- `docker-compose.external-och.yml` — 8 Postgres (5441–5448), Redis 6380, MinIO, Jaeger, Mailpit
- `app-config.yaml` — DB URLs, S3/MinIO for media, Kafka KRaft bootstrap

## Proto / events

- `proto/events/listing.proto` — legacy housing events + **RecordListingCreatedV1** (goldmine-style grade **strings**)
- Event protos synced to `infra/k8s/base/config/proto/events/`

## Hybrid DB plan (no cold-bootstrap yet)

See `backups/hybrid-rp-och/README.md`.

## Next steps (Phase 2)

1. Build hybrid backup folder (`och-all-8` + RP records/shopping dumps).
2. `docker compose -f docker-compose.external-och.yml up -d`
3. Restore/sanitize OCH DBs; bootstrap drift via `scripts/bootstrap-all-dbs.sh`.
4. Apply KRaft: `infra/k8s/kafka-kraft-metallb/` + cert scripts + EKU verify.
5. `pnpm install && pnpm run build`; image build/push for new services.
6. Listings Prisma/SQL: wire `record_id`, Japanese grades, listing↔media upload flow.
7. Grafana: finish RP dashboard UID/title pass (metric renames started in `observability/`).
