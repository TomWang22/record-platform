# Track C — Six-Publisher Remediation Implementation Plan

**Date:** 2026-08-10  
**Status:** plan-only / non-live  
**execution_authorized:** false  
**load_testing_authorized:** false  
**Parent denominator:** `TRACK_C_INVENTORY_DENOMINATOR` (`4330610d…`) bound to inventory `5707bed2…`  
**Readiness matrix:** `f2ba461d…`  
**Remediation PREPARED (current):** `288fd8aa…` (`PACKET_C_REMEDIATION_SIX_PUBLISHERS.PREPARED.json`, includes source/test/generator pins)  
**Obsolete unauthorized PREPARED:** `91c033c9…`, `c3c432b9…` (never authorize; `c3c432b9…` lacked source pins)

## Goal

Implement the six missing outbox publishers **one owner/table at a time** without changing the canonical Track C acceptance denominator of **12**.

This plan does **not** authorize live publish, seed mutation, or Track C lifecycle acceptance.

## Frozen invariants (must not change)

```text
TRACK_C_DENOMINATOR = 12

Current readiness partition:
  LIFECYCLE_EXECUTABLE = 5
  MIGRATION_PENDING    = 1   # auth.outbox_events only
  PUBLISHER_BLOCKED    = 6
  TOTAL                = 12

REMEDIATION_TARGETS = exactly the 6 PUBLISHER_BLOCKED owners
booking/social      = FORBIDDEN_NONEXISTENT_SERVICE (ABSENT_BY_CONTRACT)
```

Expected intermediate readiness after all six publishers are genuinely present:

```text
LIFECYCLE_EXECUTABLE = 11
MIGRATION_PENDING    = 1   # auth.outbox_events still separate
PUBLISHER_BLOCKED    = 0
TOTAL                = 12
```

Only after a separate `auth.outbox_events` migration disposition resolves:

```text
LIFECYCLE_EXECUTABLE = 12
MIGRATION_PENDING    = 0
PUBLISHER_BLOCKED    = 0
```

Then — and only then — prepare a **12-owner lifecycle-acceptance packet**. Never promote the six-publisher remediation packet into the acceptance packet.

## Remediation owners (exact set)

| Order | Table | Service | Current disposition | Notes |
| ---: | --- | --- | --- | --- |
| 1 | `media.outbox_events` | media-service | `MISSING_BLOCKS_ACCEPTANCE` | Insert-only today (`insertOutbox.ts`); needs publish/mark loop |
| 2 | `messaging.outbox_events` | messaging-service | `MISSING_BLOCKS_ACCEPTANCE` | Insert paths exist; no publish/mark located |
| 3 | `notification.outbox_events` | notification-service | `MISSING_BLOCKS_ACCEPTANCE` | DDL present; no publisher located |
| 4 | `records.outbox_events` | records-service | `MISSING_BLOCKS_ACCEPTANCE` | DDL present; no publisher located |
| 5 | `shopping.outbox_events` | shopping-service | `MISSING_BLOCKS_ACCEPTANCE` | SaleCompleted drains listings; shopping table unwired |
| 6 | `trust.outbox_events` | trust-service | `MISSING_BLOCKS_ACCEPTANCE` | DDL present; no publisher located |

Out of remediation scope (must remain untouched by this plan’s scope creep):

- 5 `LIFECYCLE_EXECUTABLE` owners
- `auth.outbox_events` (`MIGRATION_PENDING`)

## Per-owner implementation loop (repeat 6 times)

For each table above, in order:

1. **Locate contract**
   - DDL under `infra/db/*-outbox.sql`
   - Topic / principal / status predicate from frozen inventory row
   - Existing insert sites (if any)
2. **Implement publisher**
   - Same-process or dedicated tick publisher owned by `publisher_owner`
   - Claim unpublished rows (`FOR UPDATE SKIP LOCKED` or existing lease pattern)
   - Produce to configured topic
   - Mark published **only after broker ack** (broker ack must not alone imply DB ack)
3. **Unit/integration tests (non-live)**
   - Insert → select → produce attempt → broker ack fixture → DB ack
   - Failure/recovery classifications from Track C lifecycle contract
   - No live Kafka publish in CI unless separately authorized later
4. **Update inventory registry disposition**
   - Flip that single row to `publisher_present=true`
   - Clear `publisher_disposition` (null)
   - Do **not** change expected_count / discovered_count / canonical 12
5. **Rebuild readiness**
   - `publisher_blocked` decrements by 1
   - `lifecycle_executable` increments by 1
   - `migration_pending` remains exactly `auth.outbox_events`
6. **Stop and review**
   - Do not batch-flip multiple owners in one change without explicit owner review

## Hard stops

- Do not remove or silence `auth.outbox_events`
- Do not invent inventory rows for `booking` / `social`
- Do not redefine acceptance denominator to 6
- Do not authorize Packet C live lifecycle from remediation PREPARED
- Do not treat canary-v3 as Track C platform PASS
- Do not mark published without broker+DB ack sequencing evidence in tests

## After all six are present

1. Rebuild inventory + readiness → expect **11 / 1 / 0**
2. Open a **separate** migration plan for `auth.outbox_events`
3. Only when readiness is **12 / 0 / 0**, prepare Track C lifecycle-acceptance packet across all 12
4. Live acceptance requires full lifecycle identities/states and `unknowns=0`
5. Independent frozen-evidence auditor decides terminal Track C PASS

## Explicitly not this plan

- Packet C authorization
- Live publish / seed / load
- Inventory redesign
- Kafka broker matrix (Track D)
- Protocol k6 (Track E)
