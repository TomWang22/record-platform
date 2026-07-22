# Phase 34 Migration 60 — Numeric turn_index and audit quarantine

Isolated integration listings DB (port 5435). Not production.

## Changes

1. **Numeric turn ordering** — `eligibility_decisions.turn_index` (and optional edge `turn_index`) is the authoritative same-session supersession order. `turn_id` is identity only and is never compared lexicographically.
2. **Audit quarantine** — `intelligence.migration_audit_quarantine` stores orphan audit rows with payload + hash before constrained removal via `quarantine_orphan_claim_verifications()`. Silent deletes without quarantine are forbidden in production-applicable migrations.

## Apply / verify

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 5435 -U postgres -d listings \
  -v ON_ERROR_STOP=1 -f infra/db/60-phase34-turn-index-and-audit-quarantine.sql

PHASE34_EVIDENCE_ROOT=/tmp/phase34-runtime-data-to-answer-integration-v4 \
  node scripts/ai-platform/phase34-runtime-migration60-verify.mjs
```
