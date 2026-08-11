# Track C — `trust.outbox_events` publisher acceptance matrix

**Date:** 2026-08-11  
**Scope:** trust Phase A drain + Phase B writers wired · non-live · mocked Kafka · **STOP — no auth**  
**execution_authorized:** false  
**Starting freeze (immutable — never authorize / never execute live):** `7176a934cdf80152c57d9a336e57898983833c20b476637dbcf1a0f9b7ee312f`  
**Obsolete (permanently):** `7176a934…`, `e3ad155c…`, `380993598d3f2d419a54eec5fbb43e7562bdd5b30cc94f130d2a98d66806a7e9`, `ca9a35c7a97d660878837b46cc2c4a4828c4a1d3c1ca972b827bfc08ff349f46`, `9ece392aac4c9a1889287e0f6e233dc6a2b3e5666e9183f7a362cfeaa8d4c7da`, `9efd0a0333741909d6b4b75256973bbb4035a18709e69d4a6441d07487edb1e7`  
**Authoritative readiness (post-Phase-B writers):** **11 / 1 / 0**  
**Inventory SHA:** `71f9a0f494e4cdd3375fd6c8852647fbedd1a7571b97f8a7f24ad1fef5ae5d78`  
**Denominator SHA:** `1b614ba485e03bddf7bcf296c9bf0c89fee97b7013e9f034d8fdc7ea77079074`  
**Matrix SHA:** `e2908e28e468229b8609e9a726d0ae22875be6032d9bbdf0888510300dffae2b`  
**PREPARED SHA:** `10b427e549b6cddbfa5cbb2c0669906b5ad6fd318f9a47b45c075119707457e4` (not authorizable)  
**DDL:** `infra/db/03-trust-outbox.sql` (`published` boolean only — no lease / retry_count / DLQ)  
**Topic:** `${ENV_PREFIX}.trust.events`  
**Principal:** `CN=trust-service`  
**Kafka key:** `aggregate_id` (per DDL / outbox contract)  
**Mirror:** shopping/records/notification lock-through-ack publisher **including G7 ambiguous COMMIT reconciliation**  
**Do not batch:** do not authorize `7176a934…` · do not enable `SHOPPING_OUTBOX_PUBLISHER` or `TRUST_OUTBOX_PUBLISHER` · do not modify `auth.outbox_events` · do not prepare lifecycle acceptance · do not claim Track C PASS

**Frozen now:** P0 / P1 / P2 / P3 / P4 / P5. Phase B writers wired. Inventory flipped to **11 / 1 / 0**.

Expected readiness after Phase B writers (this freeze):

```text
LIFECYCLE_EXECUTABLE = 11
MIGRATION_PENDING    = 1   # auth.outbox_events unchanged
PUBLISHER_BLOCKED    = 0
TOTAL                = 12

remaining blocked:
  (none)

remaining migration_pending:
  auth.outbox_events
```

`PUBLISHER_BLOCKED = 0` is **not** Track C PASS. Auth stays `MIGRATION_PENDING`. `execution_authorized` stays false. `platform_pass` / `track_c_acceptance_pass` stay false.

---

## Inspection summary (pre-implementation — freeze this evidence)

| Fact | Evidence |
| --- | --- |
| Outbox table | `trust.outbox_events` on DB `trust` / schema `trust` (`infra/db/03-trust-outbox.sql`) |
| Status/ack column | `published BOOLEAN NOT NULL DEFAULT false` only |
| Payload column | `BYTEA`; DDL comment: **Serialized domain event (proto bytes); not JSON** |
| Event identity | `id UUID` = envelope `event_id`; publisher must not mint a new UUID on drain |
| Kafka key | `aggregate_id` |
| Topic | `${ENV_PREFIX}.trust.events` |
| Principal / ACL | `CN=trust-service` · WRITE that topic |
| Inventory | `publisher_present=true`; drain + enqueue present; disposition `INVENTORIED` |
| Domain tables (same DB) | `trust.listing_flags`, `trust.user_flags`, `trust.reviews`, `trust.reputation`, `trust.user_suspensions`, `trust.marketplace_*`, `trust.processed_events`, `trust.user_spam_score` via `pg` Pool `POSTGRES_URL_TRUST` (port **5442**) |
| Prisma | **None** — trust-service has no Prisma client |
| Same-connection TX on trust DB | **Possible** — `pool.connect()` + `BEGIN` can hold domain + `INSERT trust.outbox_events` |
| Same-connection TX with booking/auth | **Impossible** — `bookingReadPool` / `authReadPool` / `BOOKING_HTTP` are other DBs / HTTP |
| `trust.outbox_events` INSERT sites | listing-flag submit + peer-review helpers (`insertListingFlagSubmittedWithOutbox` / `insertPeerReviewCreatedWithOutbox`) |
| Kafka **producer** | Phase A drain only (`publishOutbox.ts`); `TRUST_OUTBOX_PUBLISHER` default OFF; writers enqueue BYTEA, never `producer.send` |
| Kafka **consumer** | user-lifecycle only (`startTrustUserLifecycleConsumer` → `userLifecycleV1Topic()`); does not consume `${ENV_PREFIX}.trust.events` |
| Direct Kafka of trust-domain events | **None** |
| Deploy flag for trust.outbox | `TRUST_OUTBOX_PUBLISHER` must be exactly `"1"` (default **OFF**) |
| OCH surface | `initOchOutboxSurfaceUnsupported()` in HTTP app — expected until a publisher exists |
| Tests | vitest already present (`services/trust-service/tests/`) |
| Recommended model | **Transactional enqueue on trust DB + new drain of `trust.outbox_events`** (not drain-only) |

### Why not drain-only

Drain-only would flip `publisher_present=true` with a forever-empty `trust.outbox_events`. Inventory `creation_transition` already requires trust domain write + INSERT `trust.outbox_events` in the same transaction. Records/shopping/notification/messaging precedent: flip only after Phase B.

### Why `pool.query('BEGIN')` is forbidden

`services/trust-service/src/db.ts` wraps **`pool.query` only** with a concurrency guard. `pool.connect()` is unwrapped. `BEGIN` via `pool.query` does not pin a client, so a later `pool.query` INSERT can land on a different connection. Phase B must use `pool.connect()` → `client.query('BEGIN')` → domain + outbox → `COMMIT` / `ROLLBACK` → `client.release()`. Same shopping lesson.

### Proto vs runtime (do not silently invent writers)

`proto/events/trust.proto` defines:

| Proto message | Runtime writer today |
| --- | --- |
| `ListingFlaggedV1` | HTTP `POST /flag-listing`, HTTP `POST /report-abuse` (listing), gRPC `FlagListing`, gRPC `ReportAbuse` (listing) → `INSERT trust.listing_flags` status=`pending` |
| `ListingUnflaggedV1` | **None** — no unflag / status-update path |
| `ReviewCreatedV1` | HTTP `POST /peer-review`, gRPC `SubmitReview`, gRPC `SubmitPeerReview` → `INSERT trust.reviews` (`target_type='user'`) |
| `ReputationUpdatedV1` | **None** in TS. Score formula lives in `02-trust-scoring.sql` trigger on `trust.reputation` counters; nothing in trust-service updates those counters |
| `SellerVerifiedV1` | **None** |
| `UserReputationUpdatedV1` | **None** (overlaps `ReputationUpdatedV1`) |

Runtime writers **without** a trust.proto message:

| Mutation | Table | Proto |
| --- | --- | --- |
| HTTP/gRPC report-abuse `user` | `trust.user_flags` | **no message** (schema comments mention `user.warned` / `user.suspended` — not in `trust.proto`) |
| HTTP `POST /marketplace-feedback` | `trust.marketplace_feedback` | **no message** |
| E2E seed `TRUST_E2E_SEED=1` | `marketplace_transactions` + `marketplace_feedback` | **no message** |

DDL comments that are **not implemented** (do not treat as acceptance evidence):

- `01-trust-schema.sql`: “When resolved as confirmed, Trust emits listing.flagged” — flags are inserted `pending`; there is no resolve endpoint.
- `04-trust-processed-events.sql`: “Trust consumes `dev.booking.events`” — no booking consumer in `server.ts`; `processed_events` is used only by the user-lifecycle claimer.
- `05-trust-spam-score.sql`: “emit UserSuspendedV1” — `UserSuspendedV1` is not in `trust.proto`; no spam consumer.
- `services/trust-service/README.md`: “Emit Kafka on flag/review/reputation changes” — no producer exists.

### ReviewCreatedV1 field gap (must freeze before Phase B)

```text
proto ReviewCreatedV1:
  review_id, listing_id, order_id, reviewer_id, reviewee_id, rating, created_at

runtime trust.reviews:
  id, booking_id, reviewer_id, target_type='user', target_id, rating, comment, created_at
```

`listing_id` is not stored. `order_id` is not stored. `booking_id` is the only correlation id. Do not silently map `booking_id` → `order_id` without an explicit P2 freeze.

### Covered domain-write surfaces (candidate — not frozen)

| Surface | Mechanism today | Kafka today | Same trust TX today |
| --- | --- | --- | --- |
| HTTP `POST /flag-listing` | `pool.query` INSERT `trust.listing_flags` | No | **No TX** |
| HTTP `POST /report-abuse` listing | `pool.query` INSERT `trust.listing_flags` | No | **No TX** |
| HTTP `POST /report-abuse` user | `pool.query` INSERT `trust.user_flags` | No | **No TX** |
| HTTP `POST /peer-review` | optional `BOOKING_HTTP` gate, then `pool.query` INSERT `trust.reviews` | No | **No TX**; gate is remote HTTP **before** SQL |
| gRPC `FlagListing` | `pool.query` INSERT `trust.listing_flags` | No | **No TX** |
| gRPC `ReportAbuse` listing | `pool.query` INSERT `trust.listing_flags` | No | **No TX** |
| gRPC `ReportAbuse` user | `pool.query` INSERT `trust.user_flags` | No | **No TX** |
| gRPC `SubmitReview` | optional booking gate, then INSERT `trust.reviews` | No | **No TX** |
| gRPC `SubmitPeerReview` | optional booking gate, then INSERT `trust.reviews` | No | **No TX** |
| HTTP marketplace-feedback POST | SELECT txn then INSERT feedback (two `pool.query`s) | No | **No TX** |
| HTTP marketplace seed | loop of two INSERTs | No | **No TX** |
| GET reputation / user-reviews / public resolve | SELECT only | No | N/A |
| gRPC `GetReputation` | SELECT only | No | N/A |
| user-lifecycle consumer | claim on `trust.processed_events`; onUserAccountDeleted no-op | consume only | N/A |

### Self-consume hazard

**None in-process for `${ENV_PREFIX}.trust.events`.** trust-service consumes user-lifecycle, not trust.events. Recursion guard not required unless a trust.events consumer is added in this slice (it must not be).

### Frozen contracts (2026-08-11)

**P0 OWNER ISOLATION = FROZEN.** `trust.outbox_events` owns trust-domain events only. Topic `${ENV_PREFIX}.trust.events`. Do not INSERT into any other outbox. Do not drain listings/shopping/auth outbox as trust evidence. `auth.outbox_events` stays `MIGRATION_PENDING`. Shopping stays default-off.

**P1 PAYLOAD = FROZEN.** stored BYTEA = trust domain protobuf. Kafka value = `EventEnvelope` wrapping that BYTEA. Envelope: `event_id=outbox.id`, `type=outbox.type`, `version=outbox.version`, `source=trust-service`, `entity_id=outbox.aggregate_id`, `timestamp=outbox.created_at`, `payload=exact stored_bytea`. Drain never mints `event_id` or timestamp (`randomUUID` / `new Date()` forbidden in drain wrap). `keepCase` must be passed to `Root#loadSync` (records/shopping trap).

**P2 EVENT COVERAGE = FROZEN (first enqueue slice; HTTP/gRPC still unwired).**

| Mutation | Event | aggregate_id |
| --- | --- | --- |
| listing-flag create (`pending`) | `ListingFlagSubmittedV1` | `listing_id` |
| peer-review INSERT | `PeerReviewCreatedV1` | `review_id` (`booking_id` stays `booking_id`; `target_id` → `reviewee_id`) |

| Item | Disposition |
| --- | --- |
| `ListingFlaggedV1` | resolve/confirmed only; enqueue helper **rejects** this type |
| `ReviewCreatedV1` | reserved for real listing/order review identity; enqueue helper **rejects** this type |
| `ListingUnflaggedV1` | **NOT_USED** |
| `ReputationUpdatedV1` / `UserReputationUpdatedV1` | **OUT_OF_SCOPE** |
| `SellerVerifiedV1` | **OUT_OF_SCOPE** |
| user_flags / marketplace / spam | **OUT_OF_SCOPE** |

Contract: `docs/superpowers/plans/2026-08-11-track-c-trust-phase-b-event-contract.md`.

**P3 TRANSACTION BOUNDARIES = FROZEN.** `pool.connect()`; one `PoolClient`; `BEGIN` → domain/outbox work → `COMMIT`. No distributed atomicity with booking or auth. `BOOKING_HTTP` / auth reads stay **before** `BEGIN`. Duplicate `23505` remains 409 with zero outbox.

**P4 IDENTITY = FROZEN.** `event_id` minted once before enqueue; `outbox.id = event_id`; drain reuses id; `created_at` frozen at enqueue and reused as envelope timestamp.

**P5 DIRECT PRODUCE = FROZEN.** No parallel `trust.events` producer. Publisher drains `trust.outbox_events` only.

---

## Invariants (fail closed)

| ID | Invariant | Forbidden |
| ---: | --- | --- |
| INV-1 | Denominator stays 12 | booking/social rows |
| INV-2 | `auth.outbox_events` remains sole MIGRATION_PENDING | moving auth to blocked/executable |
| INV-3 | records/media/messaging/notification/shopping stay executable and default-off | enabling their publisher env flags |
| INV-4 | `SHOPPING_OUTBOX_PUBLISHER` remains default OFF | enabling shopping live/default-on |
| INV-5 | New drain reads `trust.outbox_events` only | pointing trust publisher at any other outbox |
| INV-6 | `TRUST_OUTBOX_PUBLISHER` default OFF (`=== "1"` to enable) | default-on |
| INV-7 | trust domain + trust outbox share one `pg` client TX | `pool.query('BEGIN')`; second trust pool for enqueue |
| INV-8 | Drain **and** enqueue COMMIT throw is ambiguous until G7 fresh-connection SELECT | treating COMMIT throw as unpublished / rolled-back proof |
| INV-9 | Drain does not mint event ids | `randomUUID()` in trust publishOutbox |
| INV-10 | No auth / shopping / listings work in this owner slice | inventory rows other than trust change |
| INV-11 | No JSON payload if proto freeze chosen | `JSON.stringify` as trust.outbox BYTEA |
| INV-12 | Booking/auth pools stay out of the enqueue TX | `BEGIN` spanning `bookingReadPool` / `authReadPool` |
| INV-13 | Do not authorize `7176a934…` | treating shopping PREPARED as an execution target |
| INV-14 | Do not claim Track C PASS after a later 11/1/0 flip | `platform_pass` / `track_c_acceptance_pass` true while auth pending |

---

## Publisher unit matrix (mocked Kafka) — Phase A drain

| Case | Name | Assert |
| ---: | --- | --- |
| S1 | happy_path_lock_through_ack | begin_claim → send → mark(rowCount=1) → commit; topic=`${ENV_PREFIX}.trust.events`; key=`aggregate_id` |
| S2 | empty_claim_noop | no send/mark |
| S3 | broker_unavailable | no mark; disposition `broker_unavailable` |
| S4 | restart_after_selection | abort before send; next tick publishes |
| S5 | broker_ack_without_db_ack | send OK, mark fails or rowCount≠1 → unpublished |
| S6 | duplicate_delivery | second success path still mark-once-per-success-path |
| S7 | poison_event | no mark; disposition `poison_event` |
| S8 | retry_exhaustion_process_scoped | 3 failures across ticks → `retry_exhaustion` |
| S9 | ordering | never mark before send settles |
| S10 | batch_failure_full_rollback | row2 send fails → ROLLBACK; published=0 |
| S11 | default_off_gate | unset/`0` ⇒ tick no-op + start returns null |
| S12 | claim_failure_rollback | beginClaim throws → rollback; no send |
| G3 | soft_retry_clear_after_commit | cleared only after COMMIT succeeds |
| G5 | commit_throw_without_reconcile | `unknown_pending_reconciliation`; unknowns>0 |
| G6 | commit_throw_batch | rollback invoked; not unpublished proof |
| G7 | ambiguous_commit_reconciliation | all false / all true / mixed / unavailable (notification G7) |
| X1 | drain SQL targets `trust.outbox_events` | no other `*.outbox_events` / `lease_outbox_batch` in new publisher |
| X2 | envelope_identity_and_timestamp_preserved | `event_id/type/version/source/entity_id/timestamp` map from row; payload bytes unchanged |

---

## Enqueue / same-TX matrix — Phase B (GO only after Phase A green **and** P2 freeze)

| Case | Name | Assert |
| ---: | --- | --- |
| E1 | domain+outbox same trust TX | `BEGIN` → domain INSERT → outbox INSERT → `COMMIT` once on one `PoolClient` |
| E2 | domain failure ⇒ zero outbox | ROLLBACK; outbox count 0 |
| E3 | outbox failure rolls domain | domain insert rolled back |
| E4 | commit_throw_ambiguous | COMMIT throws ⇒ `UNKNOWN_PENDING_RECONCILIATION`; fresh connection required. Reconcile using frozen `event_id` plus domain identity: outbox exists **and** domain mutation exists ⇒ `COMMIT_PERSISTED_RECOVERED`; neither exists ⇒ `COMMIT_NOT_PERSISTED`; exactly one exists ⇒ `INVARIANT_VIOLATION`; reconciliation unavailable ⇒ `UNKNOWN_PENDING_RECONCILIATION`. `unknowns != 0` blocks acceptance |

### HTTP/gRPC G7 response freeze (before writer wiring)

| Enqueue outcome | HTTP | gRPC | Rule |
| --- | ---: | --- | --- |
| `committed` | **201** | `OK` | success body (`flag_id` / `review_id`) |
| `COMMIT_PERSISTED_RECOVERED` | **201** | `OK` | success; use pre-COMMIT work value; never treat as failure |
| `COMMIT_NOT_PERSISTED` | **503** `COMMIT_NOT_PERSISTED` | `UNAVAILABLE` | retryable; **never** 201/OK |
| `INVARIANT_VIOLATION` | **500** `INVARIANT_VIOLATION` | `INTERNAL` | hard failure; **never** 201/OK |
| `UNKNOWN_PENDING_RECONCILIATION` | **500** `UNKNOWN_PENDING_RECONCILIATION` | `UNKNOWN` | fail closed; **never** claim success |
| Postgres `23505` | **409** | `ALREADY_EXISTS` | zero outbox (unchanged) |
| E5 | event_id matches outbox pk | envelope event_id === `outbox.id` |
| E6 | payload bytes match frozen encoding | stored BYTEA equals serializer output |
| E7 | partition key in aggregate_id | listing flag=`listing_id`; review=`review_id` (if frozen) |
| E8 | covered HTTP listing flag | `/flag-listing` and `/report-abuse` listing use shared enqueue helper |
| E9 | covered HTTP peer-review | `/peer-review` uses shared TX + enqueue; booking gate remains pre-`BEGIN` |
| E10 | covered gRPC listing flag | `FlagListing` / `ReportAbuse` listing use same helpers |
| E11 | covered gRPC review | `SubmitReview` / `SubmitPeerReview` use same helpers |
| E12 | no direct Kafka for covered types | write paths never `producer.send` ListingFlagged/ReviewCreated |
| E13 | event-type semantics | frozen mapping only (no user_flags / marketplace / reputation / unflag) |
| E14 | kafka_value wraps stored payload | EventEnvelope(stored_bytea); drain does not remint id |
| E15 | 23505 duplicate ⇒ zero outbox | unique listing/reporter or review constraint → 409; outbox count 0 |
| E16 | `pool.connect` not `pool.query` BEGIN | enqueue helper takes `PoolClient`; no `pool.query('BEGIN')` |

---

## Phase A freeze (this slice — no inventory flip)

| Case | Assert |
| ---: | --- |
| A1 | `trust.outbox_events.publisher_present === false` |
| A2 | counts remain **10 / 1 / 1** |
| A3 | blocked = `trust.outbox_events` only |
| A4 | `TRUST_OUTBOX_PUBLISHER` default OFF |
| A5 | `execution_authorized=false`, `platform_pass=false`, `track_c_acceptance_pass=false` |

---

## Inventory / readiness (post-flip only — Phase B, not this slice)

| Case | Assert |
| ---: | --- |
| I1 | `trust.outbox_events.publisher_present === true`, disposition null |
| I2 | implementation points at trust `publishOutbox` (+ enqueue) modules |
| I3 | `poll_batch.claim` includes `FOR UPDATE SKIP LOCKED` |
| I4 | counts exactly **11 / 1 / 0** |
| I5 | trust ∈ executable; ∉ blocked |
| I6 | blocked = empty |
| I7 | `auth.outbox_events` sole migration_pending |
| I8 | denominator 12; booking/social forbidden |
| I9 | records/notification/messaging/media/shopping remain executable and default-off |
| I10 | `execution_authorized=false`, `platform_pass=false`, `track_c_acceptance_pass=false` |

---

## Freeze / authorization

| Case | Assert |
| ---: | --- |
| F1 | `7176a934…` never authorized as execution target |
| F2 | `38099359…`, `ca9a35c7…`, `9ece392a…`, `9efd0a03…` remain obsolete |
| F3 | new PREPARED SHA distinct; pins trust publisher + enqueue + tests |
| F4 | remediation target exactly 0 remaining blocked; auth still pending |
| F5 | `execution_authorized=false`, `platform_pass=false`, `track_c_acceptance_pass=false` |

---

## Phase gate

```text
Phase 0: inspect + matrix — DONE
  → PREPARED 7176a934… starting freeze (not authorizable)
  → P0/P1/P3/P4/P5 FROZEN
  → P2 UNRESOLVED

Phase A: DONE after P0/P1/P3/P4/P5 freeze (P2 does not gate)
  → drain + EventEnvelope wrap including timestamp=created_at (X2 first)
  → TRUST_OUTBOX_PUBLISHER default OFF
  → 25/25 publisher tests
  → publisher_present stays false
  → readiness stays 10 / 1 / 1
  → no inventory flip

Phase B proto + enqueue API: DONE
  → ListingFlagSubmittedV1 + PeerReviewCreatedV1 applied
  → PoolClient enqueue + E4/G7 tests green

Phase B writer wiring: DONE
  → seven frozen HTTP/gRPC paths call helpers
  → BOOKING_HTTP stays before BEGIN
  → G7 HTTP/gRPC map frozen
  → trust.publisher_present = true → **11 / 1 / 0**
  → STOP; no auth; no Packet C / live auth
  → TRUST_OUTBOX_PUBLISHER default OFF
  → execution_authorized=false, platform_pass=false, track_c_acceptance_pass=false
```

## Schema location (hard stop)

Production trust writes use `pg` Pool `POSTGRES_URL_TRUST` (trust DB, schema `trust`, port **5442**).  
Outbox DDL is `trust.outbox_events` on the **same** database.  
Same client `BEGIN` can include domain SQL + outbox INSERT — required for Phase B.  
Do not introduce a second trust pool for enqueue that cannot share the domain TX.  
Do not use Prisma `$transaction` (no Prisma in trust-service).  
Do not open a booking or auth connection for `trust.outbox_events` enqueue.  
Do not `BEGIN` via guarded `pool.query`.

---

## Suggested test / module layout (Phase A drain + Phase B enqueue API)

```text
services/trust-service/src/trustKafkaEvents.ts
services/trust-service/src/outbox/publishOutbox.ts
services/trust-service/src/outbox/enqueueOutbox.ts
services/trust-service/src/outbox/trustEnqueueTx.ts
services/trust-service/src/application/trustOutbox.ts
services/trust-service/tests/trust-outbox-publisher.test.ts
services/trust-service/tests/trust-proto-roundtrip.test.ts
services/trust-service/tests/trust-message-outbox.test.ts
```

Not wired until writer GO:

```text
services/trust-service/src/http-server.ts
services/trust-service/src/grpc-server.ts
```

Leave in place (not this owner):

```text
services/trust-service/src/user-lifecycle-consumer.ts
services/trust-service/src/marketplace-feedback.ts
infra/db/02-trust-scoring.sql
```
