# Track C — `shopping.outbox_events` publisher acceptance matrix

**Date:** 2026-08-10  
**Scope:** shopping only · non-live · mocked Kafka  
**execution_authorized:** false  
**Starting freeze (immutable — never authorize / never execute live):** `380993598d3f2d419a54eec5fbb43e7562bdd5b30cc94f130d2a98d66806a7e9`  
**Post-Phase-B freeze:** `7176a934cdf80152c57d9a336e57898983833c20b476637dbcf1a0f9b7ee312f`  
**Obsolete (permanently):** `380993598d3f2d419a54eec5fbb43e7562bdd5b30cc94f130d2a98d66806a7e9`, `ca9a35c7a97d660878837b46cc2c4a4828c4a1d3c1ca972b827bfc08ff349f46`, `9ece392aac4c9a1889287e0f6e233dc6a2b3e5666e9183f7a362cfeaa8d4c7da`, `9efd0a0333741909d6b4b75256973bbb4035a18709e69d4a6441d07487edb1e7`  
**Starting readiness:** **9 / 1 / 2** (post-Phase-B freeze: **10 / 1 / 1**)  
**DDL:** `infra/db/01-shopping-outbox.sql` (`published` boolean only — no lease / retry_count / DLQ)  
**Topic:** `${ENV_PREFIX}.shopping.events`  
**Principal:** `CN=shopping-service`  
**Kafka key:** `aggregate_id` (per DDL / outbox contract)  
**Mirror:** records/notification lock-through-ack publisher **including G7 ambiguous COMMIT reconciliation**  
**Do not batch:** trust stays blocked · do not modify `auth.outbox_events` · do not relocate SaleCompleted off `listings.outbox_events`

Expected readiness **only after** Phase A drain **and** Phase B transactional enqueue both pass:

```text
LIFECYCLE_EXECUTABLE = 10
MIGRATION_PENDING    = 1   # auth.outbox_events unchanged
PUBLISHER_BLOCKED    = 1
TOTAL                = 12

remaining blocked:
  trust.outbox_events
```

---

## Inspection summary (pre-implementation — freeze this evidence)

| Fact | Evidence |
| --- | --- |
| Outbox table | `shopping.outbox_events` on DB `shopping` / schema `shopping` (`01-shopping-outbox.sql`) |
| Status/ack column | `published BOOLEAN NOT NULL DEFAULT false` only |
| Payload column | `BYTEA`; DDL comment: **Serialized domain event (proto bytes); not JSON** |
| Event identity | `id UUID` = envelope `event_id` |
| Topic | `${ENV_PREFIX}.shopping.events` |
| Principal / ACL | `CN=shopping-service` · WRITE that topic |
| Domain tables (same DB) | `shopping.orders`, `shopping.shopping_cart`, `shopping.purchase_history`, `shopping.shipments`, `shopping.watchlist`, `shopping.wishlist`, … via `pg` Pool `POSTGRES_URL_SHOPPING` (port 5436) |
| Prisma | Schema exists; **runtime writes are raw SQL on `pool`**, not `prisma.$transaction` |
| Same-connection TX on shopping DB | **Possible** — `pool.connect()` + `BEGIN` can hold domain + `INSERT shopping.outbox_events` |
| Same-connection TX with SaleCompleted | **Impossible** — SaleCompleted writes `listings.outbox_events` on the listings DB via `listingsPool` |
| `shopping.outbox_events` INSERT sites | **None** in repository |
| Existing SaleCompleted enqueue | `services/shopping-service/src/lib/sale-completed-emitter.ts` → `INSERT INTO listings.outbox_events` (`type='SaleCompleted'`, UTF-8 JSON BYTEA) |
| Existing SaleCompleted drain | `sale-completed-outbox-drain.ts` leases **`listings.outbox_events`**, publishes `${ENV_PREFIX}.listing.events`, default **ON** unless `PHASE34_SALE_COMPLETED_OUTBOX_DRAIN=0` |
| Direct Kafka (not outbox) | gRPC `AddToCart` → topic `shopping-cart`; gRPC `AddPurchase` → topic `purchases` (JSON, after SQL, not in TX) |
| Deploy flag for shopping.outbox | **Absent** — no `SHOPPING_OUTBOX_PUBLISHER` |
| Recommended model | **Transactional enqueue on shopping DB + new drain of `shopping.outbox_events`** (not drain-only; not SaleCompleted relocation) |

### Why not drain-only

Drain-only would flip `publisher_present=true` with a forever-empty `shopping.outbox_events`. Inventory `creation_transition` already requires shopping domain write + INSERT `shopping.outbox_events`. Records/notification/messaging precedent: flip only after Phase B.

### Why not reuse the SaleCompleted drain

`listings.outbox_events` is already Track C **LIFECYCLE_EXECUTABLE**. SaleCompleted is a listings-owner event (lease columns, DLQ, `source_sha`, intelligence normalize, topic `${ENV_PREFIX}.listing.events`). Wiring `shopping.outbox_events` by redirecting SaleCompleted would:

1. Dual-count the same settlement across two denominator rows, or
2. Strip listings of a live producer it already claims.

**Hard rule for this slice:** do not INSERT SaleCompleted into `shopping.outbox_events`. Do not disable or rewrite the Phase 34 listings drain as the shopping publisher.

### Covered domain-write surfaces (candidate — not frozen)

Shopping proto (`proto/events/shopping.proto`) defines Cart / Order / Watchlist / Shipment events. Runtime writes today:

| Surface | Mechanism today | Kafka today | Same shopping TX today |
| --- | --- | --- | --- |
| HTTP `POST /cart/checkout` order INSERT | `pool.query` INSERT `shopping.orders` (no BEGIN) | No shopping.events | **No TX** |
| HTTP checkout payment UPDATE | separate `pool.query` UPDATE `shopping.orders` | No | **No TX** |
| HTTP checkout shipment INSERT | separate `pool.query` INSERT `shopping.shipments` | notification push only | **No TX** |
| HTTP checkout purchase_history | separate `pool.query` INSERT | No | **No TX** |
| HTTP checkout listings SOLD | `listingsPool.query` UPDATE `listings.listings` | then SaleCompleted on listings outbox | **other DB** |
| HTTP cart add/update/delete | `pool.query` on `shopping.shopping_cart` | No | **No TX** |
| HTTP watchlist add/delete | `pool.query` | No | **No TX** |
| HTTP wishlist / recently-viewed / search-history | `pool.query` | No | N/A (no shopping.proto messages) |
| HTTP returns | INSERT `shopping.returns` | No | **No TX** |
| gRPC `AddToCart` | `pool.query` then `producer.send` | topic `shopping-cart` JSON | send **after** SQL |
| gRPC `AddPurchase` | `pool.query` then `producer.send` | topic `purchases` JSON | send **after** SQL |
| gRPC watchlist / wishlist / recently-viewed | `pool.query` | No | **No TX** |

`GET /orders` is read-only.

### Self-consume hazard

**None in-process for `${ENV_PREFIX}.shopping.events`.** shopping-service does not consume that topic. SaleCompleted drain consumes **listings** outbox, not shopping outbox. Recursion guard not required unless a shopping.events consumer is added in this slice (it must not be).

### Frozen contracts (2026-08-10)

**P0 OWNER ISOLATION = FROZEN.** `shopping.outbox_events` owns shopping-domain events only. SaleCompleted remains `listings.outbox_events` / `${ENV_PREFIX}.listing.events`; existing emitter/drain unchanged. Forbidden: SaleCompleted INSERT into shopping.outbox; repointing listings drain; treating listings outbox as shopping publisher evidence.

**P1 PAYLOAD = FROZEN.** stored BYTEA = shopping domain protobuf. Kafka value = `EventEnvelope` wrapping that BYTEA. Envelope: `event_id=outbox.id`, `type=outbox.type`, `version=outbox.version`, `source=shopping-service`, `entity_id=outbox.aggregate_id`, `timestamp=outbox.created_at`, `payload=exact stored_bytea`. Drain never mints `event_id` or timestamp (`randomUUID` / `new Date()` forbidden in drain wrap).

**P2 EVENT COVERAGE = FROZEN_WITH_EXPLICIT_SEMANTICS.**

| Mutation | Event | aggregate_id | Notes |
| --- | --- | --- | --- |
| HTTP cart add/update/delete, gRPC AddToCart | `CartUpdatedV1` | `user_id` | No action field — does **not** prove add vs update vs delete |
| HTTP watchlist add/remove, matching gRPC | `WatchlistChangedV1` | `user_id` | `action` = added \| removed |
| checkout order INSERT | `OrderCreatedV1` | `order_id` | |
| checkout payment paid | `OrderPaidV1` | `order_id` | |
| checkout shipment INSERT | `ShipmentCreatedV1` | `shipment_id` | |

`OrderPlacedV1` **not used** this slice (overlapping order-creation semantics).  
gRPC `AddPurchase` **not covered** — do not map to `OrderPlacedV1`; `purchases` producer is existing debt, not acceptance evidence.  
wishlist / recently-viewed / search-history / returns: out of scope (no proto).

**P3 TRANSACTION BOUNDARIES = FROZEN.** No distributed checkout atomicity. Each covered shopping mutation pairs domain write + `INSERT shopping.outbox_events` on the **same** `PoolClient` TX. Listings SOLD + SaleCompleted remain a separate listings-DB TX.

**P4 IDENTITY = FROZEN.** `event_id` minted once before enqueue; `outbox.id = event_id`; drain reuses id; `created_at` frozen at enqueue and reused as envelope timestamp.

**P5 DIRECT PRODUCE = FROZEN.** Once Phase B covers a mutation, no `producer.send` substitute for that semantic. gRPC AddToCart converts to CartUpdatedV1 outbox and drops `shopping-cart` produce. AddPurchase stays out of scope; do not remove/replace `purchases` produce until a canonical event exists.

---

## Invariants (fail closed)

| ID | Invariant | Forbidden |
| ---: | --- | --- |
| INV-1 | Denominator stays 12 | booking/social rows |
| INV-2 | `auth.outbox_events` remains sole MIGRATION_PENDING | moving auth to blocked/executable |
| INV-3 | records/media/messaging/notification stay executable and default-off | enabling their publisher env flags |
| INV-4 | SaleCompleted stays on `listings.outbox_events` | INSERT SaleCompleted into `shopping.outbox_events` |
| INV-5 | New drain reads `shopping.outbox_events` only | pointing shopping publisher at listings |
| INV-6 | Phase 34 listings drain remains independent | using `PHASE34_SALE_COMPLETED_OUTBOX_DRAIN` as shopping.outbox gate |
| INV-7 | `SHOPPING_OUTBOX_PUBLISHER` default OFF (`=== "1"` to enable) | default-on |
| INV-8 | shopping domain + shopping outbox share one `pg` client TX | second shopping pool for enqueue |
| INV-9 | COMMIT throw is ambiguous until G7 fresh-connection SELECT | treating COMMIT throw as unpublished |
| INV-10 | Drain does not mint event ids | `randomUUID()` in shopping publishOutbox |
| INV-11 | No trust / auth work in this owner slice | inventory rows other than shopping change |
| INV-12 | No JSON payload if proto freeze chosen | `JSON.stringify` as shopping.outbox BYTEA |

---

## Publisher unit matrix (mocked Kafka) — Phase A drain

| Case | Name | Assert |
| ---: | --- | --- |
| S1 | happy_path_lock_through_ack | begin_claim → send → mark(rowCount=1) → commit; topic=`${ENV_PREFIX}.shopping.events`; key=`aggregate_id` |
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
| X1 | drain SQL targets `shopping.outbox_events` | no `listings.outbox_events` / `lease_outbox_batch` in new publisher |
| X2 | envelope_identity_and_timestamp_preserved | `event_id/type/version/source/entity_id/timestamp` map from row; payload bytes unchanged |

---

## Enqueue / same-TX matrix — Phase B (GO only after Phase A green)

| Case | Name | Assert |
| ---: | --- | --- |
| E1 | domain+outbox same shopping TX | `BEGIN` → domain INSERT/UPDATE → outbox INSERT → `COMMIT` once |
| E2 | domain failure ⇒ zero outbox | ROLLBACK; outbox count 0 |
| E3 | outbox failure rolls domain | domain insert rolled back |
| E4 | commit failure fail-closed | request fails; no committed domain or outbox |
| E5 | event_id matches outbox pk | envelope event_id === `outbox.id` |
| E6 | payload bytes match frozen encoding | stored BYTEA equals serializer output |
| E7 | partition key in aggregate_id | cart/watchlist=`user_id`; order/payment=`order_id`; shipment=`shipment_id` |
| E8 | covered HTTP cart | add/update/delete use shared enqueue helper |
| E9 | covered HTTP checkout | order/paid/shipment (frozen set) use shared TX + enqueue |
| E10 | covered HTTP watchlist | add/remove use shared helper if WatchlistChangedV1 frozen in |
| E11 | covered gRPC | AddToCart / matching writes use same helpers; no leftover `producer.send` for covered types |
| E12 | no direct Kafka for covered types | write paths never `producer.send` Cart/Order/Watchlist/Shipment |
| E13 | event-type semantics | frozen mapping only (no SaleCompleted on this table) |
| E14 | kafka_value wraps stored payload | if proto: EventEnvelope(stored_bytea); drain does not remint id |
| E15 | SaleCompleted path unchanged | `emitSaleCompletedFromCheckout` still inserts `listings.outbox_events` only |

---

## Inventory / readiness (post-flip only)

| Case | Assert |
| ---: | --- |
| I1 | `shopping.outbox_events.publisher_present === true`, disposition null |
| I2 | implementation points at shopping `publishOutbox` (+ enqueue) modules, **not** sale-completed-outbox-drain |
| I3 | `poll_batch.claim` includes `FOR UPDATE SKIP LOCKED` |
| I4 | counts exactly **10 / 1 / 1** |
| I5 | shopping ∈ executable; ∉ blocked |
| I6 | blocked = `trust.outbox_events` only |
| I7 | `auth.outbox_events` sole migration_pending |
| I8 | denominator 12; booking/social forbidden |
| I9 | records/notification/messaging/media remain executable and default-off |
| I10 | listings SaleCompleted drain annotation unchanged |

---

## Freeze / authorization

| Case | Assert |
| ---: | --- |
| F1 | `38099359…` obsolete / archived after shopping PREPARED; never authorize as execution target |
| F2 | `ca9a35c7…`, `9ece392a…`, `9efd0a03…` remain obsolete |
| F3 | new PREPARED SHA distinct; pins shopping publisher + enqueue + tests |
| F4 | remediation target exactly 1 remaining blocked (`trust.outbox_events`) |
| F5 | `execution_authorized=false`, `platform_pass=false`, `track_c_acceptance_pass=false` |

---

## Phase gate

```text
Phase 0: inspect + matrix — DONE
  → PREPARED 38099359… starting freeze (now obsolete; never authorize)
  → P0/P1/P2/P3/P4/P5 FROZEN

Phase A: DONE non-live
  → drain + EventEnvelope wrap including timestamp=created_at (X2)
  → SHOPPING_OUTBOX_PUBLISHER default OFF
  → 25/25 publisher tests

Phase B: DONE non-live
  → transactional enqueue on frozen P2 surfaces
  → flipped shopping.publisher_present = true
  → refrozen 10 / 1 / 1
  → remaining blocked = trust.outbox_events
  → STOP; no trust; no Packet C / live auth
  → execution_authorized=false, platform_pass=false, track_c_acceptance_pass=false
```

## Schema location (hard stop)

Production shopping writes use `pg` Pool `POSTGRES_URL_SHOPPING` (shopping DB, schema `shopping`).  
Outbox DDL is `shopping.outbox_events` on the **same** database.  
Same client `BEGIN` can include domain SQL + outbox INSERT — required for Phase B.  
Do not introduce a second shopping pool for enqueue that cannot share the domain TX.  
Do not use Prisma `$transaction` unless runtime writes are first migrated onto Prisma (they are not today).  
Do not open a listings connection for `shopping.outbox_events` enqueue.

---

## Suggested test / module layout (Phase A implemented; Phase B not started)

```text
services/shopping-service/src/shoppingKafkaEvents.ts
services/shopping-service/src/outbox/publishOutbox.ts
services/shopping-service/src/outbox/enqueueOutbox.ts
services/shopping-service/src/application/shoppingOutbox.ts
services/shopping-service/tests/shopping-outbox-publisher.test.ts
services/shopping-service/tests/shopping-message-outbox.test.ts
```

Leave in place (not this owner):

```text
services/shopping-service/src/lib/sale-completed-emitter.ts
services/shopping-service/src/lib/sale-completed-outbox-drain.ts
```
