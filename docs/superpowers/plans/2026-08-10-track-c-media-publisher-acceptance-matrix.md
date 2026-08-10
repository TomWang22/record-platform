# Track C — `media.outbox_events` publisher acceptance matrix

**Date:** 2026-08-10  
**Scope:** media only · non-live · mocked Kafka  
**execution_authorized:** false  
**Pre-remediation freeze (do not authorize):** `288fd8aa…`  
**Post-media remediation freeze (do not authorize):** `3c679ecd…`  
**Obsolete:** `288fd8aa…`, `6fbc2410…` (and earlier)  
**Inventory:** `fd35ad0a…` · denom `065f0c78…` · readiness `b1595951…` (6/1/5)  
**DDL:** `infra/db/02-media-outbox.sql` (`published` boolean only — no `retry_count` / lease / DLQ columns)  
**Topic:** `${ENV_PREFIX}.media.events` · key = `aggregate_id` · principal `CN=media-service`  
**Mirror pattern:** analytics claim → produce → `UPDATE published=true` **after** broker ack  

Expected readiness after this owner only:

```text
LIFECYCLE_EXECUTABLE = 6
MIGRATION_PENDING    = 1   # auth.outbox_events unchanged
PUBLISHER_BLOCKED    = 5
TOTAL                = 12
```

---

## Hard invariants (every case)

| ID | Invariant | Fail condition |
| --- | --- | --- |
| INV-1 | `published` advances to `true` only via `markPublished` **after** `sendToKafka` resolves | `markPublished` called before send settles, or on send reject |
| INV-2 | Broker ack alone never implies DB ack | Send success + mark failure ⇒ row remains `published=false` |
| INV-3 | Claim does not publish | Selection/`FOR UPDATE SKIP LOCKED` without send leaves `published=false` |
| INV-4 | No live Kafka in these tests | All produces go through injected `sendToKafka` mock |
| INV-5 | Denominator stays 12; only media flips | Messaging+ remain blocked; `auth.outbox_events` stays migration pending |

---

## Publisher unit matrix (mocked Kafka)

| Case | Name | Setup | Assert |
| ---: | --- | --- | --- |
| M1 | happy_path_claim_produce_mark | One unpublished row; send resolves | send called with topic `${ENV_PREFIX}.media.events`, key=`aggregate_id`, payload bytes; then `markPublished(id)` once; result `published=1` |
| M2 | empty_claim_noop | Claim returns `[]` | send never called; mark never called; `published=0` |
| M3 | broker_unavailable | send rejects | mark **never** called; disposition `broker_unavailable`; row stays unpublished; `failed≥1` |
| M4 | restart_after_selection | Tick A: claim returns row, crash **before** send (simulate abort); Tick B: same row claimed again, send+mark OK | After A: no mark; after B: mark once; proves selection ≠ publish |
| M5 | broker_ack_before_db_ack | Tick A: send OK, `markPublished` rejects; Tick B: claim again, send OK, mark OK | After A: `published=false`, disposition `broker_ack_without_db_ack` / orphan risk; after B: mark once; send may run twice (at-least-once) |
| M6 | duplicate_delivery | Two successful ticks for same logical event (re-claim after mark failure, or explicit second produce before mark) | Consumers must tolerate duplicate produce; publisher must not mark until each successful path’s DB ack; no inventing `published=true` on first broker ack alone |
| M7 | poison_event | send rejects with classified poison (or deps `isPoison=true`) | mark never called; disposition `poison_event`; row remains `published=false` (no DLQ column — **no silent discard**) |
| M8 | retry_exhaustion | N consecutive broker failures for same id (soft max via deps / tick config; **not** DDL `retry_count`) | After threshold: disposition `retry_exhaustion`; mark never called; row remains claimable/`published=false` until operator/DDL DLQ exists |
| M9 | ordering_broker_then_db | Instrument call order | Call sequence always `send` → (await) → `markPublished`; never reverse |
| M10 | batch_partial_failure | Two rows; first send OK+mark OK; second send fails | First marked; second not marked; tick continues without rolling back first DB ack |

---

## Inventory / readiness acceptance (post-flip)

| Case | Name | Assert |
| ---: | --- | --- |
| I1 | media_publisher_present | Registry/inventory: `media.outbox_events.publisher_present === true`, `publisher_disposition === null` |
| I2 | media_implementation_path | `publisher_implementation` points at publish module (not insert-only) |
| I3 | media_claim_model | `poll_batch.claim` includes `FOR UPDATE SKIP LOCKED`; batch_limit set |
| I4 | partition_6_1_5 | Readiness counts exactly `lifecycle_executable=6`, `migration_pending=1`, `publisher_blocked=5` |
| I5 | media_in_executable | `media.outbox_events` ∈ `lifecycle_executable`; ∉ `publisher_blocked` |
| I6 | migration_untouched | `auth.outbox_events` still sole `migration_pending` |
| I7 | remaining_blocked | Blocked set exactly: messaging, notification, records, shopping, trust |
| I8 | denominator_12 | `expected_count=discovered_count=12`; booking/social still forbidden |

---

## Freeze / authorization acceptance

| Case | Name | Assert |
| ---: | --- | --- |
| F1 | obsolete_288fd8aa | `288fd8aa…` listed obsolete / archived; **never** authorization target |
| F2 | new_prepared_distinct | Post-media PREPARED has new SHA ≠ `288fd8aa…` / `c3c432b9…` / `91c033c9…` |
| F3 | source_pins_include_media | New PREPARED pins media publisher + its tests (and updated Track C builders/guards as changed) |
| F4 | remediation_targets_five | New remediation packet targets remaining **5** blocked owners only; denominator still 12 |
| F5 | flags_closed | `execution_authorized=false`, `platform_pass=false`, `track_c_acceptance_pass=false` |

---

## Explicitly out of scope (this media slice)

- Live Kafka produce / ACL provisioning  
- Proto/`EventEnvelope` encoding upgrade (insert stub may remain)  
- Consumer / `offset_committed` / business-effect closure  
- Messaging (or any non-media) publisher  
- `auth.outbox_events` migration  
- Treating remediation PREPARED as Track C PASS  

---

## Suggested test file

`services/media-service/tests/media-outbox-publisher.test.ts` — vitest + injected deps (auth-style `runMediaOutboxPublisherTickWithDeps`).
