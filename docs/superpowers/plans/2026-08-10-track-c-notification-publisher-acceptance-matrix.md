# Track C — `notification.outbox_events` publisher acceptance matrix

**Date:** 2026-08-10  
**Scope:** notification only · non-live · mocked Kafka  
**execution_authorized:** false  
**Pre-notification freeze (immutable reference — never authorize / never execute):** `9efd0a0333741909d6b4b75256973bbb4035a18709e69d4a6441d07487edb1e7`  
**Starting readiness:** **7 / 1 / 4**  
**DDL:** `infra/db/03-notification-outbox.sql` (`published` boolean only — no lease / retry_count / DLQ)  
**Topic:** `${ENV_PREFIX}.notification.events` (e.g. `dev.notification.events`)  
**Principal:** `CN=notification-service`  
**Kafka key:** `aggregate_id` (per DDL / outbox contract)  
**Mirror:** messaging/media lock-through-ack publisher (`FOR UPDATE SKIP LOCKED` → send → mark `rowCount===1` → COMMIT)  

Expected readiness **only after** Phase A drain **and** Phase B transactional enqueue both pass:

```text
LIFECYCLE_EXECUTABLE = 8
MIGRATION_PENDING    = 1   # auth.outbox_events unchanged
PUBLISHER_BLOCKED    = 3
TOTAL                = 12

remaining blocked:
  records.outbox_events
  shopping.outbox_events
  trust.outbox_events
```

---

## Inspection summary (pre-implementation — freeze this evidence)

| Fact | Evidence |
| --- | --- |
| Outbox table | `notification.outbox_events` on DB `notification` / schema `notification` |
| Status/ack column | `published BOOLEAN NOT NULL DEFAULT false` only |
| Payload column | `BYTEA`; DDL comment currently says **proto bytes / EventEnvelope** |
| Event identity | `id UUID` = envelope `event_id`; no new UUID on drain |
| Topic | `${ENV_PREFIX}.notification.events` |
| Principal / ACL | `CN=notification-service` · WRITE that topic |
| Domain table (same DB) | `notification.notifications` (+ `processed_events`, preferences, …) |
| Same-connection TX | **Possible** — domain + outbox share `POSTGRES_URL_NOTIFICATION` pool |
| Outbox INSERT sites | **None** in repository |
| Kafka **producer** | **None** in notification-service (consumer + Redis realtime only) |
| Direct-produce of Notification\* | **None** (no stub producer path) |
| Deploy publisher flag | **Absent** — no `NOTIFICATION_OUTBOX_PUBLISHER` today |
| Recommended model | **Transactional enqueue + publisher** (not drain-only) |

### Why not drain-only

Drain-only would leave `publisher_present=true` with a forever-empty outbox: no production write path feeds `notification.outbox_events`. Inventory `creation_transition` already requires domain write + outbox insert. Messaging precedent: flip only after Phase B.

### Covered domain-write surfaces (must share enqueue once implemented)

| Surface | Mechanism | Today emits Kafka Notification\*? |
| --- | --- | --- |
| Kafka consumer | `INSERT` / `upsertNotificationByDedupeKey` into `notification.notifications` | No |
| HTTP `POST /internal/push-notification` | insert / upsert helpers | No (Redis realtime only) |
| HTTP `POST /notifications/seed-contract` | insert when `NOTIFICATION_E2E_SEED=1` | No |
| gRPC | read/list style — **no** notification create producer | N/A |
| Mark-read / preferences | UPDATE only | Out of create/sent scope unless separately specified |

Realtime Redis (`notification.created.realtime`) is **not** a substitute for the transactional outbox.

### Self-consume hazard

`notification-service` **subscribes** to `${ENV_PREFIX}.notification.events`. If Phase B publishes `NotificationCreatedV1` / `NotificationSentV1` onto that topic, consumer must **not** re-insert inbox rows for self-emitted analytics/audit events (filter by `event_type` / producer, or stop consuming own emit types). Matrix gate below.

### Payload contract open point (resolve in implementation slice — do not flip silently)

DDL + `docs/OUTBOX_*` say **proto EventEnvelope bytes**. Messaging remediated to UTF-8 JSON with an explicit DDL comment fix. Notification has **no** existing produce wire format. Implementation must pick one encoding, align DDL comment + publisher + enqueue serializer, and prove round-trip in mocked tests **before** inventory flip.

---

## Hard invariants (every case)

| ID | Invariant | Fail condition |
| --- | --- | --- |
| INV-1 | Publisher enabled **only** when `NOTIFICATION_OUTBOX_PUBLISHER === "1"` | unset / `"0"` / `"true"` enables publish |
| INV-2 | Claim uses `FOR UPDATE SKIP LOCKED`; row lock held through broker ack → DB mark → COMMIT | Commit/release lock before send |
| INV-3 | `published` advances only after broker ack **and** `UPDATE … WHERE published=false` returns `rowCount === 1` | mark without send; or `rowCount=0` counted published |
| INV-4 | Broker failure never marks published | send reject → mark called |
| INV-5 | Broker-ack / DB-ack failure leaves unpublished; duplicate produce allowed on retry | invent `published=true` on broker ack alone |
| INV-6 | Soft `retry_exhaustion` is **process-scoped**; restart resets (documented) | tick-local Map that cannot accumulate across ticks |
| INV-7 | Mocked Kafka only in unit tests | live produce in CI |
| INV-8 | Denominator stays 12; only notification flips | media+messaging stay executable; auth migration untouched |
| INV-9 | Covered create paths enqueue outbox in the **same** `PoolClient` TX as domain insert | bare `pool.query` domain write then separate outbox insert |
| INV-10 | `metadata`/`envelope` event id === `outbox.id`; drain does not mint a new id | new UUID on publish |
| INV-11 | Self-emitted notification.events types do not create inbox rows via consumer | consumer inserts for NotificationCreated/Sent |

---

## Publisher unit matrix (mocked Kafka) — Phase A drain

| Case | Name | Assert |
| ---: | --- | --- |
| S1 | happy_path_lock_through_ack | begin_claim → send → mark(rowCount=1) → commit; topic=`${ENV_PREFIX}.notification.events`, key=`aggregate_id` |
| S2 | empty_claim_noop | no send/mark |
| S3 | broker_unavailable | no mark; disposition `broker_unavailable` |
| S4 | restart_after_selection | abort before send; next tick publishes |
| S5 | broker_ack_without_db_ack | send OK, mark fails or rowCount≠1 → unpublished; retry may duplicate produce |
| S6 | duplicate_delivery | second successful path after orphan risk still mark-once-per-success-path |
| S7 | poison_event | no mark; disposition `poison_event` |
| S8 | retry_exhaustion_process_scoped | 3 failures across ticks via process Map → `retry_exhaustion`; no mark |
| S9 | ordering | never mark before send settles |
| S10 | batch_failure_full_rollback | row1 send+mark then row2 send fails → ROLLBACK; published=0; row1 may duplicate on retry |
| S11 | default_off_gate | unset/`0` ⇒ tick no-op + start returns null |
| S12 | claim_failure_rollback | beginClaim throws → rollback; no send |
| G3 | soft_retry_clear_after_commit | softFailureCounts cleared only after COMMIT succeeds |
| G5 | commit_failure_fail_closed | send+mark then COMMIT error → published=0, disposition `commit_failed`, soft failures retained |
| G6 | commit_failure_rolls_back_entire_batch | N sends+marks succeed, COMMIT fails → published=0; all rows retryable; soft state retained |

---

## Enqueue / same-TX matrix — Phase B (blocked until contracts frozen)

**Do not start Phase B until:**

1. Event semantics: create → `NotificationCreatedV1` only (not `NotificationSentV1` without a delivery transition).
2. Payload encoding: frozen from consumer decoder evidence (**UTF-8 JSON today** — see below).
3. Dedupe/upsert: enqueue only when `inserted=true`.

| Case | Name | Assert |
| ---: | --- | --- |
| E1 | create_inserts_outbox_same_tx | domain insert + outbox insert on one client; COMMIT once |
| E2 | domain_failure_zero_outbox | domain throw ⇒ ROLLBACK; outbox row count 0 |
| E3 | outbox_failure_rolls_domain | outbox throw ⇒ domain insert rolled back |
| E4 | commit_failure_fail_closed | request/path fails; no committed domain or outbox |
| E5 | event_id_matches_outbox_pk | frozen id in payload/envelope === `outbox.id` |
| E6 | payload_bytes_match_chosen_contract | stored BYTEA equals serializer output (UTF-8 JSON envelope once frozen) |
| E7 | partition_key_in_aggregate_id | `aggregate_id` = frozen Kafka key (recommend `notification_id`) |
| E8 | covered_http_internal_push | `/internal/push-notification` create path uses shared service |
| E9 | covered_kafka_consumer_create | consumer create/upsert(`inserted=true`) uses shared service |
| E10 | no_direct_kafka_produce_on_create | create paths never `producer.send` Notification\* |
| E11 | self_consume_safe | publishing Notification\* does not create a second inbox row |
| E12 | dedupe_hit_no_second_outbox | upsert `inserted=false` ⇒ zero outbox inserts / zero new event_id |
| E13 | event_semantics_created_not_sent | create without delivery ⇒ type `NotificationCreatedV1`, not `NotificationSentV1` |
| E14 | self_emit_recursion_guard | consume own `NotificationCreatedV1` ⇒ zero domain + zero outbox inserts |

### Consumer decoder freeze evidence (pre–Phase B)

`extractNotificationEnvelopeMeta` in `services/notification-service/src/kafka-consumer.ts` decodes **UTF-8 JSON** via `JSON.parse(buf.toString("utf8"))` and reads `metadata.event_id` / `event_type` / nested `payload`. It does **not** decode protobuf `EventEnvelope` today.

**Recommendation for Phase B:** store UTF-8 `JSON.stringify` bytes matching that envelope shape; update DDL comment from “proto bytes” to match (messaging precedent). Do not silently ship protobuf while the consumer is JSON-only.

---

## Inventory / readiness (post-flip only)

| Case | Assert |
| ---: | --- |
| I1 | `notification.outbox_events.publisher_present === true`, disposition null |
| I2 | implementation points at notification `publishOutbox` (+ enqueue) modules |
| I3 | `poll_batch.claim` includes `FOR UPDATE SKIP LOCKED` |
| I4 | counts exactly **8 / 1 / 3** |
| I5 | notification ∈ executable; ∉ blocked |
| I6 | blocked = records, shopping, trust |
| I7 | `auth.outbox_events` sole migration_pending |
| I8 | denominator 12; booking/social forbidden |

---

## Freeze / authorization

| Case | Assert |
| ---: | --- |
| F1 | `9efd0a03…` obsolete / archived after notification PREPARED; never authorize as execution target |
| F2 | new PREPARED SHA distinct; pins notification publisher + enqueue + tests |
| F3 | remediation targets exactly 3 remaining blocked |
| F4 | `execution_authorized=false`, `platform_pass=false`, `track_c_acceptance_pass=false` |

---

## Phase gate (do not claim 8/1/3 yet)

```text
Phase 0: inspect + matrix — DONE
Phase A: drain publisher + mocked S1–S12 / G3 / G5 / G6 — IN THIS SLICE
  → notification remains PUBLISHER_BLOCKED / publisher_present=false
  → PREPARED 9efd0a03… remains starting freeze reference
  → NOTIFICATION_OUTBOX_PUBLISHER default OFF

Phase B: BLOCKED until event semantics + UTF-8 JSON encoding + dedupe enqueue rules frozen
  → then transactional enqueue + E1–E14
  → then flip publisher_present and refreeze 8 / 1 / 3
  → stop for review; no Packet C / live auth
```

## Schema location (hard stop)

Production writes use `notification.*` on pool DB from `POSTGRES_URL_NOTIFICATION`.  
Outbox DDL is `notification.outbox_events` on the **same** database.  
Same-connection `BEGIN` can include domain + outbox — required for Phase B.

---

## Suggested test / module layout (implementation — not started)

```text
services/notification-service/src/outbox/publishOutbox.ts
services/notification-service/src/outbox/enqueueOutbox.ts
services/notification-service/src/application/notificationOutbox.ts   # create*WithOutbox
services/notification-service/tests/notification-outbox-publisher.test.ts
services/notification-service/tests/notification-message-outbox.test.ts  # same-TX + identity
```
