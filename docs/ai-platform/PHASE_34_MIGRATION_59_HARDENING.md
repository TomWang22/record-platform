# Phase 34 Migration 59 — Claim-verification trust boundary

Isolated integration listings DB (port 5435). Not production.

## What this closes

Migration 58 left several claim-verification and publisher-audit gaps. Migration 59:

1. **Trust boundary** — `record_readwrite` (and ordinary service roles) cannot `INSERT`/`UPDATE`/`DELETE` on `intelligence.claim_integrity_verifications`. Only `record_claim_verifier_owner` may insert verification rows via `verify_claim_integrity_from_db`.
2. **Caller calculation substitution** — `p_calculation_id` must equal the claim’s persisted `deterministic_calculation_id`; never substitutes a missing link.
3. **Support lineage** — support IDs resolve through `evidence_snapshot_items` → `market_event_id` before rights/deletion/event-type checks.
4. **Hash recomputation** — calculation and snapshot hashes are recomputed from normalized DB values (not stored-vs-stored).
5. **Material support** — empty support fails; sold_count/median/range checked against calculation and support cardinality.
6. **Eligibility** — supporting market events require an `INCLUDED` decision; excluded decisions cannot support claims.
7. **Verifier attempt ledger** — append-only audit of every verification attempt.
8. **Publisher early denials** — missing owner and incomplete broker coordinates record durable `DENIED` ledger rows before return.
9. **Supersession lineage** — reason registry, session match (or authorized durable-memory transition), and turn order.

## Apply

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 5435 -U postgres -d listings \
  -v ON_ERROR_STOP=1 -f infra/db/59-phase34-claim-verification-trust-boundary.sql
```

## Verify

```bash
PHASE34_EVIDENCE_ROOT=/tmp/phase34-runtime-data-to-answer-integration-v3 \
  node scripts/ai-platform/phase34-runtime-migration59-verify.mjs

PHASE34_EVIDENCE_ROOT=/tmp/phase34-runtime-data-to-answer-integration-v3 \
  node scripts/ai-platform/phase34-runtime-migration58-verify.mjs
```

## Honest classification after this migration alone

```text
MIGRATION 59 CLAIM-VERIFICATION TRUST BOUNDARY VERIFIED —
DETERMINISTIC RUNTIME ACCEPTANCE (v2) PRESERVED —
VECTOR / HYBRID RETRIEVAL NOT YET PROVEN —
MODEL-DRIVEN SYNTHESIS NOT YET PROVEN —
PRODUCTION NOT APPROVED
```
