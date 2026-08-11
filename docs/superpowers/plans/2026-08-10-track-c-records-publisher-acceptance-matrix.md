# Track C — `records.outbox_events` publisher acceptance matrix

**Date:** 2026-08-10  
**Scope:** records only · non-live · mocked Kafka  
**execution_authorized:** false  
**Current freeze (immutable — never authorize / never execute live):** `380993598d3f2d419a54eec5fbb43e7562bdd5b30cc94f130d2a98d66806a7e9`  
**Obsolete (permanently):** `ca9a35c7a97d660878837b46cc2c4a4828c4a1d3c1ca972b827bfc08ff349f46`, `9efd0a0333741909d6b4b75256973bbb4035a18709e69d4a6441d07487edb1e7`  
**Starting readiness:** **8 / 1 / 3** (post-Phase-B freeze: **9 / 1 / 2**)  
**DDL:** `infra/db/01-records-outbox.sql` (`published` boolean only — no lease / retry_count / DLQ)  
**Topic:** `${ENV_PREFIX}.records.events` (e.g. `dev.records.events`)  
**Principal:** `CN=records-service`  
**Kafka key:** `aggregate_id` (per DDL / outbox contract)  
**Mirror:** notification lock-through-ack publisher **including G7 ambiguous COMMIT reconciliation**  
**Do not batch:** shopping / trust stay blocked

Expected readiness **only after** Phase A drain **and** Phase B transactional enqueue both pass:

```text
LIFECYCLE_EXECUTABLE = 9
MIGRATION_PENDING    = 1   # auth.outbox_events unchanged
PUBLISHER_BLOCKED    = 2
TOTAL                = 12

remaining blocked:
  shopping.outbox_events
  trust.outbox_events
```

---

## Inspection summary (pre-implementation — freeze this evidence)

| Fact | Evidence |
| --- | --- |
| Outbox table | `records.outbox_events` on DB `records` / schema `records` (`01-records-outbox.sql`) |
| Status/ack column | `published BOOLEAN NOT NULL DEFAULT false` only |
| Payload column | `BYTEA`; DDL comment: **Serialized domain event (proto bytes); not JSON** |
| Event identity | `id UUID` = envelope `event_id`; publisher must not mint a new UUID on drain |
| Topic | `${ENV_PREFIX}.records.events` |
| Principal / ACL | `CN=records-service` · WRITE that topic |
| Domain table (same DB) | `records.records` (+ `record_revisions`, `record_media`) via Prisma `DATABASE_URL` |
| Same-connection TX | **Possible** — HTTP create/update already use `prisma.$transaction`; outbox can `$executeRaw` on the same `tx` |
| Outbox INSERT sites | **None** in repository |
| Kafka **producer** | **None** in records-service (`package.json` has no kafkajs; no `getRpKafka` / `producer.send`) |
| Direct-produce of Record\* | **None** |
| Deploy publisher flag | **Absent** — no `RECORDS_OUTBOX_PUBLISHER` today |
| Kafka client certs | Mounted on `records-service` deploy (`KAFKA_CA_CERT` / client cert+key) but unused |
| Recommended model | **Transactional enqueue + publisher** (not drain-only) |
| Tests | **No** `services/records-service/tests/` directory today |

### Why not drain-only

Drain-only would leave `publisher_present=true` with a forever-empty outbox. Runtime audit already records `produce_mode=not_wired_in_service_code` and `records.outbox_events` count 0 after live POST/PUT (`scripts/audit-rp-event-kafka-matrix.sh`). Inventory `creation_transition` requires domain write + outbox insert. Notification/messaging precedent: flip only after Phase B.

### Covered domain-write surfaces (must share enqueue once implemented)

| Surface | Mechanism today | Kafka Record\* today | Same TX today |
| --- | --- | --- | --- |
| HTTP `POST /records` | `prisma.$transaction`: `record.create` + `recordRevision.create` | No | Yes (domain+revision only) |
| HTTP `PUT /records/:id` | `prisma.$transaction`: update + optional revision | No | Yes (domain+revision only) |
| HTTP `DELETE /records/:id` | bare `prisma.record.delete` | No | **No TX** |
| gRPC `CreateRecord` | bare `prisma.record.create` (no revision) | No | **No TX** |
| gRPC `UpdateRecord` | bare `prisma.record.update` (no revision) | No | **No TX** |
| gRPC `DeleteRecord` | bare `prisma.record.deleteMany` | No | **No TX** |
| HTTP export / search / list | read-only | N/A | N/A |
| Redis cache / PG LISTEN | invalidation after write | **Not** a substitute for outbox | After COMMIT |

Redis `verKey` / search-key invalidation is post-commit cache, not an event bus.

### Self-consume hazard

**None in-process.** records-service does not subscribe to `${ENV_PREFIX}.records.events`. Analytics is documented as a **planned** consumer only (`analytics-service (planned)` in kafka-matrix audit; no decoder in `services/analytics-service`). No recursion guard required unless a consumer is added in this slice (it must not be).

### Payload contract open point (resolve before Phase B — do not flip silently)

Two documented shapes exist:

1. **Global OUTBOX docs + this DDL + `proto/events/records.proto`:** outbox `payload` = domain proto bytes (`RecordCreatedV1` / `RecordUpdatedV1` / `RecordDeletedV1`); Kafka value = `events.EventEnvelope` protobuf with `event_id = outbox.id`, `payload = stored_bytea`, `entity_id = aggregate_id`.
2. **Messaging/notification Track C family:** stored BYTEA = Kafka value = UTF-8 JSON envelope (`JSON.stringify` bytes).

There is **no** existing records consumer decoder to contradict (1). DDL comment already says proto / not JSON. `envelope.proto` forbids raw domain messages on topics.

**Recommendation for Phase B freeze (do not implement until frozen):**

```text
PAYLOAD_CONTRACT:
  encoding = PROTOBUF
  stored_bytea = Record{Created,Updated,Deleted}V1.encode() bytes
  kafka_value = EventEnvelope.encode({
    event_id: outbox.id,
    type: outbox.type,
    version: outbox.version,
    source: "records-service",
    entity_id: outbox.aggregate_id,
    payload: stored_bytea
  })
  ddl_comment = keep: Serialized domain event (proto bytes); not JSON
  drain_never_mints_event_id = true
```

Do **not** silently store JSON while DDL says proto. If Track C later chooses JSON for publisher-family consistency, rewrite the DDL comment in the same slice and prove round-trip in mocked tests before inventory flip.

### Event semantics (proposed freeze)

```text
CREATE_EVENT_CONTRACT:
  HTTP POST /records  and gRPC CreateRecord → type = RecordCreatedV1
  HTTP PUT  /records/:id and gRPC UpdateRecord → type = RecordUpdatedV1
  HTTP DELETE /records/:id and gRPC DeleteRecord → type = RecordDeletedV1
  aggregate_id = record_id
  no-op update (zero changed fields) → still RecordUpdatedV1 iff domain row write committed;
    optional: skip outbox when PUT revision is skipped (diff.changed.length===0)
    — freeze this before Phase B (recommend: enqueue only when a domain row actually mutates)

IDENTITY_CONTRACT:
  event_id minted once before domain/outbox insert
  EventEnvelope.event_id == records.outbox_events.id
  drain never mints/replaces event_id
  missing event_id on Track-C-compatible input = FAIL_CLOSED (no randomUUID)
```

### COMMIT baseline (carry from notification — do not regress)

```text
COMMIT throws
  => published outcome = UNKNOWN_PENDING_RECONCILIATION
  => never clear soft retry state
  => reconnect using a fresh DB connection
  => SELECT id,published for every claimed row

all false => DB transaction did not persist; retryable
all true  => DB commit persisted; treat DB ack as recovered
mixed     => hard failure / invariant violation
reconciliation unavailable => UNKNOWN != 0; Track C acceptance cannot PASS
```

Mocked G6 may assert rollback **invocation**. It must **not** claim rollback proves the server did not commit.

---

## Hard invariants (every case)

| ID | Invariant | Fail condition |
| --- | --- | --- |
| INV-1 | Publisher enabled **only** when `RECORDS_OUTBOX_PUBLISHER === "1"` | unset / `"0"` / `"true"` enables publish |
| INV-2 | Claim uses `FOR UPDATE SKIP LOCKED`; row lock held through broker ack → DB mark → COMMIT | Commit/release lock before send |
| INV-3 | `published` advances only after broker ack **and** `UPDATE … WHERE published=false` returns `rowCount === 1` | mark without send; or `rowCount=0` counted published |
| INV-4 | Broker failure never marks published | send reject → mark called |
| INV-5 | Broker-ack / DB-ack failure leaves unpublished; duplicate produce allowed on retry | invent `published=true` on broker ack alone |
| INV-6 | Soft `retry_exhaustion` is **process-scoped**; restart resets (documented) | tick-local Map that cannot accumulate across ticks |
| INV-7 | Mocked Kafka only in unit tests | live produce in CI |
| INV-8 | Denominator stays 12; only records flips | notification/messaging/media stay executable; auth migration untouched; shopping/trust stay blocked |
| INV-9 | Covered domain writes enqueue outbox in the **same Prisma `$transaction`** as the domain mutation | domain write then separate outbox insert; or HTTP delete remains outside TX |
| INV-10 | Envelope `event_id` === `outbox.id`; drain does not mint a new id | new UUID on publish |
| INV-11 | COMMIT throw is **ambiguous** until fresh-connection reconciliation (G7) | `COMMIT throws ⇒ published=0` treated as proven |
| INV-12 | No shopping/trust work in this owner slice | inventory rows other than records change |

---

## Publisher unit matrix (mocked Kafka) — Phase A drain

| Case | Name | Assert |
| ---: | --- | --- |
| S1 | happy_path_lock_through_ack | begin_claim → send → mark(rowCount=1) → commit; topic=`${ENV_PREFIX}.records.events`, key=`aggregate_id` |
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
| G5 | commit_throw_without_reconcile | outcome `unknown_pending_reconciliation`; unknowns>0; soft failures retained |
| G6 | commit_throw_batch | rollback invoked; **no** published=false proof without reconcile |
| G7 | ambiguous_commit_reconciliation | fresh-connection SELECT: all false / all true / mixed / unavailable as notification G7 |

---

## Enqueue / same-TX matrix — Phase B (blocked until payload + no-op-update contracts frozen)

**Payload + no-op PUT + event types are FROZEN (2026-08-10).**

Phase B still waits for Phase A S1–S12 / G3 / G5 / G6 / G7 green.

| Case | Name | Assert |
| ---: | --- | --- |
| E1 | create_inserts_outbox_same_tx | HTTP POST domain + outbox on one Prisma `tx`; COMMIT once |
| E2 | domain_failure_zero_outbox | domain throw ⇒ ROLLBACK; outbox row count 0 |
| E3 | outbox_failure_rolls_domain | outbox throw ⇒ domain insert rolled back |
| E4 | commit_failure_fail_closed | request fails; no committed domain or outbox |
| E5 | event_id_matches_outbox_pk | frozen id in EventEnvelope === `outbox.id` |
| E6 | payload_bytes_match_chosen_contract | stored BYTEA equals serializer output for frozen encoding |
| E7 | partition_key_in_aggregate_id | `aggregate_id` = `record_id` |
| E8 | covered_http_create | `POST /records` uses shared enqueue helper |
| E9 | covered_http_update | `PUT /records/:id` uses shared enqueue helper |
| E10 | covered_http_delete | `DELETE /records/:id` uses shared TX + enqueue (today it does not) |
| E11 | covered_grpc_create_update_delete | gRPC Create/Update/Delete use the same helpers |
| E12 | no_direct_kafka_produce_on_write | write paths never `producer.send` Record\* |
| E13 | created_updated_deleted_semantics | create→CreatedV1; update→UpdatedV1; delete→DeletedV1 |
| E14 | kafka_value_wraps_stored_payload | if proto freeze: kafka_value = EventEnvelope(stored_bytea); drain does not remint id |

---

## Inventory / readiness (post-flip only)

| Case | Assert |
| ---: | --- |
| I1 | `records.outbox_events.publisher_present === true`, disposition null |
| I2 | implementation points at records `publishOutbox` (+ enqueue) modules |
| I3 | `poll_batch.claim` includes `FOR UPDATE SKIP LOCKED` |
| I4 | counts exactly **9 / 1 / 2** |
| I5 | records ∈ executable; ∉ blocked |
| I6 | blocked = shopping, trust |
| I7 | `auth.outbox_events` sole migration_pending |
| I8 | denominator 12; booking/social forbidden |
| I9 | notification remains executable and default-off |

---

## Freeze / authorization

| Case | Assert |
| ---: | --- |
| F1 | `ca9a35c7…` obsolete / archived after records PREPARED; never authorize as execution target |
| F2 | `9efd0a03…` remains obsolete |
| F3 | new PREPARED SHA distinct; pins records publisher + enqueue + tests |
| F4 | remediation targets exactly 2 remaining blocked (shopping, trust) |
| F5 | `execution_authorized=false`, `platform_pass=false`, `track_c_acceptance_pass=false` |

---

## Phase gate

```text
Phase 0: inspect + matrix — DONE
  → PREPARED ca9a35c7… remains starting freeze (never authorize)

Phase A: drain publisher + protobuf EventEnvelope wrap + S1–S12 / G3 / G5 / G6 / G7
  → GREEN (22/22 mocked Kafka; protobufjs Root#loadSync keepCase)
  → RECORDS_OUTBOX_PUBLISHER default OFF
  → records.publisher_present remains false
  → readiness remains 8 / 1 / 3
  → do not flip inventory after Phase A alone

Phase B: GREEN — HTTP+gRPC transactional enqueue + E1–E14
  → no-op PUT: no mutation ⇒ no revision ⇒ no outbox
  → flipped publisher_present; refrozen 9 / 1 / 2
  → stop for review; no Packet C / live auth
```

## Schema location (hard stop)

Production writes use Prisma against `DATABASE_URL` (records DB, schema `records`).  
Outbox DDL is `records.outbox_events` on the **same** database.  
Same Prisma `$transaction` can include domain + `$executeRaw` outbox INSERT — required for Phase B.  
Do not introduce a second pool for enqueue that cannot share the domain TX.

---

## Suggested test / module layout

```text
services/records-service/src/recordsKafkaEvents.ts          # Phase A DONE — protobufjs wrap
services/records-service/src/outbox/publishOutbox.ts       # Phase A DONE — drain + G7
services/records-service/tests/records-outbox-publisher.test.ts  # Phase A DONE
services/records-service/src/outbox/enqueueOutbox.ts       # Phase B DONE
services/records-service/src/application/recordOutbox.ts   # Phase B DONE
services/records-service/tests/records-message-outbox.test.ts    # Phase B DONE
```
