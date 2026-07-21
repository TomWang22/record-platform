# Root-cause remediation plan

**Order is mandatory. UI/screenshot work stays frozen until gates below pass.**

## Phase A — Sold-event model (blocker)

1. Define listing lifecycle: ACTIVE, ENDED_UNSOLD, SOLD, CANCELLED, EXPIRED, ARCHIVED.
2. Emit `SALE_COMPLETED` only from completed transactions (checkout/settlement/auction close with winner payment), never from ARCHIVED.
3. Persist canonical events with sale event ID, subject identity, price, currency, timestamp, mechanism, condition, source, rights, deletion status.
4. Remove live acceptance use of:
   - `force_sold_floor`
   - seed COMPLETED_SALE JSON merge into engines
   - completed-sales API reading seed file as production evidence
5. Keep archive-as-sold regression tests forever.

## Phase B — Canonical market-event platform

1. Raw ingestion store (immutable observations + payload hash).
2. Normalization to shared event types (directive §4).
3. Entity resolution returning MATCHED_EXACT_PRESSING | MATCHED_RELEASE_ONLY | AMBIGUOUS | UNRESOLVED.
4. Eligibility + dedupe layer.
5. **Mandatory evidence snapshot** on every intelligence response.

All eight capabilities must consume the same snapshot format.

## Phase C — Kill capability-local synthetic floors

Inventory: `reports/phase34-root-cause/runtime-fallback-inventory.json`.

- Strip `force_*` from live API schemas.
- Delete auto-floor when `owner_proof_prompt` + empty inputs (recs/analytics).
- Move `_catalog_cards` / analytics a1..aN / rec seed arrays behind unit-test hooks only.
- Auction honest-limit uses empty watchlist subject, not intent wipe.

## Phase D — Authoritative multi-turn state

Persist structured facts (offer, ask, shipping, conditions, floor, tone, draft_status) with value, source turn, timestamp, confidence, supersession.

Turn loop: load → apply → resolve corrections → re-retrieve if needed → recompute → grounded draft → confirm unsent.

## Phase E — Deterministic analytics + grounded synthesis

Deterministic code owns counts/stats/rank features/confidence/safety.

Language model **only after** structured result, with invention guards and structured consistency check.

`MODEL_WEIGHT_TRAINING` remains NO.

## Phase F — Semantic evaluation

Replace shape-only success with claim/evidence/correction/mode/session assertions (directive §9).

Keep H1/H2/H3 as transport, not truth.

## Phase G — Real-data posture

Separate catalog / asking / completed-sale / auction / private first-party.

Discogs only for permitted uses. Restricted marketplace / Popsike / Gripsweat stay disabled without written rights.

Preferred foundation: first-party completed transactions, offers, auctions, authorized monitors, permitted catalog, licensed archives.

## Phase H — UI (later only)

Only after A–G gates: redesign overview and panels as customer response renderers — not this phase.

## Phase I — Performance (later only)

Descriptive latency only until correctness. No deep percentiles from n=27.

## Explicit non-goals now

- Attempt 7 / screenshot packs / upload-20 polish
- Frontend styling as “product remediation”
- Owner-proof PASS claims
- smoke-v6 / canary / gauntlet / 33F / production
