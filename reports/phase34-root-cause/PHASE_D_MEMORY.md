# Phase D — Authoritative multi-turn memory and corrections

**Status:** Implemented on `main` (library + SQL + negotiation bridge + unit tests).
**Non-goals:** Attempt 7, screenshots, UI polish.

## Model

Serializable session document (`phase34-conversation-memory-v1`) holds:

| Entity | Role |
|--------|------|
| `conversation_session` | Principal/thread bound session + consent + `state_version` |
| `conversation_turn` | Ordered turns with actor/intent |
| `structured_fact` | Keyed typed values with provenance |
| `fact_revision` | Append-only supersession / forget audit |
| `memory_scope` | TURN / SESSION / THREAD / USER_PRIVATE / ACCOUNT / NONE |
| `retrieval_checkpoint` | Re-retrieve after material correction |
| `response` | Capability output bound to `session_state_version` |
| `draft` | Negotiation draft lifecycle |
| `action_confirmation` | Side effects require explicit confirm |

Each fact carries: `key`, typed `value`, `source_turn_id`, `source_actor`, `timestamp`, `confidence`, `authority`, `supersedes_fact_id`, `active`, `expires_at`, `privacy_scope`, `deletion_state`.

Postgres mirror: `infra/db/52-intelligence-conversation-memory.sql` under `intelligence.*` with soft-active supersession and append-only revisions/checkpoints.

## Correction precedence (hard-coded)

1. `CURRENT_EXPLICIT_CUSTOMER_CORRECTION`
2. `CURRENT_EXPLICIT_CUSTOMER_STATEMENT`
3. `PERSISTED_AUTHORIZED_THREAD_FACT`
4. `FIRST_PARTY_MARKETPLACE_EVENT`
5. `GROUNDED_INFERENCE`
6. `MODEL_INFERENCE`

APIs: `applyCorrection` → `resolveActiveFacts` → `recomputeAfterCorrection`.
Inference cannot override a direct customer correction (`ILLEGAL_AUTHORITY_OVERRIDE`).

Canonical example: shipping `$6` → correction `$5` supersedes, creates retrieval checkpoint, flags draft/economics rewrite.

## Context assembly

`assembleContext` / `buildContextBudgetHelpers` (4k / 8k / 16k / 32k) assemble:

- recent turns (windowed)
- active facts
- compact summary
- retrieved memories
- evidence excerpts
- action state + correction history

Not a full history dump; over-budget tiers trim memories/evidence first.

## Draft lifecycle

`GENERATED` → `EDITED` → `INSERTED` → `CONFIRMED` → `SENT` (or `CANCELLED`).

**Insert ≠ send.** `message_sent` stays false until `SENT` after confirmation.

## Negotiation bridge

`phase33d-negotiation.mjs` uses memory when `session_state` / `conversation_facts` / `structured_memory_facts` are present; offline regex path unchanged. Exports `session_state_version` compatible with `finalizeCapabilityResponse`.

## Gates covered in unit tests

- Multi-turn persistence + provenance
- Correction supersession + recompute
- Illegal authority override rejected
- Forget / deletion propagation stub
- Cross-user / cross-thread isolation
- Draft insert ≠ send
- Backward-compatible negotiation without memory

## Remaining gaps

- No live Postgres writer/reader service yet (SQL ready; JS store is in-memory).
- Consent/forget not yet wired to production auth or GDPR deletion workers.
- Owner-proof journeys still primarily regex context unless they pass `session_state`.
- Phase E synthesis / claim-ledger binding of memory facts still pending.
