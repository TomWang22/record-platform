# Phase 34 — Migration 58 audit and claim-integrity hardening

Static documentation only. Runtime evidence lives under
`/tmp/phase34-runtime-data-to-answer-integration-v2/` (not Git).

## Defects closed

1. **Denied publisher actions are durable** — acknowledge / reschedule / release /
   dead-letter return `{affected_rows, result, error_class}` and do **not** raise
   after writing `*_DENIED` ledger rows, so the denial commits with the caller
   transaction.
2. **Publisher cannot forge the audit ledger** — `record_outbox_publisher` has
   SELECT-only on `outbox_publisher_action_ledger` and no EXECUTE on
   `_outbox_log_action`. Functions are owned by `record_outbox_function_owner`.
3. **LEASE actions are recorded** atomically with lease acquisition.
4. **Action ledger is append-only** with FK to outbox events and ACK coordinate
   CHECKs (successful ACK requires broker coords; denied ACK forbids them).
5. **New inserts reject `LEGACY_UNKNOWN`** (and synonyms) and require a 40-char
   hex Git SHA; `is_legacy_source_sha` marks historical rows.
6. **Supersession edges** have FKs, self/cycle/capability/temporal checks, and
   require deprecated `superseded_by_decision_id` to remain NULL.
7. **Claim integrity is database-derived** via
   `intelligence.verify_claim_integrity_from_db(response_id, claim_id, calculation_id)`
   which loads persisted objects and stores
   `intelligence.claim_integrity_verifications` (PASS/FAIL durable).
8. **Acknowledged broker coordinates are unique** across published outbox rows.

## Local apply

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 5435 -U postgres -d listings \
  -v ON_ERROR_STOP=1 -f infra/db/58-phase34-runtime-audit-and-claim-integrity.sql
```

## Verify

```bash
PHASE34_EVIDENCE_ROOT=/tmp/phase34-runtime-data-to-answer-integration-v2 \
  node scripts/ai-platform/phase34-runtime-migration58-verify.mjs
```

Production remains **NOT APPROVED**.
