# Outbox publisher and consumer contract

Canonical reference for **transactional outbox** rows, **Kafka `EventEnvelope`**, and **idempotent consumers**. Detailed per-database table list: **`docs/OUTBOX_BY_DATABASE.md`**. Proto and topic names: **`proto/events/README.md`**.

## Outbox row (database)

- **`id`**: UUID — becomes **`envelope.event_id`** on publish (do not mint a second UUID).
- **`aggregate_id`**: Kafka message **key** (usually entity id; for account deletion = `user_id`).
- **`type`**: Stable string, e.g. `user.account.deleted.v1`.
- **`version`**: Domain schema version (int), matches envelope `version`.
- **`payload`**: **Serialized domain protobuf bytes only** (not JSON, not an envelope).
- **`published`**: Boolean; publisher sets true after successful Kafka send.

Domain write and outbox `INSERT` MUST share one **database transaction**.

## Kafka message

- **Value**: `EventEnvelope` (`proto/events/envelope.proto`) with `payload` = same domain bytes as outbox.
- **Key**: `aggregate_id` / `entity_id` (per domain rules; messaging uses `conversation_id` where documented).
- **Topic routing**: Default `${ENV_PREFIX}.<domain>.events` from `proto/events/<domain>.proto`, with explicit exceptions in `scripts/lib/och-kafka-event-topics-from-proto.sh` (e.g. **`${ENV_PREFIX}.user.lifecycle.v1`** for account deletion, **`messaging.events.v1`**, DLQ).

## Consumers

- **Dedupe** on `event_id` via `processed_events` (or equivalent) — **`INSERT … ON CONFLICT DO NOTHING`** before handling.
- **User lifecycle**: On `user.account.deleted.v1`, apply **GDPR-style anonymization** (see **`docs/GDPR_ACCOUNT_DELETION_AND_ANONYMIZATION.md`**) — do not rely on auth DB row remaining after deletion.

## Verification

- Topics vs proto: `./scripts/verify-proto-events-topics.sh`, `./scripts/verify-outbox-infra-alignment.sh`
- Library + unit tests (topic routing, `EventEnvelope` encode/decode, consumer dispatch): `pnpm -C services/common run test` (**`@common/utils/outbox`**)
- Partitions / RF: `./scripts/verify-kafka-event-topic-partitions.sh` (as applicable)
