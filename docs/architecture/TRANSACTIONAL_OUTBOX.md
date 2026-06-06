# Transactional outbox

## Problem

Services must not emit Kafka events outside the same database transaction as the domain write. If Kafka is down or slow, direct publish-after-write loses events or creates inconsistent state.

## Pattern

1. **Write** domain row(s) and **insert** `outbox_events` in one DB transaction.
2. **Publisher** (background worker) selects `pending` rows with `FOR UPDATE SKIP LOCKED`.
3. **Publish** to Kafka; on broker ACK, set `status = published` and `published_at`.
4. On failure: increment `attempts`, set `last_error`, backoff via `available_at`; after max attempts → `failed` (dead-letter handling).

## Table shape

See `infra/contracts/outbox-contract.json`. Required columns: `id`, `aggregate_type`, `aggregate_id`, `event_type`, `topic`, `key`, `payload`, `headers`, `status`, `attempts`, `available_at`, lock fields, `published_at`, `last_error`, timestamps.

Indexes: pending publish (`status`, `available_at`, `created_at`), aggregate lookup, topic, `created_at`.

## Idempotency

Each event carries a deterministic id in `payload` or `headers` (e.g. `event_id`) so consumers can dedupe.

## Services and ports

| Service | DB port | Outbox SQL |
|---------|---------|------------|
| auth-service | 5437 | `01-auth-outbox.sql` |
| records-service | 5433 | `01-records-outbox.sql` |
| listings-service | 5435 | `03-listings-outbox.sql` |
| shopping-service | 5436 | `01-shopping-outbox.sql` |
| messaging-service | 5434 | `02-messaging-outbox.sql` |
| notification-service | 5441 | `03-notification-outbox.sql` |
| trust-service | 5442 | `03-trust-outbox.sql` |
| media-service | 5443 | `02-media-outbox.sql` |
| analytics-service | 5439 | `03-analytics-outbox.sql` |
| auction-monitor | 5438 | `01-auction-monitor-outbox.sql` |
| python-ai-service | 5440 | `01-ai-outbox.sql` |

**Not active:** `01-social-outbox.sql`, `03-booking-outbox.sql` (RP skips social/booking).

## Audit

```bash
bash scripts/audit-outbox-pattern.sh
bash scripts/verify-outbox-infra-alignment.sh
```

## Forbidden

- `await db.commit(); await kafka.send(...)` without outbox row in the same transaction.
- Publishing from HTTP handlers after response without outbox.
