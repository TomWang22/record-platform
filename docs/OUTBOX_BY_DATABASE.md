# Transactional outbox by database

Every **producing** service database that can emit Kafka events should expose the same idempotent `outbox_events` pattern: domain write + outbox insert in **one transaction**, then a background publisher builds **`EventEnvelope`** (see `proto/events/envelope.proto`) and publishes to the matching **`${ENV_PREFIX}.<domain>.events`** topic (except messaging, which uses `messaging.events.v1`).

## Kafka topology (record-platform default)

- **Three KRaft brokers** (`kafka-0..2`) in the app namespace (default **`record-platform`**, overridable via **`HOUSING_NS`**).
- **Strict TLS** on internal `:9093`; external listeners on MetalLB **`kafka-*-external :9094`** when enabled.
- **Broker certs** must include **serverAuth + clientAuth** (inter-broker TLS as client); see `scripts/kafka-ssl-from-dev-root.sh`.
- **App mTLS** uses client material from `rp-kafka-ssl-client-secret` (or equivalent); Envoy upstream client certs use `scripts/generate-envoy-client-cert.sh` (**clientAuth** EKU).

## Outbox SQL files (`infra/db/`)

| Database (typical port) | Schema.table | Script |
|-------------------------|--------------|--------|
| auth (5437) | `auth.outbox_events` | `01-auth-outbox.sql` |
| messaging | `messaging.outbox_events` | `02-messaging-outbox.sql` |
| media | `media.outbox_events` | `02-media-outbox.sql` |
| listings (5435) | `listings.outbox_events` | `03-listings-outbox.sql` |
| booking | `booking.outbox_events` | `03-booking-outbox.sql` |
| trust | `trust.outbox_events` | `03-trust-outbox.sql` |
| notification | `notification.outbox_events` | `03-notification-outbox.sql` |
| records (5433) | `records.outbox_events` | `01-records-outbox.sql` |
| shopping (5436) | `shopping.outbox_events` | `01-shopping-outbox.sql` |
| social (5434) | `social.outbox_events` | `01-social-outbox.sql` |
| auction_monitor (5438) | `auction_monitor.outbox_events` | `01-auction-monitor-outbox.sql` |
| python_ai (5440) | `ai.outbox_events` | `01-ai-outbox.sql` |
| analytics (5447) | `analytics.outbox_events` | `03-analytics-outbox.sql` (optional; use when analytics **publishes**) |

**Contract:** `payload` = serialized domain proto bytes; **`envelope.event_id` = `outbox_events.id`**; Kafka key = **`aggregate_id`**. See **`docs/OUTBOX_PUBLISHER_AND_CONSUMER_CONTRACT.md`**. Quick matrix: **`docs/OUTBOX_PROTO_TOPIC_MATRIX.md`**. Account deletion / anonymization: **`docs/GDPR_ACCOUNT_DELETION_AND_ANONYMIZATION.md`**. CI-style check: **`scripts/verify-outbox-infra-alignment.sh`**.

## Proto ↔ topic

Top-level `proto/events/*.proto` files (except `envelope.proto`) map to `${ENV_PREFIX}.<filename-stem>.events` via `scripts/lib/rp-kafka-event-topics-from-proto.sh`. Run `./scripts/create-kafka-event-topics-k8s.sh` (or host script) after brokers are healthy.
