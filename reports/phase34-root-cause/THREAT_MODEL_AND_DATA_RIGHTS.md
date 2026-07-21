# Phase B–G threat model and data-rights review

**Scope:** Phase 34 data-to-answer platform (canonical events → evidence snapshots → claim ledger → synthesis).
**Authority:** Continue on `main` through B–G; `MODEL_WEIGHT_TRAINING` remains NO.
**Reviewed with:** Phase A hardening (`50-…`) + Phase B schema (`51-…`).

## Threat model (STRIDE-oriented)

| Threat | Asset | Mitigation in B (and required in C–G) |
|--------|--------|----------------------------------------|
| Spoofed settlement / forged SALE_COMPLETED | Completed-sale evidence | Only `FIRST_PARTY_SETTLEMENT` observations normalize to `SALE_COMPLETED`; seed/`sold_at`/archive → `EXCLUDED_UNSETTLED` |
| Tampering of sold events | `sale_completed_events` | Append-only triggers + `REVOKE UPDATE/DELETE`; corrections via follow-up events only |
| Duplicate settlement replay | Orders / payments | Unique `(settlement_source, payment_transaction_id)`, deterministic sale ids, outbox idempotency |
| Privilege escalation via lifecycle | Listing state | Legal transition service; `ARCHIVED → SOLD` illegal; audit rows |
| Information disclosure of internal IDs | Customer responses | Envelope hides raw IDs by default; dossiers retain them for owners |
| Cross-user / cross-thread leakage | Messages, prefs | Eligibility `EXCLUDED_RIGHTS`; Phase D isolation tests mandatory |
| Model invention of prices/counts | Customer trust | Claim ledger fail-closed before delivery; invention guard in Phase E |
| Prompt injection via owner_proof_prompt | Evidence population | Phase C removes prompt-driven floors; hooks require `PHASE34_UNIT_TEST_HOOKS` and fail prod startup |
| Unauthorized connector enablement | Popsike/Gripsweat/Discogs scrape | Phase G connector contracts; forbidden sources cannot enable via ordinary config |
| Secret exposure (Discogs API key) | Credentials | Env/secret only; never commit/print; catalog ≠ sales evidence |
| Denial of evidence integrity | Snapshots | Immutable snapshot tables; hash-bound responses; no response without snapshot id/hash |
| Repudiation of actions | Negotiation send, prefs | Phase D/E confirmation + audit; insert ≠ send |

### Residual risks (accepted for now)

1. Shopping checkout spans shopping DB + listings DB without XA. Listings-side settlement write is atomic (lifecycle + sale + outbox). Cross-DB failure requires reconciliation job (Phase E tooling) — document as known limitation until saga/outbox bridge lands.
2. Application roles that are table owners bypass `REVOKE`; triggers still block UPDATE/DELETE.
3. Historical `lifecycle_status=SOLD` from `sold_at` backfill remains for display compatibility but `settlement_evidence_eligible=false` until a real event exists.

## Data-rights posture

### Allowed evidence classes

- FIRST_PARTY_SETTLEMENT / LISTING / OFFER / AUCTION / BID_EVENT / WATCHLIST / COLLECTION / PREFERENCE / AUTHORIZED_MESSAGE
- PERMITTED_PUBLIC_CATALOG (metadata only — never sale comps)
- LICENSED_EXTERNAL_ARCHIVE (only with recorded license)

### Forbidden without written rights

- Popsike scraping or simulation
- Gripsweat scraping or simulation
- Discogs marketplace/sales treated as first-party comps
- Any undifferentiated merge of catalog + asking + sold + private messages

### Discogs

- API key via secret/env only
- Catalog metadata separate from settlement evidence
- Catalog presence ≠ availability ≠ sale

### Retention / deletion

- Raw observations and market events carry `deletion_status` / `retention_status`
- Eligibility must exclude deleted
- Phase G: deletion propagation into retrieval indexes and future snapshots

## Review gate checklist

- [x] Append-only sold events + follow-ups
- [x] Settlement provenance for SALE_COMPLETED
- [x] Shared snapshot + claim ledger schema
- [ ] Phase C: zero live synthetic floors
- [ ] Phase D: memory isolation + forget
- [ ] Phase E: invention guard + confirmed actions
- [x] Phase F: semantic corpus
- [x] Phase G: connector contracts live wiring (`phase34-rights-connectors.mjs`)
- [x] Phase G: connector rights contracts enforced at runtime

## Stop conditions

Stop only for destructive-data, rights, credential, or unrecoverable infra blockers.
Do **not** launch attempt 7 / screenshots / production approval from this review alone.
