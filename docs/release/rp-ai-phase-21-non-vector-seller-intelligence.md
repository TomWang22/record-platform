# Record Platform AI Phase 21 — non-vector seller intelligence release note

Generated: 2026-06-28  
Edge: `https://record-platform.test` (strict TLS only)

## Release identity

| Field | Value |
| ----- | ----- |
| Closeout SHA | `4eb1fc3` (P21.8 + P21.8R closeout) |
| Final validation SHA | `13bc0ad` (P21.7B) |
| Phase | **21 — Non-vector seller intelligence product track** |
| Phase 20 | **LOCKED** — `docs/release/rp-ai-phase-20-hardening-20260625.md` |
| Vector rollout | **NOT APPROVED** |
| T20.14 / T20.15 | **BLOCKED** |
| Prepared tag (not created unless asked) | `rp-ai-phase-21-non-vector-seller-intelligence-20260628` |

---

## Summary

Phase 21 productizes **structured seller intelligence** on `/insights` using the existing **keyword retrieval + rule-engine synthesis** production path. This release does **not** enable vector retrieval, hybrid rollout, or embedding tranches.

Sellers get four grounded panels (listing advice, negotiation strategy, auction pressure, collector metadata gaps) with expandable source evidence, plus deferred loading so panels resolve quickly without competing with the free-form RAG card.

---

## Shipped capabilities

| Capability | Ticket |
| ---------- | ------ |
| Four seller intelligence panels on `/insights` | P21.1 |
| Source evidence expand/collapse (sanitized excerpts) | P21.2 |
| Session memory API prototype (`/api/ai/session/*`) | P21.3 |
| Collector metadata extraction + 22-field UI map | P21.4 |
| AI quality telemetry reporter | P21.5 |
| Latency burn-down (deferred RAG + secondary cards) | P21.6 |
| Release candidate + final validation | P21.7 |

Production defaults unchanged:

| Setting | Value |
| ------- | ----- |
| Retrieval | `keyword` |
| Synthesis | `rule-engine` |
| Vector default | off |
| Generative Ollama for RAG | off |

---

## Validation metrics (P21.7B)

| Metric | Value | Gate |
| ------ | ----: | ---- |
| Seller panels | 4/4 | PASS |
| Seller dashboard ready | 12.3s | ≤15s PASS |
| UI latency p95 | 11.2s | ≤15s PASS |
| Endpoint latency p95 | 11.0s | ≤12s PASS |
| Record intelligence avg | 3.86 | ≥3.5 PASS |
| Longform avg | 3.67 | ≥3.5 PASS |
| Final turn score | 4.0 | ≥4.0 PASS |
| Leakage | PASS | PASS |
| Telemetry WARNs | 0 | PASS |
| pytest | 222 passed | PASS |
| Contract suite | all PASS | PASS |

Full validation: `docs/ai-platform/P21-7B-non-vector-seller-intelligence-final-validation.md`

---

## User-facing behavior

- **`/insights`** shows seller intelligence **above** the RAG query card
- Each panel: summary, caveats, source refs, expandable sanitized evidence
- Collector panel: completeness score + field map + recommended edits
- RAG card remains for free-form questions (prefetch deferred after idle)
- Session memory is **API-only** — no dedicated chat UI in Phase 21

---

## Non-goals (explicit)

- Vector retrieval default or hybrid rollout
- T20.14 / T20.15 embedding tranche work
- Generative Ollama as production RAG default
- Multi-pod session memory persistence
- Batch seller retrieval endpoint
- Message body exposure in UI or API responses

---

## Rollback

1. Revert webapp commits P21.1–P21.6 (panel layout, evidence UX, deferred loading)
2. Keyword RAG card continues to work without structured panels
3. Backend seller endpoints are additive — safe to leave deployed if uncalled
4. No env var changes required for rollback
5. Vector remains off

---

## Known limitations

- Session memory is in-process only (TTL, no Redis/DB)
- Four panels each run independent keyword retrieval (~3–11s API under load)
- Sparse corpus may show “Source excerpt unavailable” — expected
- Field map not on free-form RAG card
- Vector latency/overlap work remains blocked (T20.14/T20.15)

---

## Documentation index

| Doc | Purpose |
| --- | ------- |
| `docs/ai-platform/P21-0-non-vector-seller-intelligence-charter.md` | Phase charter |
| `docs/ai-platform/P21-7A-non-vector-seller-intelligence-rc.md` | Release candidate |
| `docs/ai-platform/P21-7B-non-vector-seller-intelligence-final-validation.md` | Final validation |
| `docs/ai-platform/P21-8-release-closeout.md` | Release closeout |
| `docs/ai-platform/PHASE_21_COPILOT_CONTEXT.md` | Agent source of truth |
| `scripts/ai-quality-telemetry-report.mjs` | Ongoing quality/latency reporter |

---

## Final verdict

```text
Phase 21 non-vector seller intelligence: READY FOR RELEASE
Vector rollout: NOT APPROVED
T20.14/T20.15: BLOCKED
```

This milestone closes the Phase 21 **non-vector product track**. Vector rollout requires separate approval and is out of scope for this release.
