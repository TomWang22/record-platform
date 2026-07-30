# T20.23A — Opt-in hybrid preview design

**Status:** Design complete (docs only — **not** implementation, **not** rollout, **not** default switch)  
**Generated:** 2026-07-01  
**Baseline SHA:** `1fbd4da` (T20.22E closeout)  
**Image:** `python-ai-service:t20-p216b` (unchanged)  
**Parent:** T20.22C decision (B selected; rollout NOT APPROVED; owner sign-off absent)

---

## 1. Executive verdict

```text
T20.23A opt-in hybrid preview design: COMPLETE
No implementation
No env change
Production default: keyword
Vector production default: NOT APPROVED
Hybrid production default: NOT APPROVED
Hybrid allowlist canary: KEEP (single contract user)
AI_RAG_HYBRID_CANARY_PERCENT=0
Opt-in preview implementation: NOT APPROVED
T20.24A: NOT STARTED
```

This document defines an **opt-in hybrid preview** path that is explicitly non-default and owner-gated. It does **not** authorize implementation, env change, allowlist broadening, or production default switch.

---

## 2. Evidence baseline

| Evidence | Result |
|----------|--------|
| T20.15 hybrid canary ladder | **CLOSED** (percent=0 restored after each eval) |
| T20.16–T20.21 live evidence | **2025/2025** HTTP 200, **0%** fallback |
| T20.22 rollout design batch | **CLOSED**; rollout **NOT APPROVED** |
| Anchored hybrid overlap | **16/16** |
| Pure vector overlap | **8/16** report-only |
| `final_tagged_plan` fallback | **0** through T20.21B |
| Telemetry WARNs | **0** |
| Leakage / RP | **PASS** |

### Live evidence table (T20.16D → T20.21B)

| Batch | Cases | HTTP 200 | Fallback |
|-------|-------|----------|----------|
| T20.16D-LIVE | 45 | 45/45 | 0% |
| T20.17C-LIVE | 90 | 90/90 | 0% |
| T20.18C-LIVE | 270 | 270/270 | 0% |
| T20.19C-LIVE | 810 | 810/810 | 0% |
| T20.20C-LIVE | 540 | 540/540 | 0% |
| T20.21B-LIVE | 270 | 270/270 | 0% |
| **Combined** | **2025** | **2025/2025** | **0%** |

---

## 3. Opt-in preview definition

| Property | Requirement |
|----------|-------------|
| Default semantics | **Non-default** — keyword remains production default for all non-preview users |
| Access model | **Explicit user/owner opt-in only** — no implicit or percentage-based assignment |
| Authentication | **JWT-authenticated users only** — no anonymous or guest access |
| Message bodies | **No exposure** in UI or API responses |
| Percentage rollout | **Prohibited** — `AI_RAG_HYBRID_CANARY_PERCENT` remains **0** |
| Production default | **Unchanged** — preview does not alter default retrieval semantics |
| Lane | **Hybrid anchored Lane B only** — pure vector Lane A remains report-only |

Preview is a **named, owner-approved opt-in surface** separate from production default semantics. It is not a rollout ladder step and does not imply future default approval.

---

## 4. Required prerequisites before implementation

| Prerequisite | Required | Current status |
|--------------|----------|----------------|
| Owner/product sign-off | Yes | **ABSENT** |
| Engineering sign-off | Yes | **ABSENT** |
| Privacy/leakage sign-off | Yes | Evidence PASS; formal sign-off **ABSENT** |
| Ops/rollback sign-off | Yes | Runbook documented; formal sign-off **ABSENT** |
| Observability sign-off | Yes | Telemetry 0 WARNs; formal sign-off **ABSENT** |
| Support/comms sign-off | Yes | **ABSENT** |

No preview implementation may proceed without all prerequisites satisfied and recorded as artifacts in the repo.

---

## 5. Proposed preview scope (design only)

| Item | Design |
|------|--------|
| Allowlist | **Small named allowlist only** — owner-approved UUIDs; no percentage expansion |
| PERCENT | **Remains 0** — no percentage-based hybrid assignment |
| Opt-in flag | **Explicit opt-in flag separate from production default** (e.g. user-level or account-level preview enrollment, distinct from `keyword` default path) |
| Production default | **Keyword unchanged** for all non-preview users |
| Current canary | **KEEP** single contract-user allowlist until preview implementation is separately approved |

Preview scope is **additive and reversible**. Broadening the permanent allowlist without a scoped approval package and restore plan is **not** authorized by this design.

---

## 6. Preview gates

| Gate | Threshold |
|------|-----------|
| HTTP 200 | **100%** |
| API fallback | **≤1%** |
| `final_tagged_plan` fallback | **0** |
| Avg quality score | **≥3.5** |
| Worst quality score | **≥3.0** |
| Hybrid p95 latency | **≤3000 ms** |
| Telemetry WARNs | **0** |
| Leakage scan | **PASS** |
| RP scan | **PASS** |
| Playwright acceptance | **PASS** |
| Anchored overlap | Target **16/16**; hard min **≥10/16** |
| Pure overlap | **Report-only** unless separately approved |

---

## 7. Rollback

1. Remove preview allowlist entries / disable opt-in flag
2. `AI_RAG_HYBRID_CANARY_PERCENT=0`
3. `AI_RAG_HYBRID_CANARY=0` → full hybrid off
4. Image pin: `python-ai-service:t20-p216b`
5. Restore single contract UUID allowlist if temporarily modified for scoped eval

---

## 8. Owner/product sign-off checklist template

Use this checklist before any preview implementation (T20.24A+). All items must be **checked and signed** with named approver, date, and artifact reference in repo.

| # | Item | Owner | Engineering | Privacy | Ops | Observability | Support |
|---|------|:-----:|:-----------:|:-------:|:---:|:-------------:|:-------:|
| 1 | Preview is **non-default**; keyword default unchanged | ☐ | ☐ | — | ☐ | — | ☐ |
| 2 | **No** production default switch for hybrid or vector | ☐ | ☐ | — | ☐ | — | ☐ |
| 3 | **No** `PERCENT` > 0 without scoped eval approval + restore | ☐ | ☐ | — | ☐ | — | — |
| 4 | Named allowlist only; no anonymous/guest access | ☐ | ☐ | ☐ | ☐ | — | ☐ |
| 5 | JWT auth only; no header-spoofed user IDs | — | ☐ | ☐ | — | — | — |
| 6 | No message-body exposure in UI/API | ☐ | ☐ | ☐ | — | — | ☐ |
| 7 | Keyword fallback and overlap anchors **retained** | — | ☐ | ☐ | ☐ | — | — |
| 8 | Privacy/leakage filters **not weakened** | — | ☐ | ☐ | — | — | — |
| 9 | Rollback runbook reviewed and tested | — | ☐ | — | ☐ | ☐ | ☐ |
| 10 | Preview gates (§6) accepted as pass/fail criteria | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| 11 | Pure vector 8/16 accepted as **report-only** | ☐ | ☐ | — | — | — | — |
| 12 | Support/comms plan for preview participants | ☐ | — | — | — | — | ☐ |
| 13 | Combined live baseline **2025/2025** acknowledged | ☐ | ☐ | — | — | ☐ | — |

**Sign-off block (copy per approver):**

```text
Approver role:
Approver name:
Date (UTC):
Artifact path (doc/PR/issue):
Scope: opt-in hybrid preview [implementation | design-only]
Explicitly NOT approved: [ ] hybrid default  [ ] vector default  [ ] PERCENT>0  [ ] broadened permanent allowlist
Signature / approval reference:
```

---

## 9. Stop condition

```text
Opt-in preview implementation: NOT APPROVED
T20.23B sign-off path audit: AUTHORIZED
T20.24A: NOT STARTED
```

No code, env, image, or allowlist changes until owner/product sign-off artifacts exist and a separate T20.24A+ approval phrase is issued.
