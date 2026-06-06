# Outbox SQL ↔ proto ↔ Kafka topic (quick matrix)

| DB / schema | Outbox table SQL | Domain protos | Default Kafka topic pattern |
|-------------|------------------|---------------|-----------------------------|
| auth | `infra/db/01-auth-outbox.sql` | `proto/events/auth.proto` | `${ENV_PREFIX}.auth.events` |
| auth (lifecycle) | same table, row `type=user.account.deleted.v1` | `UserAccountDeletedV1` | **`${ENV_PREFIX}.user.lifecycle.v1`** (routed by publisher, not `.auth.events`) |
| messaging | `infra/db/02-messaging-outbox.sql` | `proto/events/messaging.proto` | **`messaging.events.v1`** |
| media | `infra/db/02-media-outbox.sql` | `proto/events` (if added) / media events | `${ENV_PREFIX}.media.events` |
| listings | `infra/db/03-listings-outbox.sql` | `proto/events/listing.proto` | `${ENV_PREFIX}.listing.events` |
| booking | `infra/db/03-booking-outbox.sql` | `proto/events/booking.proto` | `${ENV_PREFIX}.booking.events` (+ optional `.v1` per scripts) |
| trust | `infra/db/03-trust-outbox.sql` | `proto/events/trust.proto` | `${ENV_PREFIX}.trust.events` |
| notification | `infra/db/03-notification-outbox.sql` | `proto/events/notification.proto` | `${ENV_PREFIX}.notification.events` |
| records | `infra/db/01-records-outbox.sql` | `proto/events/records.proto` | `${ENV_PREFIX}.records.events` |
| shopping | `infra/db/01-shopping-outbox.sql` | `proto/events/shopping.proto` | `${ENV_PREFIX}.shopping.events` |
| auction_monitor | `infra/db/01-auction-monitor-outbox.sql` | `proto/events/auction_monitor.proto` | `${ENV_PREFIX}.auction_monitor.events` |
| python_ai | `infra/db/01-ai-outbox.sql` | `proto/events/ai.proto` | `${ENV_PREFIX}.ai.events` |
| analytics | `infra/db/03-analytics-outbox.sql` | `proto/events/analytics.proto` | `${ENV_PREFIX}.analytics.events` |

Topic generation script: **`scripts/lib/och-kafka-event-topics-from-proto.sh`** (also adds **`user.lifecycle.v1`**, **`user.lifecycle.ack.v1`**, **`messaging.dlq`**, **`booking.events.v1`**).

Apply outbox DDL before enabling producers. **Auth** lifecycle rows are not emitted from auth-service yet; use **`@common/utils/outbox`** (`buildKafkaMessageFromOutboxRow`) + a publisher worker with **`01-auth-outbox.sql`** applied.
