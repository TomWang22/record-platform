# T20.22A — Hybrid production rollout design

**Status:** Design complete (docs only — **not** implementation, **not** rollout approval)  
**Generated:** 2026-07-01  
**Baseline SHA:** `7689d25` (T20.21E closeout)  
**Image:** `python-ai-service:t20-p216b` (unchanged)  
**Parent:** T20.21C decision (B selected; E rejected; owner sign-off absent)

---

## 1. Executive verdict

```text
T20.22A hybrid production rollout design: COMPLETE
No implementation
No env change
Production default: keyword
Vector production default: NOT APPROVED
Hybrid production default: NOT APPROVED
Hybrid allowlist canary: KEEP (single contract user)
AI_RAG_HYBRID_CANARY_PERCENT=0
Rollout implementation: NOT APPROVED
T20.23A: NOT STARTED
```

This document defines **what would be required** for any future hybrid default rollout. It does **not** authorize rollout, env change, or default switch.

---

## 2. Evidence baseline

| Batch | Cases | HTTP 200 | Fallback |
|-------|-------|----------|----------|
| T20.16D-LIVE | 45 | 45/45 | 0% |
| T20.17C-LIVE | 90 | 90/90 | 0% |
| T20.18C-LIVE | 270 | 270/270 | 0% |
| T20.19C-LIVE | 810 | 810/810 | 0% |
| T20.20C-LIVE | 540 | 540/540 | 0% |
| T20.21B-LIVE | 270 | 270/270 | 0% |
| **Combined** | **2025** | **2025/2025** | **0%** |

| Diagnostic | Result |
|------------|--------|
| Anchored hybrid overlap | **16/16** |
| Pure vector overlap | **8/16** report-only |
| `final_tagged_plan` fallback | **0** through T20.21B |
| Telemetry WARNs | **0** |
| Leakage / OCH | **PASS** |
| Playwright | **PASS** |

---

## 3. Rollout candidate definition

| Lane | Name | Rollout candidate? |
|------|------|-------------------|
| **B** | Hybrid anchored | **Yes** — only candidate for future rollout evaluation |
| **A** | Pure vector | **No** — report-only diagnostics |
| **C** | Keyword / rule-engine | **Current production default** — unchanged unless future owner approval |

Rollout candidate is **hybrid anchored Lane B only**. Pure vector Lane A is not a candidate. Keyword Lane C remains default unless a future approval package explicitly changes production default semantics.

---

## 4. Required rollout prerequisites

| Prerequisite | Required | Current status |
|--------------|----------|----------------|
| Owner/product sign-off | Yes | **ABSENT** |
| Engineering sign-off | Yes | **ABSENT** |
| Privacy/leakage sign-off | Yes | Evidence PASS; formal sign-off **ABSENT** |
| Ops/rollback sign-off | Yes | Runbook documented; formal sign-off **ABSENT** |
| Observability sign-off | Yes | Telemetry 0 WARNs; formal sign-off **ABSENT** |
| Support/comms sign-off | Yes | **ABSENT** |
| Blocker acceptance or resolution | Yes | **Not documented** |

No phase of the rollout ladder may proceed without the prerequisites for that phase being explicitly satisfied and recorded.

---

## 5. Blockers

| Blocker | Status |
|---------|--------|
| Owner/product sign-off absent | **Open** |
| Pure vector 8/16 | **Open** — report-only |
| Hybrid anchor dependency | **Open** — keyword anchors mandatory |
| Keyword fallback mandatory | **Required** — cannot remove |
| No approval to change production default semantics | **Open** |
| Permanent broader allowlist not selected | **Not approved** |

---

## 6. Rollout ladder (design only)

Each phase requires a **separate approval phrase**. No phase is implied by this design doc.

| Phase | Scope | Approval phrase (example) |
|-------|-------|---------------------------|
| **0** | Keep allowlist canary, percent=0 | *(current state — T20.21C B selected)* |
| **1** | Shadow-only validation | `Approved: start T20.22X shadow validation window only` |
| **2** | Opt-in non-default hybrid preview | `Approved: start T20.23A opt-in hybrid preview design only` |
| **3** | Limited default candidate behind owner-approved flag | `Approved: start T20.24A hybrid default candidate design only` |
| **4** | Default decision package | `Approved: start T20.25A hybrid default decision package only` |

Phases 2–4 require owner/product sign-off and documented blocker acceptance before any implementation ticket.

---

## 7. Safety gates (all rollout phases)

| Gate | Target | Hard threshold |
|------|--------|----------------|
| HTTP 200 | **100%** | **100%** |
| Fallback rate | **0%** | **≤1%** |
| `final_tagged_plan` fallback | **0** | **0** |
| Avg quality score | **≥4.0** | **≥3.5** |
| Worst quality score | **≥3.0** | **≥3.0** |
| Hybrid p95 | — | **≤3000 ms** |
| Canary errors | **0** | **0** |
| Telemetry WARNs | **0** | **0** |
| Leakage | **PASS** | **PASS** |
| OCH | **PASS** | **PASS** |
| Playwright | **PASS** | **PASS** |
| Anchored overlap | **16/16** | **≥10/16** |
| Pure overlap | report-only | no promotion unless separately approved |

---

## 8. Rollback

1. `AI_RAG_HYBRID_CANARY_PERCENT=0`
2. `AI_RAG_HYBRID_CANARY=0` → full hybrid off
3. Image pin: `python-ai-service:t20-p216b`
4. Restore single contract UUID allowlist: `2ed75568-7deb-4c29-91b0-6919f24a0c9f`

---

## 9. Explicit stop condition

```text
T20.22B evidence audit: authorized
Rollout implementation: NOT authorized
Production default switch: NOT authorized
T20.23A: NOT STARTED
```

---

## 10. Ticket sequence

| Ticket | Scope |
|--------|-------|
| T20.22A | This design |
| T20.22B | Evidence audit + sign-off inventory |
| T20.22C | Rollout decision package |
| T20.22D | Rollout design closeout |
| T20.22E | `PHASE_21_COPILOT_CONTEXT.md` reconciliation |

Do **not** start T20.23A until T20.22E closeout is complete.
