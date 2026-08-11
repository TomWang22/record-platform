# Track C — `messaging.outbox_events` publisher acceptance matrix

**Date:** 2026-08-10  
**Scope:** messaging only · non-live · mocked Kafka  
**execution_authorized:** false  
**Pre-messaging freeze (obsolete — never authorize):** `3c679ecd…` (media lock-through-ack)  
**Post-messaging PREPARED (do not authorize):** `9efd0a03…`  
**DDL:** `infra/db/02-messaging-outbox.sql` (`published` boolean only — no lease / retry_count / DLQ)  
**Topic:** `messaging.events.v1` (strict; not `${ENV_PREFIX}.messaging.events`)  
**Principal:** `CN=messaging-service`  
**Mirror:** media `publishOutbox.ts` corrected invariants  

Expected readiness after this owner only:

```text
LIFECYCLE_EXECUTABLE = 7
MIGRATION_PENDING    = 1   # auth.outbox_events unchanged
PUBLISHER_BLOCKED    = 4
TOTAL                = 12

remaining blocked:
  notification.outbox_events
  records.outbox_events
  shopping.outbox_events
  trust.outbox_events
```

---

## Hard invariants (every case)

| ID | Invariant | Fail condition |
| --- | --- | --- |
| INV-1 | Publisher enabled **only** when `MESSAGING_OUTBOX_PUBLISHER === "1"` | unset / `"0"` / `"true"` enables publish |
| INV-2 | Claim uses `FOR UPDATE SKIP LOCKED`; row lock held through broker ack → DB ack → COMMIT | Commit/release lock before send |
| INV-3 | `published` advances only after broker ack **and** `UPDATE … WHERE published=false` returns `rowCount === 1` | mark without send; or `rowCount=0` counted published |
| INV-4 | Broker failure never marks published | send reject → mark called |
| INV-5 | Broker-ack / DB-ack failure leaves unpublished; duplicate produce allowed on retry | invent `published=true` on broker ack alone |
| INV-6 | Soft `retry_exhaustion` is **process-scoped**; restart resets (documented) | tick-local Map that cannot accumulate across ticks |
| INV-7 | Mocked Kafka only in unit tests | live produce in CI |
| INV-8 | Denominator stays 12; only messaging flips | media stays executable; auth migration untouched |

---

## Publisher unit matrix (mocked Kafka)

| Case | Name | Assert |
| ---: | --- | --- |
| S1 | happy_path_lock_through_ack | begin_claim → send → mark(rowCount=1) → commit; topic=`messaging.events.v1`, key=`aggregate_id` |
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

---

## Inventory / readiness (post-flip)

| Case | Assert |
| ---: | --- |
| I1 | `messaging.outbox_events.publisher_present === true`, disposition null |
| I2 | implementation points at messaging `publishOutbox` module |
| I3 | `poll_batch.claim` includes `FOR UPDATE SKIP LOCKED` |
| I4 | counts exactly **7 / 1 / 4** |
| I5 | messaging ∈ executable; ∉ blocked |
| I6 | blocked = notification, records, shopping, trust |
| I7 | `auth.outbox_events` sole migration_pending |
| I8 | denominator 12; booking/social forbidden |

---

## Freeze / authorization

| Case | Assert |
| ---: | --- |
| F1 | `3c679ecd…` obsolete / archived; never authorize |
| F2 | new PREPARED SHA distinct; pins messaging publisher + tests |
| F3 | remediation targets exactly 4 remaining blocked |
| F4 | `execution_authorized=false`, `platform_pass=false`, `track_c_acceptance_pass=false` |

---

## Phase gate (messaging flipped to 7/1/4)

```text
Phase A: drain publisher + mocked tests — DONE
Phase B: production transactional enqueue — DONE (HTTP + gRPC create/reply)
  → messaging.outbox_events publisher_present=true / LIFECYCLE_EXECUTABLE
  → freeze 7 / 1 / 4; still no live authorization
```

## Schema location (Phase B hard stop)

Production HTTP writes use `messages.*` on pool DB `messaging`.
Outbox DDL is `messaging.outbox_events` on the **same database** (`MESSAGING_DB_NAME` / `POSTGRES_URL_MESSAGING`).
Same-connection `BEGIN` can include both schemas — confirm before enqueue helper.

---

## Suggested test file

`services/messaging-service/tests/messaging-outbox-publisher.test.ts`
