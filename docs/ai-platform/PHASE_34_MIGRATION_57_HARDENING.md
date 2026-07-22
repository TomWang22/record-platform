# Phase 34 Migration 57 — delivery / authorization / supersession hardening

Static documentation only. Runtime evidence lives under
`/tmp/phase34-runtime-data-to-answer-integration-v1/`.

## Changes

1. **Kafka identity vs delivery** — `intelligence.kafka_event_identities` (one row per source+norm) and `intelligence.kafka_delivery_lineage` (one row per topic/partition/offset). Duplicate deliveries and payload conflicts are retained without overwriting identity.
2. **Outbox payload hash** — global unique index removed; idempotency remains on settlement/outbox keys.
3. **SECURITY DEFINER** — `PUBLIC` execute revoked; publisher functions granted only to `record_outbox_publisher`.
4. **Lease ownership** — acknowledge/reschedule/dead-letter/release require matching `lease_owner` and unexpired lease; zero rows → exception. Actions append to `listings.outbox_publisher_action_ledger`.
5. **Eligibility supersession** — append-only `intelligence.eligibility_supersession_edges`; prior decisions never updated.

## Valuation checkpoint

`PHASE 34 VALUATION DATA-TO-ANSWER RUNTIME LINEAGE VERIFIED` remains accepted under
`checkpoints/valuation-v1/`.
