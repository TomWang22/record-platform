# Phase B schema / snapshot / claim-ledger diff

**Base:** `b955bba3424e61741da9ac7b259b42f589a9a79b` (Phase A)
**Branch:** `main` only

## Schema additions

### `infra/db/50-listings-sale-completed-hardening.sql` (Phase A harden)

- Unique: `market_event_id`; `(settlement_source, payment_transaction_id)`; `(order_id, payload_hash)`; `(listing_id, payload_hash)`
- `listings.listings.settlement_evidence_eligible` — true only when SALE_COMPLETED exists
- `listings.lifecycle_transition_audit`
- `listings.sale_followup_events` (`SALE_REFUNDED`, `SALE_REVERSED`, `PAYMENT_CHARGEBACK`, `AUCTION_NON_PAYMENT`, `SALE_CORRECTION_RECORDED`)
- BEFORE UPDATE/DELETE triggers + `REVOKE UPDATE/DELETE` on sale tables

### `infra/db/51-intelligence-evidence-platform.sql` (Phase B)

Schema `intelligence`:

| Table | Role |
|-------|------|
| `raw_observations` | Append-only source observations with rights class |
| `market_events` | Canonical normalized events |
| `entity_resolutions` | MATCHED_EXACT_PRESSING / RELEASE_ONLY / AMBIGUOUS / UNRESOLVED |
| `eligibility_decisions` | Per-snapshot include/exclude reasons |
| `evidence_snapshots` | Immutable snapshot header + hash |
| `evidence_snapshot_items` | Included items |
| `evidence_snapshot_exclusions` | Excluded IDs + decisions |
| `evidence_snapshot_subjects` | Subject payloads |
| `evidence_snapshot_queries` | Query plan + retrieval execution |
| `evidence_snapshot_versions` | Version registry |
| `claim_ledgers` / `claim_ledger_entries` | Claim→evidence verification |
| `response_envelopes` | Shared versioned envelope metadata |

## Snapshot contract (v2)

Required on every intelligence response:

- `evidence_snapshot_id`
- `evidence_snapshot_hash`
- `capability`
- `subject_resolution`
- `included_event_ids`
- `excluded_event_ids[]` with `{id, decision, reason}`
- `source_rights_distribution`
- `event_type_distribution`
- `eligibility_version` / `dedupe_version` / `retrieval_version`

Builder: `scripts/lib/phase34-claim-ledger.mjs` → `buildPlatformEvidenceSnapshot`

## Claim ledger contract

- `claim_ledger_id`, `response_id`, `evidence_snapshot_id/hash`
- Entries: `claim_type`, `normalized_claim_value`, `supporting_snapshot_item_ids`, `deterministic_calculation_id`, `verification_result`
- Material unsupported/contradicted → `verification_status=FAIL` → delivery blocked

## Shared envelope (v1)

`finalizeCapabilityResponse` (`phase34-capability-response.mjs`) for all eight capabilities — no capability-local unversioned response shape.

## Runtime emitter change

`services/shopping-service/src/lib/sale-completed-emitter.ts`:

1. BEGIN
2. lifecycle → SOLD + `settlement_evidence_eligible=TRUE` + audit
3. INSERT `sale_completed_events` (idempotent)
4. INSERT `listings.outbox_events` (`SaleCompleted`)
5. COMMIT (ROLLBACK creates none)

## Libraries added

- `phase34-lifecycle-transitions.mjs`
- `phase34-sale-followup-events.mjs`
- `phase34-canonical-market-platform.mjs`
- `phase34-entity-resolution.mjs`
- `phase34-eligibility-engine.mjs`
- `phase34-claim-ledger.mjs`
- `phase34-capability-response.mjs`

## Explicit non-goals in this diff

- Attempt 7 / screenshots / UI styling
- Phase C full synthetic-floor purge (next)
- ChatGPT-tier / product acceptance claims
