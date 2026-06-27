# P21.0 — Phase 21 non-vector seller intelligence charter

**Status:** Approved — Phase 21 started  
**Generated:** 2026-06-27  
**Baseline SHA:** `d3c9cd1`  
**Prior decision:** `docs/ai-platform/T20-13AA-phase21-readiness-decision-package.md`

---

## Title

**Phase 21 — Non-vector seller intelligence product track**

---

## Scope

Phase 21 may include:

- Productizing structured seller intelligence
- UI panels for listing advice / negotiation strategy / auction pressure / collector metadata gaps
- Source evidence display improvements
- Session memory design
- Collector metadata extraction improvements
- AI quality telemetry

Phase 21 excludes:

- Vector default rollout
- Hybrid rollout
- Default-on overlap flags
- Embedding tranches (unless separately approved)
- ANN index changes (unless separately approved)
- T20.14 / T20.15 vector rollout work

---

## Production path (unchanged)

| Setting | Value |
| ------- | ----- |
| Retrieval | `keyword` |
| Synthesis | `rule-engine` |
| Vector default | off |
| `AI_RAG_SHADOW_VECTOR` | must remain off unless explicitly approved per task |

Existing RAG query card on `/insights` remains the fallback for free-form questions.

---

## Success metrics

Initial product metrics (P21.1 acceptance):

| Metric | Target |
| ------ | ------ |
| Structured seller endpoints visible in UI | 4/4 panels on `/insights` |
| Panel render | 4/4 cards render with summary |
| Leakage | PASS — no message bodies |
| Source refs | Visible per panel when endpoint returns refs |
| Sanitized excerpts | Available in API `details.excerpts` where present; UI affordance in P21.2 |
| Record intelligence UI avg | ≥3.5/5 (baseline 3.57 post T20.13Z) |
| Longform session avg | ≥3.5/5 (baseline 3.58 post T20.13Z) |
| Production retrieval | keyword |
| model_used | rule-engine |

---

## Rollback

- UI panels gated behind existing `/insights` route; no new env vars required
- Existing RAG card preserved — users can continue free-form RAG without structured panels
- Disable panels by reverting webapp commit; backend endpoints remain additive and inert if uncalled
- No vector dependency — rollback does not affect retrieval mode

---

## Ticket sequence (Phase 21)

| Ticket | Scope | Status |
| ------ | ----- | ------ |
| P21.0 | This charter | **STARTED** |
| P21.1A | Seller intelligence UI surfaces | In progress |
| P21.1B | UI acceptance report | Pending |
| P21.2 | Source evidence UX | Not started |
| P21.3 | Session memory design | Not started |
| P21.4 | Collector metadata extraction | Not started |
| P21.5 | AI quality telemetry dashboard | Not started |

---

## Hard boundaries (all Phase 21 work)

- Do not enable vector default
- Do not start T20.14/T20.15
- Do not default-on overlap flags
- Do not run embedding tranches without separate approval
- Do not use generative Ollama as production RAG default
- Do not expose message bodies

---

## Final verdict

```text
Vector rollout: NOT APPROVED
T20.14/T20.15: BLOCKED
Phase 21: STARTED — non-vector product track only
```
