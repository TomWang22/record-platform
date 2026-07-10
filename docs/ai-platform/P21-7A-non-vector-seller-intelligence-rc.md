# P21.7A — Phase 21 non-vector seller intelligence release candidate

**Generated:** 2026-06-28  
**Baseline SHA:** `e70c565`  
**Charter:** `docs/ai-platform/P21-0-non-vector-seller-intelligence-charter.md`  
**Track:** keyword retrieval + rule-engine synthesis — **not** vector rollout

---

## Product capability summary

Shipped capabilities on the Phase 21 non-vector seller intelligence track:

| Capability | Ticket | Notes |
| ---------- | ------ | ----- |
| `/insights` seller intelligence panels | P21.1 | Four structured panels on `/insights` |
| Listing advice | P21.1 | Catalog health, weak listings, revision signals |
| Negotiation strategy | P21.1 | Offer-summary-only guidance; no message bodies |
| Auction pressure | P21.1 | Bid-summary signals with sparse-evidence caveats |
| Collector metadata gaps | P21.1 / P21.4 | Present/missing fields, completeness score |
| Source evidence expand/collapse | P21.2 | Sanitized excerpts on RAG + all four seller panels |
| Session memory endpoints | P21.3 | `session/start`, `query`, `get`, `reset` — in-memory prototype |
| Collector metadata field map | P21.4 | 22-field map UI on collector panel |
| AI quality telemetry | P21.5 | `scripts/ai-quality-telemetry-report.mjs` + local bench artifacts |
| Deferred loading / latency burn-down | P21.6 | Seller panels prioritized; RAG + secondary cards deferred |

Production path unchanged: **keyword** retrieval, **rule-engine** synthesis, vector default **off**.

---

## Gate table

| Gate | Current | Status |
| ---- | ------- | ------ |
| Seller panels | 4/4 | PASS |
| Source evidence UX | accepted | PASS |
| Session memory | accepted | PASS |
| Collector metadata | accepted | PASS |
| Quality telemetry | accepted | PASS |
| Latency WARNs | 0 | PASS |
| Record intelligence score | 3.86 | PASS |
| Longform score | 3.67 | PASS |
| Final turn score | 4.0 | PASS |
| Leakage | PASS | PASS |
| Contracts | PASS | PASS |
| Vector rollout | NOT APPROVED | BLOCKED |
| T20.14/T20.15 | BLOCKED | BLOCKED |

Contract references: P21.5B telemetry, P21.6B latency acceptance, `scripts/audit-rp-ai-*` suite (final validation in P21.7B).

---

## User-facing behavior

On **`/insights`**:

1. **Seller intelligence section appears first** — four structured panels above the free-form RAG card (P21.6 layout).
2. Each panel shows:
   - Summary text from keyword retrieval + rule-engine synthesis
   - Caveats when evidence is sparse or degraded
   - Source refs with expand/collapse evidence (sanitized excerpts or “unavailable” label)
   - Privacy note on negotiation panel: private message bodies were not used
3. **Collector metadata panel** additionally shows:
   - Completeness score (0–100)
   - Field map (present / missing / unknown per collector field)
   - High-priority missing fields and recommended listing edits
4. **RAG query card** remains available below seller panels; prefetches after idle — user can still run free-form questions.
5. **Session memory** is an **API prototype only** (`/api/ai/session/*`); there is no dedicated `/insights` chat UI wired to session memory in Phase 21.

Secondary dashboard cards (valuation, pricing, OBO, auction risk, seller/buyer summaries) load after first paint via deferred idle scheduling.

---

## Rollback

| Layer | Action |
| ----- | ------ |
| Webapp | Revert P21.1–P21.6 webapp commits; `/insights` returns to prior layout |
| RAG card | Keyword RAG card remains; no env change required |
| Backend | Structured seller endpoints are additive; safe to leave deployed if uncalled |
| Env | No new production env vars for Phase 21 product path |
| Vector | Remains off — rollback does not affect retrieval mode |

Rollback does **not** require database migration or embedding tranche changes.

---

## Known limitations

- **No vector rollout** — keyword retrieval only; hybrid/overlap not approved
- **Session memory in-memory only** — no Redis/DB persistence; not multi-pod safe
- **No multi-pod session sharing** — session TTL is process-local
- **No batch seller endpoint** — four panels each perform independent keyword retrieval (~3s API each)
- **Sparse source excerpts** — some panels show “Source excerpt unavailable” when corpus is thin; expected on contract data
- **Vector latency/overlap unresolved** — T20.14/T20.15 blocked; not in scope for this RC
- **Field map on free-form RAG card** — collector field map is seller-panel only, not on RAG card
- **Telemetry artifacts local-only** — `bench_logs/` not committed; run reporter after acceptance suites

---

## Ticket completion map

| Ticket | Scope | Status |
| ------ | ----- | ------ |
| P21.0 | Charter | ACCEPTED |
| P21.1 | Seller intelligence UI | ACCEPTED |
| P21.2 | Source evidence UX | ACCEPTED |
| P21.3 | Session memory + hardening | ACCEPTED |
| P21.4 | Collector metadata extraction/UI | ACCEPTED |
| P21.5 | AI quality telemetry | ACCEPTED |
| P21.6 | Latency burn-down | ACCEPTED |
| P21.7 | Release candidate + final validation | IN PROGRESS |

---

## Final verdict

```text
Phase 21 non-vector seller intelligence RC: READY FOR FINAL VALIDATION
Vector rollout: NOT APPROVED
T20.14/T20.15: BLOCKED
```
